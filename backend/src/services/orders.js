const { whatsappUrl } = require("./whatsapp");
const catalog = require("./catalog");
const brl = (v) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    v / 100,
  );
function fail(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
function calculate(data, menu) {
  let subtotal = 0;
  const itens = data.itens.map((item) => {
    const product = menu.produtos.find(
      (p) => String(p.id) === String(item.produto_id),
    );
    if (!product) fail("Produto indisponível neste estabelecimento.");
    if (new Set(item.adicionais.map(String)).size !== item.adicionais.length)
      fail("Adicional repetido.");
    const extras = item.adicionais.map((id) => {
      const a = product.grupos
        .flatMap((g) => g.adicionais)
        .find((a) => String(a.id) === String(id));
      if (!a) fail("Adicional indisponível para este produto.");
      return a;
    });
    for (const g of product.grupos) {
      const count = extras.filter(
        (a) => String(a.grupo_id) === String(g.id),
      ).length;
      if (count < g.minimo || count > g.maximo)
        fail(`Selecione de ${g.minimo} a ${g.maximo} adicionais em ${g.nome}.`);
    }
    const unit = product.preco + extras.reduce((n, a) => n + a.preco, 0);
    subtotal += unit * item.quantidade;
    return { ...item, nome: product.nome, preco: product.preco, extras, unit };
  });
  const taxa_entrega =
    data.modalidade === "entrega" ? menu.loja.taxa_entrega : 0;
  const total = subtotal + taxa_entrega;
  if (!Number.isSafeInteger(total) || total > 10000000)
    fail("Pedido excede o limite permitido.");
  if (data.troco_para !== null && data.troco_para < total)
    fail("O valor para troco deve ser maior ou igual ao total.");
  return { itens, subtotal, taxa_entrega, total };
}
function message(loja, data, order) {
  const e = data.endereco;
  return [
    `🔔 NOVO PEDIDO #${String(order.numero).padStart(6, "0")}`,
    "",
    `Cliente: ${data.cliente.nome} - ${data.cliente.telefone}`,
    "",
    "Itens:",
    ...order.itens.map(
      (i) =>
        `${i.quantidade}x ${i.nome}${i.extras.length ? " (" + i.extras.map((a) => a.nome).join(", ") + ")" : ""} — ${brl(i.unit * i.quantidade)}${i.observacao ? " / Obs.: " + i.observacao : ""}`,
    ),
    "",
    `Subtotal: ${brl(order.subtotal)}`,
    ...(data.modalidade === "entrega"
      ? [`Taxa de Entrega: ${brl(order.taxa_entrega)}`]
      : []),
    `Total: ${brl(order.total)}`,
    "",
    `Tipo de Entrega: ${data.modalidade === "entrega" ? "Entrega em domicílio" : "Retirada no estabelecimento"}`,
    "",
    data.modalidade === "entrega"
      ? `Endereço: ${[e.rua, e.numero, e.bairro, e.complemento, e.referencia].filter(Boolean).join(", ")}`
      : `Retirada: No estabelecimento ${loja.nome}`,
    "",
    `Forma de Pagamento: ${{ dinheiro: "Dinheiro", pix: "Pix", cartao: "Cartão" }[data.forma_pagamento]}`,
    ...(data.troco_para != null
      ? [
          `Troco: ${brl(data.troco_para - order.total)} (para ${brl(data.troco_para)})`,
        ]
      : []),
    "",
    `Observações: ${data.observacoes || "Nenhuma"}`,
  ].join("\n");
}
async function createOrder(pool, slug, data) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    // Serializa pedidos da mesma loja e mantém contador e pedido na mesma transação.
    const {
      rows: [loja],
    } = await c.query(
      "SELECT * FROM estabelecimentos WHERE slug=$1 FOR UPDATE",
      [slug],
    );
    if (!loja) fail("Estabelecimento não encontrado.", 404);
    const subscription = await require("./billing").assertAccess(c, loja.id);
    const fingerprint = require("node:crypto")
      .createHash("sha256")
      .update(JSON.stringify(data))
      .digest("hex");
    if (data.idempotencia) {
      const {
        rows: [previous],
      } = await c.query(
        "SELECT requisicao_hash,resposta FROM pedidos WHERE estabelecimento_id=$1 AND idempotencia=$2",
        [loja.id, data.idempotencia],
      );
      if (previous) {
        if (previous.requisicao_hash !== fingerprint)
          fail(
            "A tentativa anterior tem outros dados. Confira o pedido antes de reenviar.",
            409,
          );
        await c.query("COMMIT");
        return previous.resposta;
      }
    }
    if (subscription.limite_pedidos_mes) {
      const {
        rows: [count],
      } = await c.query(
        "SELECT count(*)::int AS n FROM pedidos WHERE estabelecimento_id=$1 AND date_trunc('month',criado_em AT TIME ZONE 'America/Sao_Paulo')=date_trunc('month',now() AT TIME ZONE 'America/Sao_Paulo')",
        [loja.id],
      );
      if (count.n >= subscription.limite_pedidos_mes)
        fail(
          "Limite mensal de pedidos atingido. Contate o estabelecimento.",
          409,
        );
    }
    if (!subscription.adicionais && data.itens.some((i) => i.adicionais.length))
      fail("Adicionais não disponíveis no plano atual.");
    if (!loja.aberto) fail("Este estabelecimento está fechado.");
    if (loja[`${data.modalidade}_ativa`] === false)
      fail(
        data.modalidade === "entrega"
          ? "Este estabelecimento não está recebendo pedidos de entrega."
          : "Este estabelecimento não está recebendo pedidos de retirada.",
      );
    const result = calculate(data, await catalog(c, loja));
    const {
      rows: [cliente],
    } = await c.query(
      "INSERT INTO clientes(estabelecimento_id,nome,telefone) VALUES($1,$2,$3) ON CONFLICT(estabelecimento_id,telefone) DO UPDATE SET nome=EXCLUDED.nome RETURNING id",
      [loja.id, data.cliente.nome, data.cliente.telefone],
    );
    const numero = loja.proximo_numero;
    await c.query(
      "UPDATE estabelecimentos SET proximo_numero=proximo_numero+1 WHERE id=$1",
      [loja.id],
    );
    const e = data.endereco;
    const {
      rows: [pedido],
    } = await c.query(
      `INSERT INTO pedidos(estabelecimento_id,cliente_id,numero,modalidade,forma_pagamento,troco_para,subtotal,taxa_entrega,total,cliente_nome,cliente_telefone,observacoes,rua,numero_endereco,bairro,complemento,referencia) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
      [
        loja.id,
        cliente.id,
        numero,
        data.modalidade,
        data.forma_pagamento,
        data.troco_para,
        result.subtotal,
        result.taxa_entrega,
        result.total,
        data.cliente.nome,
        data.cliente.telefone,
        data.observacoes,
        e.rua,
        e.numero,
        e.bairro,
        e.complemento,
        e.referencia,
      ],
    );
    for (const i of result.itens) {
      const {
        rows: [saved],
      } = await c.query(
        "INSERT INTO itens_pedido(estabelecimento_id,pedido_id,produto_id,nome,preco,quantidade,observacao) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [
          loja.id,
          pedido.id,
          i.produto_id,
          i.nome,
          i.preco,
          i.quantidade,
          i.observacao,
        ],
      );
      for (const a of i.extras)
        await c.query(
          "INSERT INTO itens_pedido_adicionais(estabelecimento_id,item_pedido_id,adicional_id,nome,preco) VALUES($1,$2,$3,$4,$5)",
          [loja.id, saved.id, a.id, a.nome, a.preco],
        );
    }
    await c.query(
      "INSERT INTO historico_pedidos(estabelecimento_id,pedido_id,status) VALUES($1,$2,$3)",
      [loja.id, pedido.id, "pendente"],
    );
    const mensagem = message(loja, data, { ...result, numero });
    const response = {
      id: pedido.id,
      numero,
      total: result.total,
      mensagem,
      whatsapp_url: whatsappUrl(loja.whatsapp, mensagem),
    };
    if (data.idempotencia)
      await c.query(
        "UPDATE pedidos SET idempotencia=$2,requisicao_hash=$3,resposta=$4 WHERE id=$1",
        [pedido.id, data.idempotencia, fingerprint, JSON.stringify(response)],
      );
    await c.query("COMMIT");
    return response;
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}
function savedMessage(loja, p) {
  return message(
    loja,
    {
      ...p,
      cliente: { nome: p.cliente_nome, telefone: p.cliente_telefone },
      endereco: { ...p, numero: p.numero_endereco },
    },
    {
      ...p,
      itens: p.itens.map((i) => ({
        ...i,
        extras: i.adicionais,
        unit: i.preco + i.adicionais.reduce((sum, a) => sum + a.preco, 0),
      })),
    },
  );
}
module.exports = { calculate, createOrder, message, savedMessage, fail };
