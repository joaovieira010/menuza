/* Reutiliza o teste original sem alterar seus asserts; prepara apenas as fixtures em base exclusiva. */
require("dotenv").config({ path: "backend/.env", quiet: true });
const source = process.env.TEST_DATABASE_URL;
if (!source || !new URL(source).pathname.endsWith("_test"))
  throw new Error("TEST_DATABASE_URL obrigatório.");
const url = new URL(source);
url.pathname = "/menuza_legacy_test";
if (url.href === process.env.DATABASE_URL)
  throw new Error("Banco precisa ser separado da aplicação.");
process.env.DATABASE_URL = url.href;
process.env.SEED_ADMIN_PASSWORD = require("node:crypto")
  .randomBytes(20)
  .toString("hex");
process.env.NODE_ENV = "test";
const pool = require("../src/database/pool"),
  migrate = require("../src/database/migrate"),
  seed = require("../src/database/seed"),
  env = require("../src/config/env"),
  app = require("../src/app");
async function main() {
  await migrate();
  await seed();
  // Senha da fixture só pode ser renovada neste banco descartável, identificado explicitamente.
  const hash = await require("bcrypt").hash(
    process.env.SEED_ADMIN_PASSWORD,
    12,
  );
  await pool.query(
    "UPDATE usuarios SET senha_hash=$1 WHERE email IN ('admin@hamburguer.demo','admin@doces.demo')",
    [hash],
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  env.origin = `http://127.0.0.1:${server.address().port}`;
  process.env.APP_ORIGIN = env.origin;
  try {
    await new Promise((resolve, reject) => {
      const p = require("node:child_process").spawn(
        process.execPath,
        [require("node:path").join(__dirname, "browser.cjs")],
        { env: process.env, stdio: "inherit" },
      );
      p.on("error", reject);
      p.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error("Regressão Chrome: " + code)),
      );
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
