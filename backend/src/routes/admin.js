const express = require("express");
const { rateLimit } = require("express-rate-limit");
const multer = require("multer");
const crypto = require("node:crypto");
const images = require("../services/images");
const pool = require("../database/pool");
const auth = require("../middlewares/auth");
const { parse, schemas } = require("../middlewares/validation");
const admin = require("../controllers/admin");
const { fail } = require("../services/orders");
const router = express.Router();
const sessions = require("../services/sessions");
const billing = require("../services/billing");
router.post(
  "/login",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { erro: "Muitas tentativas. Aguarde 15 minutos." },
  }),
  sessions.login("STORE_ADMIN"),
);
router.use(auth);
router.post("/logout", sessions.logout("STORE_ADMIN"));
router.get("/me", (req, res) => res.json(req.user));
router.get("/assinatura", async (req, res) =>
  res.json(await billing.subscription(pool, req.user.estabelecimento_id)),
);
router.use(async (req, res, next) => {
  req.subscription = await billing.assertAccess(
    pool,
    req.user.estabelecimento_id,
  );
  next();
});
router.use("/cupons", require("./coupons"));
router.get("/catalogo", admin.list);
router.get("/dashboard", admin.dashboard);
router.get("/pedidos", admin.orders);
router.patch("/pedidos/:id/status", admin.status);
router.post("/pedidos/:id/whatsapp", admin.openWhatsapp);
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
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.mimetype))
      fail("Formato inválido. Envie PNG, JPEG ou WebP.");
    let normalized;
    try {
      const sharp = require("sharp");
      const source = sharp(f.buffer, {
        limitInputPixels: 20000000,
        animated: false,
        failOn: "warning",
      });
      const metadata = await source.metadata();
      if (
        !["png", "jpeg", "webp"].includes(metadata.format) ||
        (metadata.pages || 1) > 1
      )
        fail("Imagem inválida.");
      normalized = await source
        .rotate()
        .resize({
          width: 2000,
          height: 2000,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      fail("Imagem inválida ou excede 20 milhões de pixels.");
    }
    const name = crypto.randomUUID() + ".webp";
    res.status(201).json({ url: await images.save(name, normalized) });
  },
);
router.post("/:resource", admin.save);
router.put("/:resource/:id", admin.save);
router.delete("/:resource/:id", admin.remove);
module.exports = router;
