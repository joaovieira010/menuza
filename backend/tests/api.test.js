const dotenv = require("dotenv");
dotenv.config({ path: "backend/.env", quiet: true });
const target = process.env.TEST_DATABASE_URL;
if (!target)
  throw new Error(
    "Defina TEST_DATABASE_URL para um banco descartável com nome terminando em _test.",
  );
const url = new URL(target);
if (!url.pathname.endsWith("_test") || target === process.env.DATABASE_URL)
  throw new Error("Teste exige um banco separado terminado em _test.");
process.env.DATABASE_URL = target;
process.env.JWT_SECRET ||= require("node:crypto")
  .randomBytes(48)
  .toString("hex");
const request = require("supertest");
const app = require("../src/app"),
  pool = require("../src/database/pool"),
  migrate = require("../src/database/migrate"),
  orderFixtures = require("./helpers/order-fixtures");
const password = require("node:crypto").randomBytes(20).toString("hex");
const agent = request.agent(app);
let a, b, aMenu, bMenu, created;
const order = (pid) => ({
  cliente: { nome: "Ana Teste", telefone: "11999998888" },
  modalidade: "retirada",
  forma_pagamento: "pix",
  total: 1,
  itens: [{ produto_id: pid, quantidade: 2, preco: 1, adicionais: [] }],
});
beforeAll(async () => {
  const {
    rows: [db],
  } = await pool.query("SELECT current_database() AS nome");
  if (!db.nome.endsWith("_test")) throw new Error("Banco inseguro para testes");
  await migrate();
  // Somente o banco explicitamente descartável é limpo; nunca usa DATABASE_URL de desenvolvimento.
  await pool.query("TRUNCATE estabelecimentos RESTART IDENTITY CASCADE");
  await orderFixtures(pool, password);
  aMenu = (await request(app).get("/api/hamburgueria-demo/cardapio")).body;
  bMenu = (await request(app).get("/api/doces-demo/cardapio")).body;
  a = aMenu.produtos[0];
  b = bMenu.produtos[0];
}, 30000);
afterAll(() => pool.end());
test("cardápios são distintos e não expõem contador nem usuários", () => {
  expect(aMenu.loja.nome).toBe("Hamburguer Demo");
  expect(bMenu.loja.nome).toBe("Doces Demo");
  expect(aMenu.produtos.some((p) => p.id === b.id)).toBe(false);
  expect(aMenu.loja.proximo_numero).toBeUndefined();
  expect(aMenu.usuarios).toBeUndefined();
});
test("painel exige autenticação, credenciais inválidas não entram", async () => {
  expect((await request(app).get("/api/admin/catalogo")).status).toBe(401);
  expect(
    (
      await agent
        .post("/api/admin/login")
        .send({ email: "admin@hamburguer.demo", senha: "incorreta" })
    ).status,
  ).toBe(401);
  expect(
    (
      await agent
        .post("/api/admin/login")
        .send({ email: "invalido", senha: "x" })
    ).status,
  ).toBe(400);
});
test("login gera cookie httpOnly SameSite e isola catálogo", async () => {
  const r = await agent
    .post("/api/admin/login")
    .send({ email: "admin@hamburguer.demo", senha: password });
  expect(r.status).toBe(200);
  expect(r.headers["set-cookie"][0]).toMatch(/HttpOnly/);
  expect(r.headers["set-cookie"][0]).toMatch(/SameSite=Strict/);
  const own = await agent.get("/api/admin/catalogo");
  expect(own.body.produtos.some((p) => p.id === b.id)).toBe(false);
});
test("impede editar, remover e vincular produto de outra loja", async () => {
  const data = {
    nome: "Ataque",
    categoria_id: Number(b.categoria_id),
    preco: 1,
  };
  expect(
    (await agent.put("/api/admin/produtos/" + b.id).send(data)).status,
  ).toBe(400);
  expect((await agent.delete("/api/admin/produtos/" + b.id)).status).toBe(404);
  expect((await agent.post("/api/admin/produtos").send(data)).status).toBe(400);
  const unchanged = (await request(app).get("/api/doces-demo/cardapio")).body;
  expect(unchanged.produtos[0].nome).toBe(b.nome);
});
test("pedido recalcula preço adulterado e só depois devolve WhatsApp", async () => {
  const r = await request(app)
    .post("/api/hamburgueria-demo/pedidos")
    .send(order(a.id));
  expect(r.status).toBe(201);
  expect(r.body.total).toBe(a.preco * 2);
  expect(Number(r.body.numero)).toBe(1);
  expect(r.body.whatsapp_url).toMatch(/^https:\/\/wa.me\/55/);
  created = r.body;
  const {
    rows: [p],
  } = await pool.query(
    "SELECT * FROM pedidos WHERE estabelecimento_id=$1 AND id=$2",
    [a.estabelecimento_id, r.body.id],
  );
  expect(p.total).toBe(a.preco * 2);
});
test("sequência independente por loja e concorrência sem duplicatas", async () => {
  const r = await request(app)
    .post("/api/doces-demo/pedidos")
    .send(order(b.id));
  expect(Number(r.body.numero)).toBe(1);
  const concurrent = await Promise.all(
    [1, 2, 3].map(() =>
      request(app).post("/api/hamburgueria-demo/pedidos").send(order(a.id)),
    ),
  );
  expect(concurrent.every((r) => r.status === 201)).toBe(true);
  expect(concurrent.map((r) => Number(r.body.numero)).sort()).toEqual([
    2, 3, 4,
  ]);
});
test("rejeita produtos/adicionais de outra loja e faz rollback do contador", async () => {
  expect(
    (
      await request(app)
        .post("/api/hamburgueria-demo/pedidos")
        .send(order(b.id))
    ).status,
  ).toBe(400);
  const d = order(a.id);
  d.itens[0].adicionais = [Number(b.grupos[0].adicionais[0].id)];
  expect(
    (await request(app).post("/api/hamburgueria-demo/pedidos").send(d)).status,
  ).toBe(400);
  const r = await request(app)
    .post("/api/hamburgueria-demo/pedidos")
    .send(order(a.id));
  expect(Number(r.body.numero)).toBe(5);
});
test("cliente e itens inválidos são rejeitados", async () => {
  const d = order(a.id);
  d.itens[0].quantidade = 0;
  expect(
    (await request(app).post("/api/hamburgueria-demo/pedidos").send(d)).status,
  ).toBe(400);
  d.itens[0].quantidade = 1;
  d.cliente.telefone = "123";
  expect(
    (await request(app).post("/api/hamburgueria-demo/pedidos").send(d)).status,
  ).toBe(400);
});
test("pedido aparece no painel, avança status e registra histórico", async () => {
  const rows = (await agent.get("/api/admin/pedidos")).body;
  expect(rows.some((p) => p.id === created.id)).toBe(true);
  expect(rows.every((p) => p.estabelecimento_id === a.estabelecimento_id)).toBe(
    true,
  );
  expect(
    (
      await agent
        .patch("/api/admin/pedidos/" + created.id + "/status")
        .send({ status: "concluido" })
    ).status,
  ).toBe(400);
  for (const status of ["confirmado", "em_preparacao", "pronto", "concluido"])
    expect(
      (
        await agent
          .patch("/api/admin/pedidos/" + created.id + "/status")
          .send({ status })
      ).status,
    ).toBe(200);
  const p = (await agent.get("/api/admin/pedidos")).body.find(
    (p) => p.id === created.id,
  );
  expect(p.historico).toHaveLength(5);
  expect(
    p.historico
      .slice(1)
      .every(
        (h) => h.usuario_id && h.usuario_email === "admin@hamburguer.demo",
      ),
  ).toBe(true);
});
test("loja A não muda status de pedido da B nem usa filtros inválidos", async () => {
  const {
    rows: [p],
  } = await pool.query(
    "SELECT id FROM pedidos WHERE estabelecimento_id=$1 LIMIT 1",
    [b.estabelecimento_id],
  );
  expect(
    (
      await agent
        .patch("/api/admin/pedidos/" + p.id + "/status")
        .send({ status: "confirmado" })
    ).status,
  ).toBe(404);
  expect((await agent.get("/api/admin/pedidos?inicio=nao-e-data")).status).toBe(
    400,
  );
});
test("CRUD cria e atualiza categoria/produto/grupo/adicional com isolamento", async () => {
  const c = await agent
    .post("/api/admin/categorias")
    .send({ nome: "Nova categoria" });
  expect(c.status).toBe(201);
  const p = await agent.post("/api/admin/produtos").send({
    nome: "Novo produto",
    categoria_id: Number(c.body.id),
    preco: 1234,
  });
  expect(p.status).toBe(201);
  const g = await agent.post("/api/admin/grupos").send({
    nome: "Escolha",
    produto_id: Number(p.body.id),
    minimo: 0,
    maximo: 1,
  });
  expect(g.status).toBe(201);
  const extra = await agent
    .post("/api/admin/adicionais")
    .send({ nome: "Opção", grupo_id: Number(g.body.id), preco: 150 });
  expect(extra.status).toBe(201);
  expect(
    (
      await agent.put("/api/admin/produtos/" + p.body.id).send({
        nome: "Atualizado",
        categoria_id: Number(c.body.id),
        preco: 1500,
      })
    ).status,
  ).toBe(200);
  expect((await agent.delete("/api/admin/produtos/" + p.body.id)).status).toBe(
    200,
  );
  expect(
    (await agent.get("/api/admin/catalogo")).body.produtos.find(
      (r) => r.id === p.body.id,
    ).ativo,
  ).toBe(false);
});
test("CORS, upload disfarçado, tamanho e MIME são validados", async () => {
  expect(
    (
      await agent
        .post("/api/admin/upload")
        .set("Origin", "https://invasor.example")
    ).status,
  ).toBe(403);
  expect(
    (
      await agent
        .post("/api/admin/upload")
        .attach("imagem", Buffer.from("<script>alert(1)</script>"), {
          filename: "foto.png",
          contentType: "image/png",
        })
    ).status,
  ).toBe(400);
  expect(
    (
      await agent
        .post("/api/admin/upload")
        .attach("imagem", Buffer.alloc(2 * 1024 * 1024 + 1), {
          filename: "foto.png",
          contentType: "image/png",
        })
    ).status,
  ).toBe(400);
});
test("mensagens do painel usam snapshots e WhatsApp da própria loja", async () => {
  const rows = (await agent.get("/api/admin/pedidos")).body;
  const p = rows.find((p) => p.id === created.id);
  expect(p.whatsapp_url).toMatch(/^https:\/\/wa.me\/5511999999999\?text=/);
  expect(new URL(p.whatsapp_url).searchParams.get("text")).toBe(p.mensagem);
  expect(p.mensagem).toContain("🔔 NOVO PEDIDO #000001");
  expect(p.mensagem).toContain("Retirada: No estabelecimento");
  expect(p.mensagem).not.toContain("Taxa de Entrega:");
  expect(p.mensagem).toContain("Observações: Nenhuma");
});

