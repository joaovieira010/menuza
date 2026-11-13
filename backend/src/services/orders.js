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
    `NOVO PEDIDO — ${loja.nome}`,
    `PEDIDO Nº ${String(order.numero).padStart(6, "0")}`,
    `CLIENTE: ${data.cliente.nome} / ${data.cliente.telefone}`,
    `ENDEREÇO: ${data.modalidade === "retirada" ? "Retirada no estabelecimento" : [e.rua, e.numero, e.bairro, e.complemento, e.referencia].filter(Boolean).join(", ")}`,
    "PRODUTOS: " +
      order.itens
        .map(
          (i) =>
            `${i.quantidade}x ${i.nome} — ${brl(i.unit * i.quantidade)}${i.extras.length ? " (" + i.extras.map((a) => a.nome + " + " + brl(a.preco)).join(", ") + ")" : ""}${i.observacao ? " / Obs.: " + i.observacao : ""}`,
        )
        .join("\n"),
    `PAGAMENTO: ${data.forma_pagamento}${data.troco_para !== null ? " | TROCO: " + brl(data.troco_para - order.total) + " (para " + brl(data.troco_para) + ")" : ""}`,
    `TAXA DE ENTREGA: ${brl(order.taxa_entrega)}`,
    `TOTAL: ${brl(order.total)}`,
    `OBSERVAÇÕES: ${data.observacoes || "Nenhuma"}`,
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
    if (!loja.aberto) fail("Este estabelecimento está fechado.");
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
    await c.query("COMMIT");
    return {
      id: pedido.id,
      numero,
      total: result.total,
      mensagem,
      whatsapp_url: `https://wa.me/${loja.whatsapp}?text=${encodeURIComponent(mensagem)}`,
    };
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}
module.exports = { calculate, createOrder, message, fail };
