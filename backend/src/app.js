const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const path = require("node:path");
const { rateLimit } = require("express-rate-limit");
const env = require("./config/env");
const pool = require("./database/pool");
const { parse, schemas, slug, phone } = require("./middlewares/validation");
const catalog = require("./services/catalog");
const { createOrder, quoteCoupon } = require("./services/orders");
const app = express();
app.disable("x-powered-by");
if (env.trustProxy) app.set("trust proxy", env.trustProxy);
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
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
// Origem canônica e aliases explicitamente configurados. O proxy e o Host da
// requisição não podem ampliar a allowlist. Mantém proteção Fetch Metadata.
app.use("/api", (req, res, next) => {
  const origin = req.get("origin");
  const allowed =
    !origin || origin === env.origin || env.allowedOrigins.includes(origin);
  res.vary("Origin");
  if (!allowed || req.get("sec-fetch-site") === "cross-site") {
    // Somente motivos constantes: não registrar cabeçalhos, corpo ou credenciais.
    console.warn("http.origin_rejected", {
      reason: allowed ? "cross_site" : "origin_not_allowed",
    });
    return res.status(403).json({ erro: "Origem não autorizada." });
  }
  if (origin) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Access-Control-Allow-Credentials", "true");
  }
  if (req.method === "OPTIONS")
    return res
      .set(
        "Access-Control-Allow-Methods",
        "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
      )
      .set("Access-Control-Allow-Headers", "Content-Type")
      .sendStatus(204);
  next();
});
app.use(express.json({ limit: "64kb" }));
app.use(cookieParser());
app.use("/api/superadmin", require("./routes/superadmin"));
app.use("/api/admin", require("./routes/admin"));
app.get("/api/:slug/cardapio", async (req, res) => {
  const {
    rows: [loja],
  } = await pool.query("SELECT * FROM estabelecimentos WHERE slug=$1", [
    parse(slug, req.params.slug),
  ]);
  if (!loja)
    return res.status(404).json({ erro: "Estabelecimento não encontrado." });
  await require("./services/billing").assertAccess(pool, loja.id);
  res.json(await catalog(pool, loja));
});
app.post(
  "/api/:slug/cupons/validar",
  rateLimit({
    windowMs: 60000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { erro: "Muitas consultas de cupom. Aguarde um minuto." },
  }),
  async (req, res) =>
    res.json(
      await quoteCoupon(
        pool,
        parse(slug, req.params.slug),
        parse(schemas.couponQuote, req.body),
      ),
    ),
);
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
app.post(
  "/api/public/contato",
  rateLimit({
    windowMs: 3600000,
    limit: 5,
    message: { erro: "Aguarde para enviar outro contato." },
  }),
  async (req, res) => {
    const { z } = require("zod");
    const d = parse(
      z.object({
        nome: z.string().trim().min(2).max(120),
        estabelecimento: z.string().trim().min(2).max(120),
        email: z.string().trim().max(254).pipe(z.email()),
        telefone: phone,
        tipo_negocio: z.string().trim().max(120).default(""),
        cidade: z.string().trim().max(120).default(""),
        mensagem: z.string().trim().max(1000).default(""),
        consentimento: z.literal(true),
      }),
      req.body,
    );
    const mensagem = require("./services/whatsapp").contactMessage(d);
    await pool.query(
      "INSERT INTO interesses_comerciais(nome,estabelecimento,email,telefone,mensagem,tipo_negocio,cidade) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        d.nome,
        d.estabelecimento,
        d.email,
        d.telefone,
        d.mensagem,
        d.tipo_negocio,
        d.cidade,
      ],
    );
    res.status(201).json({
      ok: true,
      whatsapp_url: require("./services/whatsapp").whatsappUrl(
        "5548988780394",
        mensagem,
      ),
    });
  },
);
app.get("/api/public/planos", async (req, res) =>
  res.json(
    (
      await pool.query(
        "SELECT id,nome,preco,limite_produtos,limite_pedidos_mes,adicionais,personalizacao FROM planos WHERE ativo=true ORDER BY preco",
      )
    ).rows,
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
if (env.imageStorage === "cloudinary") {
  app.get("/uploads/:name", require("./services/images").serve);
  app.use("/uploads", (req, res) => res.sendStatus(404));
} else
  app.use(
    "/uploads",
    express.static(env.uploadDir, {
      dotfiles: "deny",
      setHeaders: (res) =>
        res.set("Content-Security-Policy", "default-src 'none'; sandbox"),
    }),
  );
app.use("/assets", express.static(path.resolve(__dirname, "../../frontend")));
app.get(["/superadmin", "/superadmin/"], (req, res) =>
  res
    .set("Cache-Control", "no-store")
    .sendFile(path.resolve(__dirname, "../../frontend/superadmin/index.html")),
);
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
  if (err.code === "23505") {
    status = 409;
    message = "Slug, e-mail ou referência já cadastrado.";
  } else if (err.code === "P0001") {
    status = 409;
    message = "Limite de produtos ativos do plano atingido.";
  } else if (err.code === "LIMIT_FILE_SIZE") {
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
  res.status(status).json({ erro: message, codigo: err.publicCode });
});
module.exports = app;
