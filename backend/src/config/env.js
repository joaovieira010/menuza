const path = require("node:path");
require("dotenv").config({
  path: path.resolve(__dirname, "../../.env"),
  quiet: true,
});
if (!process.env.DATABASE_URL)
  throw new Error("Preencha DATABASE_URL em backend/.env.");
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
  throw new Error("JWT_SECRET deve conter pelo menos 32 caracteres.");
module.exports = {
  databaseUrl: process.env.DATABASE_URL,
  secret: process.env.JWT_SECRET,
  port: Number(process.env.PORT || 3000),
  origin: process.env.APP_ORIGIN || "http://localhost:3000",
  production: process.env.NODE_ENV === "production",
};
