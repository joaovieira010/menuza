/* Diagnóstico somente leitura. Não mostra credenciais, clientes ou contas. */
const fs = require("node:fs/promises");
const path = require("node:path");
const pool = require("../backend/src/database/pool");
async function check() {
  const c = await pool.connect();
  try {
    await c.query("BEGIN READ ONLY");
    const expected = (
      await fs.readdir(
        path.join(__dirname, "../backend/src/database/migrations"),
      )
    )
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const applied = new Set(
      (await c.query("SELECT nome FROM migrations")).rows.map(
        (row) => row.nome,
      ),
    );
    const pending = expected.filter((name) => !applied.has(name));
    const {
      rows: [store],
    } = await c.query(
      "SELECT count(*)::int AS n FROM estabelecimentos WHERE slug='frutellagourmet-d9b505e6'",
    );
    const {
      rows: [owner],
    } = await c.query(
      "SELECT count(*)::int AS n FROM usuarios WHERE papel='SUPERADMIN' AND ativo=true",
    );
    const {
      rows: [status],
    } = await c.query(
      "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='pedidos'::regclass AND conname='pedidos_status_check'",
    );
    const { rows: columns } = await c.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='historico_pedidos'",
    );
    const missing = [
      "usuario_id",
      "usuario_email",
      "mensagem_whatsapp",
      "telefone_whatsapp",
      "whatsapp_aberto_em",
    ].filter((name) => !columns.some((row) => row.column_name === name));
    const result = {
      somente_leitura: true,
      migrations_pendentes: pending,
      frutella_link_presente: store.n === 1,
      superadmin_ativo_presente: owner.n > 0,
      status_pronto_permitido: !!status?.definition.includes("'pronto'"),
      colunas_historico_ausentes: missing,
      aviso:
        "Este diagnóstico não testa senhas, envio de WhatsApp ou disponibilidade pela internet.",
    };
    console.log(JSON.stringify(result, null, 2));
    if (
      pending.length ||
      missing.length ||
      !result.status_pronto_permitido ||
      !result.frutella_link_presente ||
      !result.superadmin_ativo_presente
    )
      process.exitCode = 1;
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}
check()
  .catch((error) => {
    console.error(
      "Diagnóstico indisponível. Verifique o PostgreSQL e as migrations. Código:",
      error.code || error.name,
    );
    process.exitCode = 1;
  })
  .finally(() => pool.end());