test("snapshots preservam nomes, opções e preços após alteração do catálogo", async () => {
  const before = (await agent.get("/api/admin/pedidos")).body.find(
    (p) => p.id === created.id,
  );
  try {
    await pool.query(
      "UPDATE produtos SET nome='Nome alterado no catálogo',preco=1 WHERE estabelecimento_id=$1 AND id=$2",
      [a.estabelecimento_id, a.id],
    );
    const after = (await agent.get("/api/admin/pedidos")).body.find(
      (p) => p.id === created.id,
    );
    expect(after.mensagem).toBe(before.mensagem);
    expect(after.total).toBe(before.total);
    expect(
      (await agent.post(`/api/admin/pedidos/${created.id}/whatsapp`)).status,
    ).toBe(400);
  } finally {
    await pool.query(
      "UPDATE produtos SET nome=$3,preco=$4 WHERE estabelecimento_id=$1 AND id=$2",
      [a.estabelecimento_id, a.id, a.nome, a.preco],
    );
  }
});

test("status concorrente e abertura repetida geram um evento e um link", async () => {
  const r = await request(app)
    .post("/api/hamburgueria-demo/pedidos")
    .send(order(a.id));
  const pid = r.body.id;
  const endpoint = `/api/admin/pedidos/${pid}/status`;
  const responses = await Promise.all(
    [1, 2].map(() => agent.patch(endpoint).send({ status: "confirmado" })),
  );
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect(responses.filter((r) => r.body.repetido)).toHaveLength(1);
  for (const status of ["em_preparacao", "pronto"])
    expect((await agent.patch(endpoint).send({ status })).status).toBe(200);
  let p = (await agent.get("/api/admin/pedidos")).body.find(
    (p) => p.id === pid,
  );
  expect(p.historico).toHaveLength(4);
  expect(p.notificacao.mensagem).toContain("pronto para retirada!");
  expect(p.proximos_status).toEqual(["concluido", "cancelado"]);
  expect(
    (await agent.patch(endpoint).send({ status: "saiu_para_entrega" })).status,
  ).toBe(400);
  const links = await Promise.all(
    [1, 2].map(() =>
      agent
        .post(`/api/admin/pedidos/${pid}/whatsapp`)
        .send({ historico_id: p.notificacao.id }),
    ),
  );
  expect(links.map((r) => r.status).sort()).toEqual([200, 409]);
  const link = links.find((r) => r.status === 200).body;
  expect(new URL(link.whatsapp_url).pathname).toBe("/5511999998888");
  expect(new URL(link.whatsapp_url).searchParams.get("text")).toBe(
    p.notificacao.mensagem,
  );
  p = (await agent.get("/api/admin/pedidos")).body.find((p) => p.id === pid);
  expect(p.notificacao.aberto_em).toBeTruthy();
  expect(p.historico).toHaveLength(4);
  expect(
    (await agent.patch(endpoint).send({ status: "cancelado" })).status,
  ).toBe(200);
  expect(
    (
      await agent
        .post(`/api/admin/pedidos/${pid}/whatsapp`)
        .send({ historico_id: p.notificacao.id })
    ).status,
  ).toBe(409);
  p = (await agent.get("/api/admin/pedidos")).body.find((p) => p.id === pid);
  expect(p.notificacao.mensagem).toContain("foi cancelado.");
  expect((await agent.patch(endpoint).send({ status: "pronto" })).status).toBe(
    400,
  );
});

