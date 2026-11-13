const jwt = require("jsonwebtoken");
const env = require("../config/env");
const pool = require("../database/pool");
module.exports = async (req, res, next) => {
  try {
    const token = jwt.verify(req.cookies.menuza, env.secret, {
      algorithms: ["HS256"],
      issuer: "menuza",
    });
    const {
      rows: [user],
    } = await pool.query(
      "SELECT id,estabelecimento_id,email FROM usuarios WHERE id=$1 AND estabelecimento_id=$2",
      [token.sub, token.loja],
    );
    if (!user)
      return res.status(401).json({ erro: "Faça login para continuar." });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ erro: "Sessão expirada. Faça login." });
  }
};
