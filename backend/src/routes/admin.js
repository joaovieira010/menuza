const express = require("express");
const { rateLimit } = require("express-rate-limit");
const pool = require("../database/pool");
const auth = require("../middlewares/auth");
const admin = require("../controllers/admin");
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
router.get("/dashboard", admin.dashboard);
router.get("/pedidos", admin.orders);
router.patch("/pedidos/:id/status", admin.status);
router.post("/pedidos/:id/whatsapp", admin.openWhatsapp);
router.put("/configuracoes", admin.settings);
router.use(require("./catalog-admin"));
module.exports = router;
