const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { rateLimit } = require("express-rate-limit");
const multer = require("multer");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const env = require("../config/env");
const pool = require("../database/pool");
const auth = require("../middlewares/auth");
const { parse, schemas } = require("../middlewares/validation");
const admin = require("../controllers/admin");
const { fail } = require("../services/orders");
const router = express.Router();
const cookie = {
  httpOnly: true,
  sameSite: "strict",
  secure: env.production,
  path: "/",
  maxAge: 8 * 60 * 60 * 1000,
};
const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { erro: "Muitas tentativas. Aguarde 15 minutos." },
});
router.post("/login", loginLimit, async (req, res) => {
  const data = parse(schemas.login, req.body);
  const {
    rows: [user],
  } = await pool.query(
    "SELECT id,estabelecimento_id,email,senha_hash FROM usuarios WHERE email=$1",
    [data.email],
  );
  // Também calcula bcrypt quando o e-mail não existe para reduzir diferença de tempo.
  const valid = await bcrypt.compare(
    data.senha,
    user
      ? user.senha_hash
      : "$2b$12$ybmpfgwwVoVmK1CFcLzJCudIqTzVMvWDB4HcARtpUv.7fOeIFV.gK",
  );
  if (!user || !valid) fail("E-mail ou senha inválidos.", 401);
  const token = jwt.sign({ loja: user.estabelecimento_id }, env.secret, {
    subject: String(user.id),
    issuer: "menuza",
    algorithm: "HS256",
    expiresIn: "8h",
  });
  res.cookie("menuza", token, cookie).json({ email: user.email });
});
router.use(auth);
router.post("/logout", (req, res) =>
  res.clearCookie("menuza", cookie).json({ ok: true }),
);
router.get("/me", (req, res) => res.json(req.user));
router.get("/catalogo", admin.list);
router.get("/dashboard", admin.dashboard);
router.get("/pedidos", admin.orders);
router.patch("/pedidos/:id/status", admin.status);
router.put("/configuracoes", admin.settings);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 },
});
router.post(
  "/upload",
  rateLimit({
    windowMs: 60000,
    limit: 20,
    message: { erro: "Aguarde para enviar mais imagens." },
  }),
  upload.single("imagem"),
  async (req, res) => {
    const f = req.file;
    if (!f) fail("Selecione uma imagem.");
    let ext;
    if (
      f.mimetype === "image/png" &&
      f.buffer
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      ext = "png";
    if (
      f.mimetype === "image/jpeg" &&
      f.buffer[0] === 255 &&
      f.buffer[1] === 216 &&
      f.buffer[2] === 255
    )
      ext = "jpg";
    if (
      f.mimetype === "image/webp" &&
      f.buffer.toString("ascii", 0, 4) === "RIFF" &&
      f.buffer.toString("ascii", 8, 12) === "WEBP"
    )
      ext = "webp";
    if (!ext) fail("Formato inválido. Envie PNG, JPEG ou WebP de até 2 MB.");
    const name = crypto.randomUUID() + "." + ext,
      dir = path.resolve(__dirname, "../../uploads");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), f.buffer, { flag: "wx" });
    res.status(201).json({ url: "/uploads/" + name });
  },
);
router.post("/:resource", admin.save);
router.put("/:resource/:id", admin.save);
router.delete("/:resource/:id", admin.remove);
module.exports = router;