test("entrega passa por pronto e saída; mantém adicionais e bloqueia ações sem permissão", async () => {
  const d = order(a.id);
  d.modalidade = "entrega";
  d.endereco = { rua: "Rua São João", numero: "104", bairro: "Rosário" };
  d.itens[0].adicionais = a.grupos[0].adicionais.map((x) => x.id);
  d.itens.push({ ...d.itens[0], quantidade: 1, observacao: "Sem gelo" });
  d.observacoes = "Portão azul & campainha #2";
  const r = await request(app).post("/api/hamburgueria-demo/pedidos").send(d);
  expect(r.status).toBe(201);
  expect(r.body.total).toBe(3 * (a.preco + 400) + 500);
  expect(r.body.mensagem).toContain(
    "2x Aprox: 250 ml (Creme de Maracujá, Laranja)",
  );
  expect(r.body.mensagem).toContain("1x Aprox: 250 ml");
  expect(r.body.mensagem).toContain("Endereço: Rua São João, 104, Rosário");
  expect(r.body.mensagem).toContain("Taxa de Entrega:");
  const path = `/api/admin/pedidos/${r.body.id}`;
  expect(
    (
      await request(app)
        .patch(path + "/status")
        .send({ status: "confirmado" })
    ).status,
  ).toBe(401);
  expect(
    (
      await request(app)
        .post(path + "/whatsapp")
        .send({ historico_id: 1 })
    ).status,
  ).toBe(401);
  for (const status of ["confirmado", "em_preparacao", "pronto"])
    expect((await agent.patch(path + "/status").send({ status })).status).toBe(
      200,
    );
  expect(
    (await agent.patch(path + "/status").send({ status: "concluido" })).status,
  ).toBe(400);
  let p = (await agent.get("/api/admin/pedidos")).body.find(
    (p) => p.id === r.body.id,
  );
  expect(p.notificacao.mensagem).toContain("está pronto!");
  const oldEvent = p.notificacao.id;
  expect(
    (
      await agent
        .patch(path + "/status")
        .send({ status: "saiu_para_entrega", status_anterior: "confirmado" })
    ).status,
  ).toBe(400);
  expect(
    (await agent.patch(path + "/status").send({ status: "saiu_para_entrega" }))
      .status,
  ).toBe(200);
  expect(
    (await agent.post(path + "/whatsapp").send({ historico_id: oldEvent }))
      .status,
  ).toBe(409);
  p = (await agent.get("/api/admin/pedidos")).body.find(
    (p) => p.id === r.body.id,
  );
  expect(p.notificacao.mensagem).toContain("saiu para entrega!");
  const other = request.agent(app);
  await other
    .post("/api/admin/login")
    .send({ email: "admin@doces.demo", senha: password });
  expect(
    (await other.get("/api/admin/pedidos")).body.some((x) => x.id === p.id),
  ).toBe(false);
  expect(
    (
      await other
        .post(path + "/whatsapp")
        .send({ historico_id: p.notificacao.id })
    ).status,
  ).toBe(404);
  expect(
    (await other.patch(path + "/status").send({ status: "cancelado" })).status,
  ).toBe(404);
  const otherOrder = (await other.get("/api/admin/pedidos")).body[0];
  expect(new URL(otherOrder.whatsapp_url).pathname).toBe("/5521988887777");
  expect(
    (
      await agent
        .post(path + "/whatsapp")
        .send({ historico_id: otherOrder.historico[0].id })
    ).status,
  ).toBe(409);
  expect(
    (await agent.patch(path + "/status").send({ status: "concluido" })).status,
  ).toBe(200);
});

