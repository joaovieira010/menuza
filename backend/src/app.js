const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const path = require("node:path");
const { rateLimit } = require("express-rate-limit");
const env = require("./config/env");
const pool = require("./database/pool");
const { parse, schemas, slug } = require("./middlewares/validation");
const catalog = require("./services/catalog");
const { createOrder } = require("./services/orders");
const app = express();
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "img-src": ["'self'", "data:"],
        "script-src": ["'self'"],
        "style-src": ["'self'"],
        "upgrade-insecure-requests": env.production ? [] : null,
      },
    },
    strictTransportSecurity: env.production ? undefined : false,
  }),
);
// Mesma origem: cookies e alterações só são aceitos do domínio configurado.
app.use("/api", (req, res, next) => {
  const origin = req.get("origin");
  if (
    (origin && origin !== env.origin) ||
    req.get("sec-fetch-site") === "cross-site"
  )
    return res.status(403).json({ erro: "Origem não autorizada." });
  if (origin) {
    res.set("Access-Control-Allow-Origin", env.origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Credentials", "true");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "64kb" }));
app.use(cookieParser());
app.use("/api/admin", require("./routes/admin"));
app.get("/api/:slug/cardapio", async (req, res) => {
  const {
    rows: [loja],
  } = await pool.query("SELECT * FROM estabelecimentos WHERE slug=$1", [
    parse(slug, req.params.slug),
  ]);
  if (!loja)
    return res.status(404).json({ erro: "Estabelecimento não encontrado." });
  res.json(await catalog(pool, loja));
});
app.post(
  "/api/:slug/pedidos",
  rateLimit({
    windowMs: 60000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { erro: "Muitos pedidos. Aguarde um minuto." },
  }),
  async (req, res) =>
    res
      .status(201)
      .json(
        await createOrder(
          pool,
          parse(slug, req.params.slug),
          parse(schemas.pedido, req.body),
        ),
      ),
);
app.use("/api", (req, res) =>
  res.status(404).json({ erro: "Rota não encontrada." }),
);
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "indisponivel" });
  }
});
app.use(
  "/uploads",
  express.static(path.resolve(__dirname, "../uploads"), {
    dotfiles: "deny",
    setHeaders: (res) =>
      res.set("Content-Security-Policy", "default-src 'none'; sandbox"),
  }),
);
app.use("/assets", express.static(path.resolve(__dirname, "../../frontend")));
app.get(["/admin", "/admin/"], (req, res) =>
  res.sendFile(path.resolve(__dirname, "../../frontend/admin/index.html")),
);
app.get("/", (req, res) =>
  res.sendFile(path.resolve(__dirname, "../../frontend/index.html")),
);
app.get("/:slug", (req, res) =>
  res.sendFile(path.resolve(__dirname, "../../frontend/cardapio/index.html")),
);
app.use((req, res) => res.status(404).send("Página não encontrada."));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  let status = err.status || 400,
    message = err.message;
  if (err.code === "LIMIT_FILE_SIZE") {
    status = 400;
    message = "Imagem deve ter até 2 MB.";
  } else if (err instanceof SyntaxError) {
    status = 400;
    message = "JSON inválido.";
  } else if (!err.status && !err.code?.startsWith("LIMIT_")) {
    status = 500;
    message = "Não foi possível concluir. Tente novamente.";
    console.error("Falha interna:", err.code || err.name);
  }
  res.status(status).json({ erro: message });
});
module.exports = app;
