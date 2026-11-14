const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const pool = require("../database/pool");
const env = require("../config/env");
const { parse, schemas } = require("../middlewares/validation");
const { fail } = require("./billing");
const cookie = {
  httpOnly: true,
  sameSite: "strict",
  secure: env.production,
  path: "/",
  maxAge: 8 * 60 * 60 * 1000,
};
const cookieName = (role) =>
  role === "SUPERADMIN" ? "menuza_platform" : "menuza";
function login(role) {
  return async (req, res) => {
    const d = parse(schemas.login, req.body);
    const {
      rows: [u],
    } = await pool.query(
      "SELECT * FROM usuarios WHERE email=$1 AND papel=$2 AND ativo=true",
      [d.email, role],
    );
    const valid = await bcrypt.compare(
      d.senha,
      u?.senha_hash ||
        "$2b$12$ybmpfgwwVoVmK1CFcLzJCudIqTzVMvWDB4HcARtpUv.7fOeIFV.gK",
    );
    if (!u || !valid) fail("E-mail ou senha inválidos.", 401);
    if (role === "STORE_ADMIN")
      await require("./billing").assertAccess(pool, u.estabelecimento_id);
    const sid = crypto.randomUUID();
    await pool.query(
      "INSERT INTO sessoes(id,usuario_id,expira_em) VALUES($1,$2,now()+interval '8 hours')",
      [sid, u.id],
    );
    const token = jwt.sign(
      { loja: u.estabelecimento_id, papel: role },
      env.secret,
      {
        subject: String(u.id),
        jwtid: sid,
        issuer: "menuza",
        algorithm: "HS256",
        expiresIn: "8h",
      },
    );
    res
      .cookie(cookieName(role), token, cookie)
      .json({ email: u.email, papel: role });
  };
}
function auth(role) {
  return async (req, res, next) => {
    let token;
    try {
      token = jwt.verify(req.cookies[cookieName(role)], env.secret, {
        algorithms: ["HS256"],
        issuer: "menuza",
      });
    } catch {
      return res.status(401).json({ erro: "Sessão expirada. Faça login." });
    }
    if (token.papel !== role || !token.jti)
      return res.status(403).json({ erro: "Acesso não autorizado." });
    const {
      rows: [u],
    } = await pool.query(
      `SELECT u.id,u.estabelecimento_id,u.email,u.papel FROM usuarios u JOIN sessoes s ON s.usuario_id=u.id
 WHERE u.id=$1 AND s.id=$2 AND s.expira_em>now() AND u.ativo=true AND u.papel=$3`,
      [token.sub, token.jti, role],
    );
    if (!u || u.estabelecimento_id !== token.loja)
      return res.status(401).json({ erro: "Faça login para continuar." });
    req.user = u;
    req.sessionId = token.jti;
    next();
  };
}
function logout(role) {
  return async (req, res) => {
    await pool.query("DELETE FROM sessoes WHERE id=$1 AND usuario_id=$2", [
      req.sessionId,
      req.user.id,
    ]);
    res.clearCookie(cookieName(role), cookie).json({ ok: true });
  };
}
module.exports = { login, auth, logout };
