/* Usa fonte _test e destino _restore_test já criado e vazio. Não limpa bancos existentes. */
require("dotenv").config({ path: "backend/.env", quiet: true });
const { Pool } = require("pg"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const source = process.env.TEST_DATABASE_URL;
if (
  !source ||
  !new URL(source).pathname.endsWith("_test") ||
  source === process.env.DATABASE_URL
)
  throw new Error("Fonte precisa ser TEST_DATABASE_URL exclusivo.");
const target = new URL(source);
target.pathname = "/menuza_restore_test";
if (target.href === new URL(source).href)
  throw new Error("Fonte e destino precisam ser diferentes.");
process.env.DATABASE_URL = source;
const pool = require("../src/database/pool"),
  migrate = require("../src/database/migrate"),
  seed = require("../src/database/seed");
const { backup } = require("../../scripts/backup.cjs"),
  restore = require("../../scripts/restore.cjs");
async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "menuza-backup-qa-")),
    schema = "qa_migrations_" + Date.now();
  const fresh = new Pool({
    connectionString: source,
    options: "-c search_path=" + schema,
  });
  const destination = new Pool({ connectionString: target.href });
  try {
    await pool.query("CREATE SCHEMA " + schema);
    await migrate(fresh);
    await seed(fresh, require("node:crypto").randomBytes(18).toString("hex"));
    assert.equal(
      (await fresh.query("SELECT count(*)::int AS n FROM migrations")).rows[0]
        .n,
      (
        await fs.readdir(path.join(__dirname, "../src/database/migrations"))
      ).filter((name) => name.endsWith(".sql")).length,
    );
    assert.equal(
      (await fresh.query("SELECT count(*)::int AS n FROM assinaturas")).rows[0]
        .n,
      2,
    );
    console.log("Migrations e seed em schema vazio: OK");
    await fresh.end();
    await pool.query("DROP SCHEMA " + schema + " CASCADE");
    process.env.UPLOAD_DIR = path.join(root, "uploads");
    process.env.BACKUP_DIR = path.join(root, "backups");
    await fs.mkdir(process.env.UPLOAD_DIR);
    await fs.writeFile(
      path.join(process.env.UPLOAD_DIR, "fixture.txt"),
      "Upload QA de restauração",
    );
    process.env.RESTORE_FROM = await backup();
    process.env.RESTORE_DATABASE_URL = target.href;
    process.env.RESTORE_UPLOAD_DIR = path.join(root, "restored-uploads");
    process.env.RESTORE_CONFIRM = "menuza_restore_test";
    await restore();
    for (const table of [
      "estabelecimentos",
      "assinaturas",
      "pedidos",
      "itens_pedido",
      "pagamentos",
      "auditoria_plataforma",
      "migrations",
    ]) {
      const before = (
        await pool.query("SELECT count(*)::int AS n FROM " + table)
      ).rows[0].n;
      const after = (
        await destination.query("SELECT count(*)::int AS n FROM " + table)
      ).rows[0].n;
      assert.equal(after, before, table);
    }
    assert.equal(
      await fs.readFile(
        path.join(process.env.RESTORE_UPLOAD_DIR, "fixture.txt"),
        "utf8",
      ),
      "Upload QA de restauração",
    );
    // Uma segunda restauração no banco populado deve falhar sem apagar dados.
    await assert.rejects(restore, /banco vazio/);
    console.log(
      "Backup, checksum, restauração de tabelas/financeiro/uploads e recusa de sobrescrita: OK",
    );
  } finally {
    await destination.end();
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