test("dashboard, health, página e logout funcionam", async () => {
  expect((await agent.get("/api/admin/dashboard")).status).toBe(200);
  expect((await request(app).get("/health")).body.status).toBe("ok");
  expect((await request(app).get("/hamburgueria-demo")).status).toBe(200);
  expect((await agent.post("/api/admin/logout")).status).toBe(200);
  expect((await agent.get("/api/admin/me")).status).toBe(401);
});
test("pedido com adicionais usa preço do banco e entrega soma taxa", async () => {
  const d = order(a.id);
  d.modalidade = "entrega";
  d.endereco = { rua: "Rua QA", numero: "12", bairro: "Centro" };
  d.itens[0].adicionais = [Number(a.grupos[0].adicionais[0].id)];
  const r = await request(app).post("/api/hamburgueria-demo/pedidos").send(d);
  expect(r.status).toBe(201);
  expect(r.body.total).toBe(
    (a.preco + a.grupos[0].adicionais[0].preco) * 2 + aMenu.loja.taxa_entrega,
  );
});
test("loja fechada não recebe pedido e usuário não escolhe outro tenant", async () => {
  await agent
    .post("/api/admin/login")
    .send({ email: "admin@hamburguer.demo", senha: password });
  const data = {
    ...aMenu.loja,
    estabelecimento_id: b.estabelecimento_id,
    aberto: false,
  };
  expect((await agent.put("/api/admin/configuracoes").send(data)).status).toBe(
    200,
  );
  expect(
    (
      await request(app)
        .post("/api/hamburgueria-demo/pedidos")
        .send(order(a.id))
    ).status,
  ).toBe(400);
  expect(
    (await request(app).get("/api/doces-demo/cardapio")).body.loja.aberto,
  ).toBe(true);
  await agent.put("/api/admin/configuracoes").send({ ...data, aberto: true });
});
test("parâmetros inválidos e tentativas SQL não são aceitos", async () => {
  expect((await request(app).get("/api/slug%27/cardapio")).status).toBe(400);
  expect((await agent.delete("/api/admin/produtos/1%20OR%201=1")).status).toBe(
    400,
  );
  expect(
    (await agent.get("/api/admin/pedidos?inicio=2026-11-14&fim=2026-11-13"))
      .status,
  ).toBe(400);
});
test("telefone legado inválido não impede status nem inventa notificação", async () => {
  const r = await request(app)
    .post("/api/hamburgueria-demo/pedidos")
    .send(order(a.id));
  expect(r.status).toBe(201);
  await pool.query("UPDATE pedidos SET cliente_telefone='123' WHERE id=$1", [
    r.body.id,
  ]);
  const update = await agent
    .patch(`/api/admin/pedidos/${r.body.id}/status`)
    .send({ status: "confirmado" });
  expect(update.status).toBe(200);
  expect(update.body.aviso).toContain("telefone antigo");
  const p = (await agent.get("/api/admin/pedidos")).body.find(
    (p) => p.id === r.body.id,
  );
  expect(p.status).toBe("confirmado");
  expect(p.notificacao).toBeNull();
  expect(p.historico.at(-1).usuario_email).toBe("admin@hamburguer.demo");
  expect(p.historico.at(-1).telefone_whatsapp).toBeNull();
});
test("limites de login e pedidos retornam 429", async () => {
  let login, orders;
  for (let i = 0; i < 12; i++) {
    login = await request(app)
      .post("/api/admin/login")
      .send({ email: "incorreto", senha: "x" });
    if (login.status === 429) break;
  }
  expect(login.status).toBe(429);
  for (let i = 0; i < 21; i++) {
    orders = await request(app).post("/api/hamburgueria-demo/pedidos").send({});
    if (orders.status === 429) break;
  }
  expect(orders.status).toBe(429);
}, 15000);
