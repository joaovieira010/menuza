const pool = require("../database/pool");
const { schemas, parse, id } = require("../middlewares/validation");
const { fail, savedMessage } = require("../services/orders");
const {
  whatsappUrl,
  normalizePhone,
  statusMessage,
} = require("../services/whatsapp");
const catalog = require("../services/catalog");
// Nomes SQL vêm apenas desta lista fixa; valores são sempre parâmetros.
const resources = {
  categorias: { schema: "categoria", table: "categorias" },
  produtos: { schema: "produto", table: "produtos" },
  grupos: { schema: "grupo", table: "grupos_adicionais" },
  adicionais: { schema: "adicional", table: "adicionais" },
};
async function ownRelation(tid, table, value) {
  if (value !== null && value !== undefined) {
    const r = await pool.query(
      `SELECT id FROM ${table} WHERE estabelecimento_id=$1 AND id=$2`,
      [tid, value],
    );
    if (!r.rowCount) fail("Vínculo não encontrado nesta loja.");
  }
}
async function list(req, res) {
  const {
    rows: [loja],
  } = await pool.query("SELECT * FROM estabelecimentos WHERE id=$1", [
    req.user.estabelecimento_id,
  ]);
  res.json(await catalog(pool, loja, true));
}
async function save(req, res) {
  const resource = resources[req.params.resource];
  if (!resource) fail("Recurso não encontrado.", 404);
  const data = parse(schemas[resource.schema], req.body),
    tid = req.user.estabelecimento_id;
  if (
    ["grupos", "adicionais"].includes(req.params.resource) &&
    !req.subscription.adicionais
  )
    fail("Seu plano não permite gerenciar adicionais.", 403);
  await ownRelation(tid, "categorias", data.categoria_id);
  await ownRelation(tid, "produtos", data.produto_id);
  await ownRelation(tid, "grupos_adicionais", data.grupo_id);
  const keys = Object.keys(data),
    values = Object.values(data);
  let result;
  if (req.params.id) {
    result = await pool.query(
      `UPDATE ${resource.table} SET ${keys.map((k, i) => `${k}=$${i + 3}`).join(",")} WHERE estabelecimento_id=$1 AND id=$2 RETURNING *`,
      [tid, parse(id, req.params.id), ...values],
    );
    if (!result.rowCount) fail("Registro não encontrado.", 404);
  } else
    result = await pool.query(
      `INSERT INTO ${resource.table}(estabelecimento_id,${keys.join(",")}) VALUES($1,${keys.map((_, i) => "$" + (i + 2)).join(",")}) RETURNING *`,
      [tid, ...values],
    );
  res.status(req.params.id ? 200 : 201).json(result.rows[0]);
}
async function remove(req, res) {
  const resource = resources[req.params.resource];
  if (!resource) fail("Recurso não encontrado.", 404);
  // Exclusão lógica preserva o histórico de vendas e os vínculos existentes.
  const r = await pool.query(
    `UPDATE ${resource.table} SET ativo=false WHERE estabelecimento_id=$1 AND id=$2 RETURNING id`,
    [req.user.estabelecimento_id, parse(id, req.params.id)],
  );
  if (!r.rowCount) fail("Registro não encontrado.", 404);
  res.json({ ok: true });
}
async function settings(req, res) {
  if (!req.subscription.personalizacao) {
    const {
      rows: [current],
    } = await pool.query(
      "SELECT logo_url,banner_url,cor_principal FROM estabelecimentos WHERE id=$1",
      [req.user.estabelecimento_id],
    );
    if (
      ["logo_url", "banner_url", "cor_principal"].some(
        (k) => (req.body[k] || "") !== (current[k] || ""),
      )
    )
      fail("Seu plano não permite personalização.", 403);
  }
  const data = parse(schemas.loja, req.body),
    keys = Object.keys(data);
  const {
    rows: [loja],
  } = await pool.query(
    `UPDATE estabelecimentos SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(",")} WHERE id=$1 RETURNING id,nome,slug,logo_url,banner_url,descricao,whatsapp,taxa_entrega,aberto,horarios,cor_principal`,
    [req.user.estabelecimento_id, ...Object.values(data)],
  );
  res.json(loja);
}
async function orders(req, res) {
  const f = parse(schemas.filtros, req.query),
    tid = req.user.estabelecimento_id;
  const { rows } = await pool.query(
    `SELECT * FROM pedidos WHERE estabelecimento_id=$1 AND ($2::date IS NULL OR criado_em >= ($2::date::timestamp AT TIME ZONE 'America/Sao_Paulo')) AND ($3::date IS NULL OR criado_em < (($3::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')) AND ($4::text IS NULL OR status=$4) ORDER BY criado_em DESC LIMIT 200`,
    [tid, f.inicio || null, f.fim || null, f.status || null],
  );
  if (rows.length) {
    const {
      rows: [loja],
    } = await pool.query(
      "SELECT nome,whatsapp FROM estabelecimentos WHERE id=$1",
      [tid],
    );
    const ids = rows.map((r) => r.id);
    const { rows: itens } = await pool.query(
      "SELECT * FROM itens_pedido WHERE estabelecimento_id=$1 AND pedido_id=ANY($2::bigint[]) ORDER BY id",
      [tid, ids],
    );
    const { rows: extras } = await pool.query(
      "SELECT a.* FROM itens_pedido_adicionais a JOIN itens_pedido i ON i.id=a.item_pedido_id AND i.estabelecimento_id=a.estabelecimento_id WHERE a.estabelecimento_id=$1 AND i.pedido_id=ANY($2::bigint[])",
      [tid, ids],
    );
    const { rows: historico } = await pool.query(
      "SELECT * FROM historico_pedidos WHERE estabelecimento_id=$1 AND pedido_id=ANY($2::bigint[]) ORDER BY criado_em,id",
      [tid, ids],
    );
    for (const i of itens)
      i.adicionais = extras.filter((a) => a.item_pedido_id === i.id);
    for (const p of rows) {
      p.itens = itens.filter((i) => i.pedido_id === p.id);
      p.historico = historico.filter((h) => h.pedido_id === p.id);
      p.mensagem = savedMessage(loja, p);
      p.whatsapp_url = whatsappUrl(loja.whatsapp, p.mensagem);
      const event = p.historico.at(-1);
      p.notificacao =
        event?.status === p.status && event.mensagem_whatsapp
          ? {
              id: event.id,
              mensagem: event.mensagem_whatsapp,
              aberto_em: event.whatsapp_aberto_em,
            }
          : null;
      p.proximos_status = allowedStatuses(p);
    }
  }
  res.json(rows);
}
const transitions = {
  pendente: ["confirmado", "cancelado"],
  confirmado: ["em_preparacao", "cancelado"],
  em_preparacao: ["pronto", "cancelado"],
  pronto: ["saiu_para_entrega", "concluido", "cancelado"],
  saiu_para_entrega: ["concluido", "cancelado"],
  concluido: [],
  cancelado: [],
};
function allowedStatuses(p) {
  return (transitions[p.status] || []).filter(
    (next) =>
      !(p.modalidade === "retirada" && next === "saiu_para_entrega") &&
      !(
        p.modalidade === "entrega" &&
        p.status === "pronto" &&
        next === "concluido"
      ),
  );
}
async function status(req, res) {
  const data = parse(schemas.status, req.body),
    pid = parse(id, req.params.id),
    tid = req.user.estabelecimento_id,
    c = await pool.connect();
  try {
    await c.query("BEGIN");
    const {
      rows: [p],
    } = await c.query(
      "SELECT * FROM pedidos WHERE estabelecimento_id=$1 AND id=$2 FOR UPDATE",
      [tid, pid],
    );
    if (!p) fail("Pedido não encontrado.", 404);
    // Repetições e concorrência não criam outro evento nem outra notificação.
    if (p.status === data.status) {
      await c.query("COMMIT");
      return res.json({ ok: true, repetido: true });
    }
    if (
      (data.status_anterior && data.status_anterior !== p.status) ||
      !allowedStatuses(p).includes(data.status)
    )
      fail("Mudança de status inválida. Atualize os pedidos.");
    const mensagem = statusMessage({ ...p, status: data.status });
    // Pedidos antigos podem conter telefones que o checkout atual já rejeita.
    // O atendimento deve poder avançar sem inventar um destinatário válido.
    let telefone = null;
    try {
      telefone = normalizePhone(p.cliente_telefone);
    } catch {}
    const aviso = telefone
      ? null
      : "Status atualizado, mas o telefone antigo do cliente é inválido para WhatsApp. Confira o contato com o cliente.";
    await c.query(
      "UPDATE pedidos SET status=$3,atualizado_em=now() WHERE estabelecimento_id=$1 AND id=$2",
      [tid, pid, data.status],
    );
    await c.query(
      "INSERT INTO historico_pedidos(estabelecimento_id,pedido_id,status,usuario_id,usuario_email,mensagem_whatsapp,telefone_whatsapp) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        tid,
        pid,
        data.status,
        req.user.id,
        req.user.email,
        telefone ? mensagem : null,
        telefone,
      ],
    );
    await c.query("COMMIT");
    res.json({ ok: true, aviso });
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
// Consome uma única solicitação de abertura por evento. Nenhum envio é registrado.
async function openWhatsapp(req, res) {
  const pid = parse(id, req.params.id),
    hid = parse(id, req.body?.historico_id),
    tid = req.user.estabelecimento_id,
    c = await pool.connect();
  try {
    await c.query("BEGIN");
    const {
      rows: [p],
    } = await c.query(
      "SELECT status FROM pedidos WHERE estabelecimento_id=$1 AND id=$2 FOR UPDATE",
      [tid, pid],
    );
    if (!p) fail("Pedido não encontrado.", 404);
    const {
      rows: [h],
    } = await c.query(
      `UPDATE historico_pedidos SET whatsapp_aberto_em=now()
       WHERE estabelecimento_id=$1 AND pedido_id=$2 AND id=$3 AND status=$4
       AND mensagem_whatsapp IS NOT NULL AND whatsapp_aberto_em IS NULL RETURNING *`,
      [tid, pid, hid, p.status],
    );
    if (!h)
      fail("Mensagem já aberta ou indisponível para o status atual.", 409);
    const url = whatsappUrl(h.telefone_whatsapp, h.mensagem_whatsapp);
    await c.query("COMMIT");
    res.json({ whatsapp_url: url, mensagem: h.mensagem_whatsapp });
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
async function dashboard(req, res) {
  const tid = req.user.estabelecimento_id;
  const {
    rows: [summary],
  } = await pool.query(
    `SELECT count(*)::int AS pedidos,COALESCE(sum(total) FILTER(WHERE status<>'cancelado'),0)::bigint AS faturamento FROM pedidos WHERE estabelecimento_id=$1 AND (criado_em AT TIME ZONE 'America/Sao_Paulo')::date=(now() AT TIME ZONE 'America/Sao_Paulo')::date`,
    [tid],
  );
  const { rows: mais_vendidos } = await pool.query(
    `SELECT i.nome,sum(i.quantidade)::int AS quantidade FROM itens_pedido i JOIN pedidos p ON p.id=i.pedido_id AND p.estabelecimento_id=i.estabelecimento_id WHERE i.estabelecimento_id=$1 AND p.status<>'cancelado' AND (p.criado_em AT TIME ZONE 'America/Sao_Paulo')::date=(now() AT TIME ZONE 'America/Sao_Paulo')::date GROUP BY i.nome ORDER BY quantidade DESC LIMIT 5`,
    [tid],
  );
  res.json({
    ...summary,
    faturamento: Number(summary.faturamento),
    mais_vendidos,
  });
}
module.exports = {
  list,
  save,
  remove,
  settings,
  orders,
  status,
  openWhatsapp,
  dashboard,
};
