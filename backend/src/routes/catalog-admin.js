const router = require("express").Router();
const multer = require("multer");
const crypto = require("node:crypto");
const images = require("../services/images");
const admin = require("../controllers/admin");
const { fail } = require("../services/orders");
const { rateLimit } = require("express-rate-limit");

router.get("/catalogo", admin.list);
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
