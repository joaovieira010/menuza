const path = require("node:path");
require("dotenv").config({
  path: path.resolve(__dirname, "../../.env"),
  quiet: true,
});
if (!process.env.DATABASE_URL)
  throw new Error("Preencha DATABASE_URL em backend/.env.");
let database;
try {
  database = new URL(process.env.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(database.protocol))
    throw new Error();
} catch {
  throw new Error("DATABASE_URL inválida.");
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
  throw new Error("JWT_SECRET deve conter pelo menos 32 caracteres.");
const imageStorage = process.env.IMAGE_STORAGE || "local";
if (!["local", "cloudinary"].includes(imageStorage))
  throw new Error("IMAGE_STORAGE deve ser local ou cloudinary.");
const cloudinary = {
  cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
  apiKey: process.env.CLOUDINARY_API_KEY || "",
  apiSecret: process.env.CLOUDINARY_API_SECRET || "",
  prefix: process.env.CLOUDINARY_PREFIX || "menuza",
};
if (
  imageStorage === "cloudinary" &&
  (!/^[a-zA-Z0-9_-]+$/.test(cloudinary.cloudName) ||
    !cloudinary.apiKey ||
    !cloudinary.apiSecret ||
    !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(cloudinary.prefix))
)
  throw new Error(
    "Configure as credenciais Cloudinary e um prefixo válido no backend.",
  );
if (process.env.NODE_ENV === "production") {
  let origin;
  try {
    origin = new URL(process.env.APP_ORIGIN || "");
  } catch {
    throw new Error("Produção exige APP_ORIGIN público com HTTPS.");
  }
  if (
    origin.origin !== process.env.APP_ORIGIN ||
    origin.protocol !== "https:" ||
    ["localhost", "127.0.0.1"].includes(origin.hostname)
  )
    throw new Error("Produção exige APP_ORIGIN público com HTTPS.");
  if (/gere_um|defina_|segredo-unitario/i.test(process.env.JWT_SECRET))
    throw new Error("Configure um JWT_SECRET aleatório de produção.");
  if (database.pathname.endsWith("_test"))
    throw new Error("Produção não pode usar banco de testes.");
  if (imageStorage !== "cloudinary")
    throw new Error(
      "Produção exige IMAGE_STORAGE=cloudinary; disco local não é persistente.",
    );
  if (database.hostname.includes("-pooler."))
    throw new Error("Use conexão direta: a cobrança utiliza travas de sessão.");
  if (database.searchParams.get("sslmode") !== "verify-full")
    throw new Error("Produção exige DATABASE_URL com sslmode=verify-full.");
}
module.exports = {
  imageStorage,
  cloudinary,
  databaseUrl: process.env.DATABASE_URL,
  secret: process.env.JWT_SECRET,
  host: process.env.HOST || "127.0.0.1",
  uploadDir: path.resolve(
    process.env.UPLOAD_DIR || path.resolve(__dirname, "../../uploads"),
  ),
  trustProxy: /^\d+$/.test(process.env.TRUST_PROXY || "")
    ? Number(process.env.TRUST_PROXY)
    : process.env.TRUST_PROXY || false,
  port: Number(process.env.PORT || 3000),
  origin: process.env.APP_ORIGIN || "http://localhost:3000",
  production: process.env.NODE_ENV === "production",
};
