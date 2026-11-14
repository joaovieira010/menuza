require("dotenv").config({ path: "backend/.env", quiet: true });
const target = process.env.TEST_DATABASE_URL;
if (
  !target ||
  !new URL(target).pathname.endsWith("_test") ||
  target === process.env.DATABASE_URL
)
  throw new Error("Banco exclusivo _test obrigatório.");
process.env.DATABASE_URL = target;
process.env.JWT_SECRET ||= require("node:crypto")
  .randomBytes(48)
  .toString("hex");
const request = require("supertest"),
  bcrypt = require("bcrypt"),
  crypto = require("node:crypto");
const app = require("../src/app"),
  pool = require("../src/database/pool"),
  migrate = require("../src/database/migrate");
const { reconcile, subscription } = require("../src/services/billing");
const owner = request.agent(app),
  store = request.agent(app),
  second = request.agent(app);
const secret = crypto.randomBytes(20).toString("hex"),
  ownerEmail = `owner-${Date.now()}@menuza.test`;
let planId, a, b, product, pedido, day, future, uid;
const body = (name, email) => ({
  nome: name,
  responsavel: "Responsável QA",
  email,
  telefone: "+55 (11) 99999-8888",
  admin_email: email,
  senha: secret,
  plano_id: planId,
  valor: 4990,
  vencimento: future,
});
const order = () => ({
  idempotencia: crypto.randomUUID(),
  cliente: { nome: "Cliente SaaS QA", telefone: "11988887777" },
  modalidade: "retirada",
  forma_pagamento: "pix",
  itens: [{ produto_id: product.id, quantidade: 1 }],
});
async function editSubscription(days, status = "active") {
  await pool.query(
    `UPDATE assinaturas SET vencimento=(now() AT TIME ZONE 'America/Sao_Paulo')::date+$2::integer,status=$3,suspensao_manual=false WHERE estabelecimento_id=$1`,
    [a.id, days, status],
  );
  await pool.query(
    "UPDATE estabelecimentos SET situacao='active' WHERE id=$1",
    [a.id],
  );
}
beforeAll(async () => {
  await migrate();
  const {
    rows: [dates],
  } = await pool.query(
    "SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date,'YYYY-MM-DD') AS hoje,to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date+30,'YYYY-MM-DD') AS futuro",
  );
  day = dates.hoje;
  future = dates.futuro;
  uid = (
    await pool.query(
      "INSERT INTO usuarios(email,senha_hash,papel) VALUES($1,$2,'SUPERADMIN') RETURNING id",
      [ownerEmail, await bcrypt.hash(secret, 12)],
    )
  ).rows[0].id;
  planId = (
    await pool.query(
      "INSERT INTO planos(nome,preco) VALUES($1,4990) RETURNING id",
      ["QA " + Date.now()],
    )
  ).rows[0].id;
}, 30000);
afterAll(async () => {
  await pool.end();
});
test("superadmin exige login e cookie de loja não é suficiente", async () => {
  expect((await request(app).get("/api/superadmin/lojas")).status).toBe(401);
  expect(
    (
      await owner
        .post("/api/superadmin/login")
        .send({ email: ownerEmail, senha: "invalida" })
    ).status,
  ).toBe(401);
  const r = await owner
    .post("/api/superadmin/login")
    .send({ email: ownerEmail, senha: secret });
  expect(r.status).toBe(200);
  expect(r.headers["set-cookie"][0]).toContain("menuza_platform=");
  expect((await owner.get("/api/admin/catalogo")).status).toBe(401);
});
test("cadastro transacional de duas empresas com slug automático e usuário", async () => {
  const ra = await owner.post("/api/superadmin/lojas").send({
    ...body("Loja A QA", `lojaa-${uid}@qa.test`),
    slug: "  ",
    admin_email: ` LOJAA-${uid}@QA.TEST `,
  });
  expect(ra.status).toBe(201);
  a = ra.body;
  const rb = await owner.post("/api/superadmin/lojas").send({
    ...body("Loja B QA", `lojab-${uid}@qa.test`),
    slug: `loja-b-${uid}`,
  });
  expect(rb.status).toBe(201);
  b = rb.body;
  expect(a.slug).not.toBe(b.slug);
  expect(
    (
      await pool.query(
        "SELECT telefone,whatsapp FROM estabelecimentos WHERE id=$1",
        [a.id],
      )
    ).rows[0],
  ).toEqual({ telefone: "5511999998888", whatsapp: "5511999998888" });
  expect(
    (
      await pool.query(
        "SELECT * FROM pagamentos WHERE estabelecimento_id=ANY($1::bigint[])",
        [[a.id, b.id]],
      )
    ).rowCount,
  ).toBe(0);
  expect((await subscription(pool, a.id)).valor).toBe(4990);
});
test("slugs reservados, inválidos, duplicados e e-mails duplicados não criam cadastros parciais", async () => {
  for (const slug of ["superadmin", "admin", "api", "!!!"])
    expect(
      (
        await owner
          .post("/api/superadmin/lojas")
          .send({ ...body("Inválida", "invalid@qa.test"), slug })
      ).status,
    ).toBe(400);
  expect(
    (
      await owner
        .post("/api/superadmin/lojas")
        .send({ ...body("Duplicada", "another@qa.test"), slug: b.slug })
    ).status,
  ).toBe(409);
  const r = await owner.post("/api/superadmin/lojas").send({
    ...body("Rollback", `lojaa-${uid}@qa.test`),
    slug: `rollback-${uid}`,
  });
  expect(r.status).toBe(409);
  expect(
    (
      await pool.query("SELECT id FROM estabelecimentos WHERE slug=$1", [
        `rollback-${uid}`,
      ])
    ).rowCount,
  ).toBe(0);
});
test("cadastro rejeita telefone e e-mail inválidos com campo identificado e sem escrita parcial", async () => {
  const before = (await pool.query("SELECT count(*) FROM estabelecimentos"))
    .rows[0].count;
  for (const invalid of [
    { telefone: "123" },
    { admin_email: "invalido" },
    { slug: "!!!" },
  ]) {
    const r = await owner
      .post("/api/superadmin/lojas")
      .send({ ...body("Inválida", "invalid-phone@qa.test"), ...invalid });
    expect(r.status).toBe(400);
    expect(r.body.erro).toContain(Object.keys(invalid)[0] + ":");
  }
  expect(
    (await pool.query("SELECT count(*) FROM estabelecimentos")).rows[0].count,
  ).toBe(before);
});
test("administradores acessam somente sua empresa e não o superadmin", async () => {
  expect(
    (
      await store
        .post("/api/admin/login")
        .send({ email: `lojaa-${uid}@qa.test`, senha: secret })
    ).status,
  ).toBe(200);
  expect(
    (
      await second
        .post("/api/admin/login")
        .send({ email: `lojab-${uid}@qa.test`, senha: secret })
    ).status,
  ).toBe(200);
  expect((await store.get("/api/superadmin/lojas")).status).toBe(401);
  const c = await store
    .post("/api/admin/categorias")
    .send({ nome: "Categoria A", estabelecimento_id: b.id });
  expect(c.status).toBe(201);
  expect(c.body.estabelecimento_id).toBe(a.id);
  const p = await store
    .post("/api/admin/produtos")
    .send({ nome: "Produto A", categoria_id: c.body.id, preco: 2100 });
  expect(p.status).toBe(201);
  product = p.body;
  expect(
    (
      await second
        .put("/api/admin/produtos/" + p.body.id)
        .send({ nome: "Invasão", categoria_id: c.body.id, preco: 1 })
    ).status,
  ).toBe(400);
  expect((await second.delete("/api/admin/produtos/" + p.body.id)).status).toBe(
    404,
  );
  expect((await second.get("/api/admin/catalogo")).body.produtos).toEqual([]);
  await store.put("/api/admin/configuracoes").send({
    nome: "Loja A QA",
    whatsapp: "11999998888",
    aberto: true,
    taxa_entrega: 500,
    cor_principal: "#7f3aed",
  });
});
test("catálogo público não expõe contatos comerciais nem dados da assinatura", async () => {
  const r = await request(app).get(`/api/${a.slug}/cardapio`);
  expect(r.status).toBe(200);
  expect(r.body.loja.email).toBeUndefined();
  expect(r.body.loja.responsavel).toBeUndefined();
  expect(r.body.loja.situacao).toBeUndefined();
  expect(r.body.loja.proximo_numero).toBeUndefined();
});
test("pedido idempotente concorrente grava uma vez e detecta corpo divergente", async () => {
  const d = order();
  const responses = await Promise.all(
    [1, 2].map(() => request(app).post(`/api/${a.slug}/pedidos`).send(d)),
  );
  expect(responses.map((r) => r.status)).toEqual([201, 201]);
  expect(responses[0].body.id).toBe(responses[1].body.id);
  pedido = responses[0].body;
  expect(
    (
      await pool.query("SELECT id FROM pedidos WHERE estabelecimento_id=$1", [
        a.id,
      ])
    ).rowCount,
  ).toBe(1);
  expect(pedido.mensagem).toContain("Subtotal:");
  expect(
    (
      await request(app)
        .post(`/api/${a.slug}/pedidos`)
        .send({ ...d, observacoes: "alterado" })
    ).status,
  ).toBe(409);
  expect((await second.get("/api/admin/pedidos")).body).toEqual([]);
});
test("assinatura passa a pending no vencimento e past_due em três dias", async () => {
  await editSubscription(0);
  await reconcile();
  expect((await subscription(pool, a.id)).status).toBe("pending");
  expect((await store.get("/api/admin/catalogo")).status).toBe(200);
  await editSubscription(-3);
  await reconcile();
  expect((await subscription(pool, a.id)).status).toBe("past_due");
  const reminders = await pool.query(
    "SELECT id FROM lembretes_cobranca WHERE estabelecimento_id=$1",
    [a.id],
  );
  expect(reminders.rowCount).toBe(1);
  await reconcile();
  expect(
    (
      await pool.query(
        "SELECT id FROM lembretes_cobranca WHERE estabelecimento_id=$1",
        [a.id],
      )
    ).rowCount,
  ).toBe(1);
});
test("suspensão em sete dias bloqueia backend mesmo sem executar rotina e preserva pedido", async () => {
  await editSubscription(-7);
  expect((await request(app).get(`/api/${a.slug}/cardapio`)).status).toBe(423);
  expect(
    (await request(app).post(`/api/${a.slug}/pedidos`).send(order())).status,
  ).toBe(423);
  expect(
    (await store.post("/api/admin/categorias").send({ nome: "Não permitido" }))
      .status,
  ).toBe(423);
  expect(
    (
      await pool.query(
        "SELECT id FROM pedidos WHERE estabelecimento_id=$1 AND id=$2",
        [a.id, pedido.id],
      )
    ).rowCount,
  ).toBe(1);
  expect((await request(app).get(`/api/${b.slug}/cardapio`)).status).toBe(200);
  await reconcile();
  expect((await subscription(pool, a.id)).status).toBe("suspended");
});
test("pagamento exige confirmação, valor de quitação e datas válidas", async () => {
  const p = {
    valor: 4990,
    pago_em: day,
    referencia: "PIX-QA",
    proximo_vencimento: future,
  };
  expect(
    (await owner.post(`/api/superadmin/lojas/${a.id}/pagamentos`).send(p))
      .status,
  ).toBe(400);
  expect(
    (
      await owner
        .post(`/api/superadmin/lojas/${a.id}/pagamentos`)
        .send({ ...p, confirmado: true, valor: 10 })
    ).status,
  ).toBe(400);
  expect(
    (
      await owner
        .post(`/api/superadmin/lojas/${a.id}/pagamentos`)
        .send({ ...p, confirmado: true, proximo_vencimento: day })
    ).status,
  ).toBe(400);
  expect(
    (
      await pool.query(
        "SELECT id FROM pagamentos WHERE estabelecimento_id=$1",
        [a.id],
      )
    ).rowCount,
  ).toBe(0);
});
test("pagamento confirmado reativa suspensão automática e referência não duplica recebimento", async () => {
  const p = {
    valor: 4990,
    pago_em: day,
    referencia: "PIX-QA",
    proximo_vencimento: future,
    confirmado: true,
  };
  expect(
    (await owner.post(`/api/superadmin/lojas/${a.id}/pagamentos`).send(p))
      .status,
  ).toBe(201);
  expect((await subscription(pool, a.id)).efetivo).toBe("active");
  expect((await store.get("/api/admin/pedidos")).body[0].id).toBe(pedido.id);
  expect(
    (await owner.post(`/api/superadmin/lojas/${a.id}/pagamentos`).send(p))
      .status,
  ).toBe(409);
  const h = await owner.get(`/api/superadmin/lojas/${a.id}/historico`);
  expect(h.body.pagamentos.length).toBe(1);
  expect(h.body.historico.some((e) => e.acao === "pagamento.confirmado")).toBe(
    true,
  );
});
test("suspensão manual revoga sessão e exige reativação explícita", async () => {
  expect(
    (
      await owner
        .post(`/api/superadmin/lojas/${a.id}/situacao`)
        .send({ acao: "suspender", observacao: "Teste de suspensão" })
    ).status,
  ).toBe(200);
  expect((await store.get("/api/admin/me")).status).toBe(401);
  expect((await subscription(pool, a.id)).efetivo).toBe("suspended");
  expect(
    (
      await owner
        .post(`/api/superadmin/lojas/${a.id}/situacao`)
        .send({ acao: "reativar", observacao: "Pagamento conferido" })
    ).status,
  ).toBe(200);
  expect(
    (
      await store
        .post("/api/admin/login")
        .send({ email: `lojaa-${uid}@qa.test`, senha: secret })
    ).status,
  ).toBe(200);
});
test("limite de produtos resiste a cadastros concorrentes", async () => {
  await pool.query("UPDATE planos SET limite_produtos=2 WHERE id=$1", [planId]);
  const r = await Promise.all(
    [1, 2].map((n) =>
      store.post("/api/admin/produtos").send({
        nome: "Limite " + n,
        categoria_id: product.categoria_id,
        preco: 100,
      }),
    ),
  );
  expect(r.map((x) => x.status).sort()).toEqual([201, 409]);
  await pool.query(
    "UPDATE planos SET limite_produtos=NULL,limite_pedidos_mes=1,adicionais=false WHERE id=$1",
    [planId],
  );
  expect(
    (await request(app).post(`/api/${a.slug}/pedidos`).send(order())).status,
  ).toBe(409);
  expect(
    (
      await store
        .post("/api/admin/grupos")
        .send({ nome: "Não permitido", produto_id: product.id })
    ).status,
  ).toBe(403);
  await pool.query(
    "UPDATE planos SET limite_pedidos_mes=NULL,adicionais=true WHERE id=$1",
    [planId],
  );
});
test("upload decodifica imagem real, rejeita arquivo truncado e remove metadados", async () => {
  const sharp = require("sharp");
  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#7f3aed" },
  })
    .png()
    .toBuffer();
  const valid = await store
    .post("/api/admin/upload")
    .attach("imagem", png, { filename: "foto.png", contentType: "image/png" });
  expect(valid.status).toBe(201);
  expect(valid.body.url).toMatch(/\.webp$/);
  const invalid = await store
    .post("/api/admin/upload")
    .attach("imagem", png.subarray(0, 12), {
      filename: "foto.png",
      contentType: "image/png",
    });
  expect(invalid.status).toBe(400);
  const decoded = await request(app).get(valid.body.url);
  expect(decoded.status).toBe(200);
  expect((await sharp(decoded.body).metadata()).format).toBe("webp");
});
test("alteração de slug mantém pedido associado à mesma empresa", async () => {
  const newSlug = "novo-endereco-" + uid;
  expect(
    (
      await owner.put("/api/superadmin/lojas/" + a.id).send({
        ...body("Loja A QA", `lojaa-${uid}@qa.test`),
        senha: undefined,
        slug: newSlug,
      })
    ).status,
  ).toBe(200);
  expect((await request(app).get(`/api/${a.slug}/cardapio`)).status).toBe(404);
  expect(
    (await request(app).get(`/api/${newSlug}/cardapio`)).body.loja.id,
  ).toBe(a.id);
  a.slug = newSlug;
  expect(
    (
      await pool.query("SELECT estabelecimento_id FROM pedidos WHERE id=$1", [
        pedido.id,
      ])
    ).rows[0].estabelecimento_id,
  ).toBe(a.id);
});
test("arquivar preserva registros financeiros e pedidos, cancela acesso", async () => {
  expect(
    (
      await owner
        .post(`/api/superadmin/lojas/${a.id}/situacao`)
        .send({ acao: "arquivar", observacao: "Encerramento QA" })
    ).status,
  ).toBe(200);
  expect((await request(app).get(`/api/${a.slug}/cardapio`)).status).toBe(423);
  const h = await owner.get(`/api/superadmin/lojas/${a.id}/historico`);
  expect(h.body.pagamentos.length).toBe(1);
  expect(h.body.assinatura.status).toBe("canceled");
  expect(
    (
      await pool.query("SELECT id FROM pedidos WHERE estabelecimento_id=$1", [
        a.id,
      ])
    ).rowCount,
  ).toBe(1);
});
test("contato comercial persiste no banco e só superadmin consulta", async () => {
  const d = {
    nome: "Interessado QA",
    estabelecimento: "Negócio QA",
    email: "interesse@qa.test",
    telefone: "11999998888",
    consentimento: true,
    tipo_negocio: "Doceria & café",
    cidade: "São José / SC",
    mensagem: "Quero a Menuza #piloto",
  };
  const contact = await request(app).post("/api/public/contato").send(d);
  expect(contact.status).toBe(201);
  const url = new URL(contact.body.whatsapp_url);
  expect(url.origin).toBe("https://wa.me");
  expect(url.pathname).toBe("/5548988780394");
  for (const v of [
    d.nome,
    d.estabelecimento,
    d.tipo_negocio,
    d.cidade,
    d.mensagem,
  ])
    expect(url.searchParams.get("text")).toContain(v);
  expect(
    (
      await request(app)
        .post("/api/public/contato")
        .send({ ...d, telefone: "0000000000" })
    ).status,
  ).toBe(400);
  expect(
    (
      await request(app)
        .post("/api/public/contato")
        .send({ ...d, consentimento: false })
    ).status,
  ).toBe(400);
  const r = await owner.get("/api/superadmin/interesses");
  expect(
    r.body.some(
      (x) =>
        x.email === d.email &&
        x.tipo_negocio === d.tipo_negocio &&
        x.cidade === d.cidade &&
        x.mensagem === d.mensagem,
    ),
  ).toBe(true);
  const longContact = await request(app)
    .post("/api/public/contato")
    .send({
      ...d,
      mensagem: "á".repeat(1000),
      tipo_negocio: "T".repeat(120),
      cidade: "C".repeat(120),
    });
  expect(longContact.status).toBe(201);
  expect(
    new URL(longContact.body.whatsapp_url).searchParams.get("text"),
  ).toContain("á".repeat(1000));
  expect((await second.get("/api/superadmin/interesses")).status).toBe(401);
  expect((await owner.get("/api/superadmin/dashboard")).status).toBe(200);
});
test("logout revoga token copiado, sem depender apenas de apagar cookie", async () => {
  const login = await owner
    .post("/api/superadmin/login")
    .send({ email: ownerEmail, senha: secret });
  const cookie = login.headers["set-cookie"][0].split(";")[0];
  expect(
    (await request(app).get("/api/superadmin/me").set("Cookie", cookie)).status,
  ).toBe(200);
  await owner.post("/api/superadmin/logout");
  expect(
    (await request(app).get("/api/superadmin/me").set("Cookie", cookie)).status,
  ).toBe(401);
});
test("planos e política podem ser configurados pela API, sem reajustar contrato existente", async () => {
  await owner
    .post("/api/superadmin/login")
    .send({ email: ownerEmail, senha: secret });
  const current = (await owner.get("/api/superadmin/planos")).body.find(
    (p) => p.id === planId,
  );
  expect(
    (
      await owner
        .put("/api/superadmin/planos/" + planId)
        .send({ ...current, preco: 7990 })
    ).status,
  ).toBe(200);
  expect((await subscription(pool, b.id)).valor).toBe(4990);
  expect(
    (await request(app).get("/api/public/planos")).body.find(
      (p) => p.id === planId,
    ).preco,
  ).toBe(7990);
  const policy = (await owner.get("/api/superadmin/politica")).body;
  expect(
    (
      await owner
        .put("/api/superadmin/politica")
        .send({ ...policy, lembrete_dias: 9, suspender_dias: 2 })
    ).status,
  ).toBe(400);
  expect(
    (
      await owner
        .put("/api/superadmin/politica")
        .send({ ...policy, reativar_automaticamente: false })
    ).status,
  ).toBe(200);
  await pool.query(
    "UPDATE assinaturas SET vencimento=(now() AT TIME ZONE 'America/Sao_Paulo')::date-7 WHERE estabelecimento_id=$1",
    [b.id],
  );
  const r = await owner.post(`/api/superadmin/lojas/${b.id}/pagamentos`).send({
    valor: 4990,
    pago_em: day,
    referencia: "PIX-MANUAL-B",
    proximo_vencimento: future,
    confirmado: true,
  });
  expect(r.status).toBe(201);
  expect((await subscription(pool, b.id)).efetivo).toBe("suspended");
  expect((await second.get("/api/admin/catalogo")).status).toBe(423);
  expect(
    (
      await owner
        .post(`/api/superadmin/lojas/${b.id}/situacao`)
        .send({ acao: "reativar", observacao: "Reativação manual conferida" })
    ).status,
  ).toBe(200);
  expect(
    (await owner.put("/api/superadmin/politica").send(policy)).status,
  ).toBe(200);
});
test("execução de cobrança sobreposta é recusada pelo PostgreSQL", async () => {
  const c = await pool.connect();
  try {
    await c.query("SELECT pg_advisory_lock(728194)");
    expect(await reconcile()).toEqual({ skipped: true });
  } finally {
    await c.query("SELECT pg_advisory_unlock(728194)");
    c.release();
  }
});
test("sessão expirada no banco é recusada mesmo com JWT ainda válido", async () => {
  await pool.query(
    "UPDATE sessoes SET expira_em=now()-interval '1 second' WHERE usuario_id IN (SELECT id FROM usuarios WHERE estabelecimento_id=$1)",
    [b.id],
  );
  expect((await second.get("/api/admin/me")).status).toBe(401);
});
test("quitação de débito em assinatura cancelada não restaura o contrato implicitamente", async () => {
  expect(
    (
      await owner
        .post(`/api/superadmin/lojas/${b.id}/situacao`)
        .send({ acao: "cancelar", observacao: "Encerramento com débito" })
    ).status,
  ).toBe(200);
  const {
    rows: [dates],
  } = await pool.query(
    "SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date+60,'YYYY-MM-DD') AS futuro",
  );
  expect(
    (
      await owner.post(`/api/superadmin/lojas/${b.id}/pagamentos`).send({
        valor: 4990,
        pago_em: day,
        referencia: "PIX-CANCELADA",
        proximo_vencimento: dates.futuro,
        confirmado: true,
      })
    ).status,
  ).toBe(201);
  expect((await subscription(pool, b.id)).efetivo).toBe("canceled");
  expect((await request(app).get(`/api/${b.slug}/cardapio`)).status).toBe(423);
});
test("plano retirado da venda mantém contratos existentes editáveis", async () => {
  const p = (await owner.get("/api/superadmin/planos")).body.find(
    (p) => p.id === planId,
  );
  expect(
    (
      await owner
        .put("/api/superadmin/planos/" + planId)
        .send({ ...p, ativo: false })
    ).status,
  ).toBe(200);
  expect(
    (
      await owner
        .post("/api/superadmin/lojas")
        .send(body("Plano indisponível", "indisponivel@qa.test"))
    ).status,
  ).toBe(400);
  expect(
    (
      await owner.put("/api/superadmin/lojas/" + b.id).send({
        ...body("Loja B QA", `lojab-${uid}@qa.test`),
        senha: undefined,
        slug: b.slug,
      })
    ).status,
  ).toBe(200);
});

