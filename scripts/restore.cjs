require("dotenv").config({ path: "backend/.env", quiet: true });
const fs = require("node:fs/promises"),
  path = require("node:path"),
  { Client } = require("pg");
const { run, pgEnv, checksum } = require("./backup.cjs");
async function restore() {
  const source = process.env.RESTORE_FROM,
    target = process.env.RESTORE_DATABASE_URL,
    uploads = process.env.RESTORE_UPLOAD_DIR;
  if (!source || !target || !uploads)
    throw new Error(
      "Configure RESTORE_FROM, RESTORE_DATABASE_URL e RESTORE_UPLOAD_DIR (destinos vazios).",
    );
  const dbname = decodeURIComponent(new URL(target).pathname.slice(1));
  if (process.env.RESTORE_CONFIRM !== dbname)
    throw new Error(
      "RESTORE_CONFIRM deve ser o nome exato do banco de destino.",
    );
  const manifest = JSON.parse(
    await fs.readFile(path.join(source, "manifest.json"), "utf8"),
  );
  if (
    (await checksum(path.join(source, "database.dump"))) !==
      manifest.database_sha256 ||
    (await checksum(path.join(source, "uploads.tar.gz"))) !==
      manifest.uploads_sha256
  )
    throw new Error("Checksum do backup não confere.");
  const c = new Client({ connectionString: target });
  await c.connect();
  try {
    const r = await c.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'",
    );
    if (r.rows[0].n)
      throw new Error(
        "Restauração exige banco vazio; não apaga banco existente.",
      );
  } finally {
    await c.end();
  }
  await fs.mkdir(uploads, { recursive: true, mode: 0o700 });
  if ((await fs.readdir(uploads)).length)
    throw new Error("A pasta de uploads de destino precisa estar vazia.");
  await run(
    process.env.PG_RESTORE_BIN || "pg_restore",
    [
      "--no-owner",
      "--no-acl",
      "--exit-on-error",
      "--dbname",
      dbname,
      path.join(source, "database.dump"),
    ],
    pgEnv(target),
  );
  await run("tar", [
    "-xzf",
    path.join(source, "uploads.tar.gz"),
    "-C",
    path.resolve(uploads),
  ]);
  console.log(
    "Restauração concluída. Valide health, contagens e pedidos antes de mudar o tráfego.",
  );
}
if (require.main === module)
  restore().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = restore;
