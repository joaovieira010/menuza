const pool = require("../database/pool");
function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
const todaySQL = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";
// Mesma expressão serve para decisão online e conciliação periódica. Vencimento é o primeiro dia pendente.
const effectiveSQL = `CASE WHEN a.status='canceled' THEN 'canceled'
 WHEN a.suspensao_manual THEN 'suspended'
 WHEN p.suspender_automaticamente AND ${todaySQL} >= a.vencimento+p.suspender_dias THEN 'suspended'
 WHEN ${todaySQL} >= a.vencimento+p.lembrete_dias THEN 'past_due'
 WHEN ${todaySQL} >= a.vencimento THEN 'pending'
 WHEN a.status='trialing' THEN 'trialing' ELSE 'active' END`;
async function subscription(db, tid, lock = false) {
  const {
    rows: [row],
  } = await db.query(
    `SELECT a.*, l.situacao, pl.nome AS plano, pl.limite_produtos,pl.limite_pedidos_mes,
 pl.adicionais,pl.personalizacao, ${effectiveSQL} AS efetivo
 FROM assinaturas a JOIN estabelecimentos l ON l.id=a.estabelecimento_id JOIN planos pl ON pl.id=a.plano_id
 CROSS JOIN politica_cobranca p WHERE a.estabelecimento_id=$1 ${lock ? "FOR UPDATE OF a" : ""}`,
    [tid],
  );
  return row;
}
async function assertAccess(db, tid) {
  const s = await subscription(db, tid);
  if (
    !s ||
    s.situacao !== "active" ||
    ["suspended", "canceled"].includes(s.efetivo)
  )
    fail(
      "Estabelecimento temporariamente indisponível. Entre em contato com a Menuza.",
      423,
    );
  return s;
}
async function audit(db, tid, uid, action, details = {}) {
  await db.query(
    "INSERT INTO auditoria_plataforma(estabelecimento_id,usuario_id,acao,detalhes) VALUES($1,$2,$3,$4)",
    [tid, uid, action, JSON.stringify(details)],
  );
}
async function reconcile() {
  const c = await pool.connect();
  let run,
    acquired = false;
  try {
    // Trava de sessão liberada no finally; falha de processo também libera no PostgreSQL.
    const {
      rows: [lock],
    } = await c.query("SELECT pg_try_advisory_lock(728194) AS acquired");
    if (!lock.acquired) return { skipped: true };
    acquired = true;
    run = (
      await c.query(
        "INSERT INTO execucoes_cobranca DEFAULT VALUES RETURNING id",
      )
    ).rows[0].id;
    await c.query("BEGIN");
    const { rows } = await c.query(
      `SELECT a.estabelecimento_id,a.status,${effectiveSQL} AS novo FROM assinaturas a CROSS JOIN politica_cobranca p FOR UPDATE OF a`,
    );
    let changed = 0;
    for (const r of rows)
      if (r.status !== r.novo) {
        await c.query(
          "UPDATE assinaturas SET status=$2 WHERE estabelecimento_id=$1",
          [r.estabelecimento_id, r.novo],
        );
        await audit(c, r.estabelecimento_id, null, "assinatura." + r.novo, {
          anterior: r.status,
        });
        changed++;
      }
    await c.query(`INSERT INTO lembretes_cobranca(estabelecimento_id,vencimento)
   SELECT a.estabelecimento_id,a.vencimento FROM assinaturas a JOIN estabelecimentos l ON l.id=a.estabelecimento_id CROSS JOIN politica_cobranca p
   WHERE l.situacao='active' AND a.status IN ('past_due','suspended') AND NOT a.suspensao_manual AND ${todaySQL}>=a.vencimento+p.lembrete_dias ON CONFLICT DO NOTHING`);
    await c.query(
      "UPDATE execucoes_cobranca SET concluido_em=now(),alteradas=$2 WHERE id=$1",
      [run, changed],
    );
    await c.query("DELETE FROM sessoes WHERE expira_em<now()");
    await c.query("COMMIT");
    console.log(JSON.stringify({ event: "billing.completed", run, changed }));
    await deliverReminders(c);
    return { id: run, alteradas: changed };
  } catch (e) {
    await c.query("ROLLBACK");
    if (run)
      await c.query(
        "UPDATE execucoes_cobranca SET concluido_em=now(),erro=$2 WHERE id=$1",
        [run, e.code || e.name],
      );
    throw e;
  } finally {
    if (acquired) await c.query("SELECT pg_advisory_unlock(728194)");
    c.release();
  }
}
async function deliverReminders(c) {
  const url = process.env.BILLING_WEBHOOK_URL;
  if (!url) return; // Fila permanece pendente; nenhum envio é simulado.
  if (new URL(url).protocol !== "https:")
    throw new Error("BILLING_WEBHOOK_URL exige HTTPS");
  const { rows } =
    await c.query(`SELECT r.id,r.estabelecimento_id,r.vencimento,l.email,l.telefone,a.valor FROM lembretes_cobranca r
 JOIN assinaturas a ON a.estabelecimento_id=r.estabelecimento_id JOIN estabelecimentos l ON l.id=a.estabelecimento_id
 WHERE r.enviado_em IS NULL AND r.proxima_tentativa<=now() AND r.vencimento=a.vencimento
 AND a.status IN ('past_due','suspended') AND l.situacao='active' ORDER BY r.id LIMIT 20`);
  for (const r of rows) {
    try {
      const response = await fetch(url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "menuza-reminder-" + r.id,
          ...(process.env.BILLING_WEBHOOK_TOKEN
            ? { Authorization: "Bearer " + process.env.BILLING_WEBHOOK_TOKEN }
            : {}),
        },
        body: JSON.stringify(r),
      });
      if (!response.ok) throw new Error("HTTP_" + response.status);
      await c.query(
        "UPDATE lembretes_cobranca SET enviado_em=now(),tentativas=tentativas+1,ultimo_erro=NULL WHERE id=$1",
        [r.id],
      );
    } catch {
      await c.query(
        "UPDATE lembretes_cobranca SET tentativas=tentativas+1,proxima_tentativa=now()+interval '1 hour',ultimo_erro='Falha na entrega ao provedor' WHERE id=$1",
        [r.id],
      );
    }
  }
}
if (require.main === module)
  reconcile()
    .catch((e) => {
      console.error("billing.failed", e.code || e.name);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
module.exports = {
  subscription,
  assertAccess,
  audit,
  reconcile,
  fail,
  todaySQL,
  effectiveSQL,
};