test("três estabelecimentos isolados recebem pedidos simultâneos", async () => {
  const plan = await owner.post("/api/superadmin/planos").send({
    nome: "Piloto isolado " + crypto.randomUUID(),
    preco: 4990,
    adicionais: true,
    personalizacao: true,
  });
  expect(plan.status).toBe(201);
  const tenants = [];
  for (let n = 1; n <= 3; n++) {
    const email = `piloto-${n}-${crypto.randomUUID()}@qa.test`;
    const r = await owner
      .post("/api/superadmin/lojas")
      .send({ ...body(`Piloto QA ${n}`, email), plano_id: plan.body.id });
    expect(r.status).toBe(201);
    const agent = request.agent(app);
    expect(
      (await agent.post("/api/admin/login").send({ email, senha: secret }))
        .status,
    ).toBe(200);
    const category = await agent
      .post("/api/admin/categorias")
      .send({ nome: `Categoria ${n}` });
    expect(category.status).toBe(201);
    const product = await agent.post("/api/admin/produtos").send({
      nome: `Produto ${n}`,
      categoria_id: category.body.id,
      preco: n * 1000,
    });
    expect(product.status).toBe(201);
    expect(
      (
        await agent.put("/api/admin/configuracoes").send({
          nome: `Piloto QA ${n}`,
          whatsapp: `1199999888${n}`,
          aberto: true,
          taxa_entrega: 500,
          cor_principal: "#7f3aed",
        })
      ).status,
    ).toBe(200);
    tenants.push({
      ...r.body,
      agent,
      product: product.body,
      phone: `551199999888${n}`,
    });
  }
  const responses = await Promise.all(
    tenants.map((t) =>
      request(app)
        .post(`/api/${t.slug}/pedidos`)
        .send({
          ...order(),
          itens: [{ produto_id: t.product.id, quantidade: 2 }],
        }),
    ),
  );
  expect(responses.map((r) => r.status)).toEqual([201, 201, 201]);
  expect(new Set(responses.map((r) => r.body.id)).size).toBe(3);
  for (const [n, t] of tenants.entries()) {
    const response = responses[n].body;
    expect(response.total).toBe((n + 1) * 2000);
    expect(Number(response.numero)).toBe(1);
    expect(new URL(response.whatsapp_url).pathname).toBe("/" + t.phone);
    const own = (await t.agent.get("/api/admin/pedidos")).body;
    expect(own).toHaveLength(1);
    expect(own[0].id).toBe(response.id);
    expect(own[0].estabelecimento_id).toBe(t.id);
    const foreign = responses[(n + 1) % 3].body;
    expect(
      (
        await t.agent
          .patch(`/api/admin/pedidos/${foreign.id}/status`)
          .send({ status: "confirmado" })
      ).status,
    ).toBe(404);
  }
});
