const fs = require("node:fs/promises");
const path = require("node:path");
const pool = require("./pool");
async function migrate(db = pool) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Uma trava impede que dois processos apliquem a mesma migration ao mesmo tempo.
    await client.query("SELECT pg_advisory_xact_lock(728192)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS migrations (nome text PRIMARY KEY, aplicado_em timestamptz DEFAULT now())",
    );
    const dir = path.join(__dirname, "migrations");
    for (const file of (await fs.readdir(dir))
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      const done = await client.query(
        "SELECT nome FROM migrations WHERE nome=$1",
        [file],
      );
      if (!done.rowCount) {
        await client.query(await fs.readFile(path.join(dir, file), "utf8"));
        await client.query("INSERT INTO migrations(nome) VALUES($1)", [file]);
        console.log("Migration aplicada:", file);
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
if (require.main === module)
  migrate()
    .catch(() => {
      console.error(
        "Falha na migration. Verifique conexão e permissões do banco.",
      );
      process.exitCode = 1;
    })
    .finally(() => pool.end());
module.exports = migrate;
