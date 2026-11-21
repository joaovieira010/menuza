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
  produtos: {
    schema: "produto",
    table: "produtos",
    links: "produtos_categorias",
    primaryCategory: true,
  },
  grupos: {
    schema: "grupo",
    table: "grupos_adicionais",
    links: "grupos_categorias",
    primaryCategory: true,
  },
  adicionais: {
    schema: "adicional",
    table: "adicionais",
    links: "adicionais_categorias",
  },
};
async function ownRelations(db, tid, table, ids) {
  if (!ids.length) return;
  const r = await db.query(
    `SELECT id FROM ${table} WHERE estabelecimento_id=$1 AND id=ANY($2::bigint[])`,
    [tid, ids],
  );
  if (r.rowCount !== ids.length) fail("Vínculo não encontrado nesta loja.");
}
async function saveCategoryLinks(db, tid, categoryId, selections) {
  for (const [name, ids] of Object.entries(selections)) {
    const { table, links, primaryCategory } = resources[name];
    await ownRelations(db, tid, table, ids);
    const params = [tid, categoryId, ids];
    await db.query(
      `DELETE FROM ${links} WHERE estabelecimento_id=$1 AND categoria_id=$2
       AND NOT (registro_id=ANY($3::bigint[]))`,
      params,
    );
    if (primaryCategory)
      await db.query(
        `UPDATE ${table} SET categoria_id=NULL
         WHERE estabelecimento_id=$1 AND categoria_id=$2 AND NOT (id=ANY($3::bigint[]))`,
        params,
      );
    await db.query(
      `INSERT INTO ${links}(estabelecimento_id,registro_id,categoria_id)
       SELECT $1,id,$2 FROM ${table} WHERE estabelecimento_id=$1 AND id=ANY($3::bigint[])
       ${primaryCategory ? "AND categoria_id IS DISTINCT FROM $2" : ""}
       ON CONFLICT DO NOTHING`,
      params,
    );
  }
}
const catalogStore = (req) => req.catalogStoreId ?? req.user.estabelecimento_id;
async function list(req, res) {
  const {
    rows: [loja],
  } = await pool.query(
    "SELECT * FROM estabelecimentos WHERE id=$1",
    [catalogStore(req)],
  );
  if (!loja) fail("Estabelecimento não encontrado.", 404);
  res.json({
    ...(await catalog(pool, loja, true)),
    permissoes: { adicionais: req.subscription.adicionais },
  });
}
async function save(req, res) {
  if (!Object.hasOwn(resources, req.params.resource))
    fail("Recurso não encontrado.", 404);
  const resource = resources[req.params.resource];
  const {
    categoria_ids: categoryIds,
    herdar_categorias: inheritCategories,
    vinculos,
    ...data
  } = parse(schemas[resource.schema], req.body);
  const tid = catalogStore(req);
  const recordId = req.params.id && parse(id, req.params.id);
  const isExtra = resource.schema === "adicional";
  if (
    (isExtra ||
      resource.schema === "grupo" ||
      vinculos?.grupos !== undefined ||
      vinculos?.adicionais !== undefined) &&
    !req.subscription.adicionais
  )
    fail("Seu plano não permite gerenciar adicionais.", 403);
  if (isExtra && (categoryIds !== undefined || inheritCategories !== undefined))
    data.herda_categorias =
      categoryIds === null || (inheritCategories ?? false);
  if (!isExtra && categoryIds !== undefined)
    data.categoria_id = categoryIds[0] ?? null;
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const store = await c.query(
      "SELECT id FROM estabelecimentos WHERE id=$1 FOR UPDATE",
      [tid],
    );
    if (!store.rowCount) fail("Estabelecimento não encontrado.", 404);
    await ownRelations(
      c,
      tid,
      "categorias",
      categoryIds ?? [data.categoria_id].filter(Boolean),
    );
    await ownRelations(c, tid, "produtos", [data.produto_id].filter(Boolean));
    await ownRelations(
      c,
      tid,
      "grupos_adicionais",
      [data.grupo_id].filter(Boolean),
    );
    if (
      recordId &&
      resource.schema === "grupo" &&
      categoryIds === undefined &&
      data.produto_id &&
      data.categoria_id === null
    ) {
      const {
        rows: [previous],
      } = await c.query(
        "SELECT produto_id FROM grupos_adicionais WHERE estabelecimento_id=$1 AND id=$2",
        [tid, recordId],
      );
      // Clientes antigos enviam apenas o produto para grupos com esse vínculo.
      if (previous?.produto_id) delete data.categoria_id;
    }
    const keys = Object.keys(data);
    const values = Object.values(data);
    const {
      rows: [record],
    } = recordId
      ? await c.query(
          `UPDATE ${resource.table} SET ${keys.map((k, i) => `${k}=$${i + 3}`).join(",")} WHERE estabelecimento_id=$1 AND id=$2 RETURNING *`,
          [tid, recordId, ...values],
        )
      : await c.query(
          `INSERT INTO ${resource.table}(estabelecimento_id,${keys.join(",")}) VALUES($1,${keys.map((_, i) => "$" + (i + 2)).join(",")}) RETURNING *`,
          [tid, ...values],
        );
    if (!record) fail("Registro não encontrado.", 404);
    if (vinculos) await saveCategoryLinks(c, tid, record.id, vinculos);
    if (resource.links) {
      if (categoryIds !== undefined) {
        await c.query(
          `DELETE FROM ${resource.links} WHERE estabelecimento_id=$1 AND registro_id=$2`,
          [tid, record.id],
        );
        const extraLinks = (categoryIds ?? []).slice(isExtra ? 0 : 1);
        if (extraLinks.length) {
          await c.query(
            `INSERT INTO ${resource.links}(estabelecimento_id,registro_id,categoria_id)
             SELECT $1,$2,categoria_id FROM unnest($3::bigint[]) AS ids(categoria_id)`,
            [tid, record.id, extraLinks],
          );
        }
      } else if (record.categoria_id) {
        // Um cliente antigo pode escolher como principal um vínculo secundário.
        await c.query(
          `DELETE FROM ${resource.links} WHERE estabelecimento_id=$1 AND registro_id=$2 AND categoria_id=$3`,
          [tid, record.id, record.categoria_id],
        );
      }
      const { rows: links } = await c.query(
        `SELECT categoria_id FROM ${resource.links} WHERE estabelecimento_id=$1 AND registro_id=$2 ORDER BY categoria_id`,
        [tid, record.id],
      );
      record.categoria_ids = catalog.categoryIds(
        record,
        links.map((link) => link.categoria_id),
      );
    }
    await c.query("COMMIT");
    res.status(recordId ? 200 : 201).json(record);
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}
async function remove(req, res) {
  if (!Object.hasOwn(resources, req.params.resource))
    fail("Recurso não encontrado.", 404);
  const resource = resources[req.params.resource];
  // Exclusão lógica preserva o histórico de vendas e os vínculos existentes.
  const r = await pool.query(
    `UPDATE ${resource.table} SET ativo=false WHERE estabelecimento_id=$1 AND id=$2 RETURNING id`,
    [catalogStore(req), parse(id, req.params.id)],
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
  // O UPDATE avalia o estado final sob a mesma trava usada na criação do pedido.
  // Clientes antigos que omitem os campos preservam as modalidades já salvas.
  const modalities = ["entrega_ativa", "retirada_ativa"];
  const changingModalities = modalities.some((key) => keys.includes(key));
  const enabled = modalities.map((key) =>
    keys.includes(key) ? `$${keys.indexOf(key) + 2}::boolean` : key,
  );
  const {
    rows: [loja],
  } = await pool.query(
    `UPDATE estabelecimentos SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(",")} WHERE id=$1${changingModalities ? ` AND (${enabled.join(" OR ")})` : ""} RETURNING id,nome,slug,logo_url,banner_url,descricao,whatsapp,taxa_entrega,aberto,horarios,cor_principal,entrega_ativa,retirada_ativa`,
    [req.user.estabelecimento_id, ...Object.values(data)],
  );
  if (!loja) fail("Mantenha ao menos uma modalidade de recebimento ativa.");
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
