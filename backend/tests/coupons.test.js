const { randomUUID } = require("node:crypto");
require("dotenv").config({ path: "backend/.env", quiet: true });
const source = process.env.TEST_DATABASE_URL;
if (
  !source ||
  !new URL(source).pathname.endsWith("_test") ||
  source === process.env.DATABASE_URL
)
  throw new Error(
    "Cupons exigem um TEST_DATABASE_URL separado terminado em _test.",
  );

const schema = "cupons_" + randomUUID().replaceAll("-", "");
const url = new URL(source);
url.searchParams.set("options", "-csearch_path=" + schema);
process.env.DATABASE_URL = url.href;
process.env.JWT_SECRET ||= randomUUID() + randomUUID();

const request = require("supertest");
const app = require("../src/app");
const pool = require("../src/database/pool");
const migrate = require("../src/database/migrate");
const orderFixtures = require("./helpers/order-fixtures");

const password = randomUUID();
const first = request.agent(app);
const second = request.agent(app);
const store = "hamburgueria-demo";
const otherStore = "doces-demo";
const adminRoute = "/api/admin/cupons";
const api = request(app);
const date = (days) => new Date(Date.now() + days * 86400000).toISOString();

let product, otherProduct, schemaCreated;
const couponData = (codigo, fields = {}) => ({
  codigo,
  tipo: "percentual",
  valor: 1000,
  pedido_minimo: 0,
  inicio_em: date(-1),
  fim_em: date(1),
  limite_usos: null,
  ativo: true,
  ...fields,
});
async function createCoupon(code, fields, agent = first) {
  return (
    await agent.post(adminRoute).send(couponData(code, fields)).expect(201)
  ).body;
}
function payload(code, fields = {}, item = product) {
  return {
    idempotencia: randomUUID(),
    cliente: { nome: "Ana", telefone: "11999998888" },
    modalidade: "retirada",
    forma_pagamento: "pix",
    itens: [{ produto_id: item.id, quantidade: 1, adicionais: [] }],
    cupom_codigo: code,
    ...fields,
  };
}
const quote = (data, slug = store) =>
  api.post(`/api/${slug}/cupons/validar`).send(data);
const order = (data, slug = store) =>
  api.post(`/api/${slug}/pedidos`).send(data);
const coupons = async (agent = first) =>
  (await agent.get(adminRoute).expect(200)).body;

beforeAll(async () => {
  const {
    rows: [db],
  } = await pool.query("SELECT current_database() AS nome");
  if (!db.nome.endsWith("_test")) throw new Error("Banco inseguro para testes");
  await pool.query(`CREATE SCHEMA ${schema}`);
  schemaCreated = true;
  await migrate();
  await orderFixtures(pool, password);
  product = (await api.get(`/api/${store}/cardapio`).expect(200)).body
    .produtos[0];
  otherProduct = (await api.get(`/api/${otherStore}/cardapio`).expect(200)).body
    .produtos[0];
  await first
    .post("/api/admin/login")
    .send({ email: "admin@hamburguer.demo", senha: password })
    .expect(200);
  await second
    .post("/api/admin/login")
    .send({ email: "admin@doces.demo", senha: password })
    .expect(200);
}, 30000);

afterAll(async () => {
  try {
    if (schemaCreated) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  } finally {
    await pool.end();
  }
});

test("normaliza, cria, edita, altera status, exclui e libera o código para um novo cadastro", async () => {
  await api.get(adminRoute).expect(401);
  const original = await createCoupon("  boas-vindas_10 ");
  expect(original.codigo).toBe("BOAS-VINDAS_10");
  await first.post(adminRoute).send(couponData("Boas-vindas_10")).expect(409);
  const path = adminRoute + "/" + original.id;
  const edited = await first
    .put(path)
    .send(couponData("EDITADO", { tipo: "fixo", valor: 375 }))
    .expect(200);
  expect(edited.body).toMatchObject({
    id: original.id,
    codigo: "EDITADO",
    tipo: "fixo",
    valor: 375,
  });
  await first.patch(path).send({ ativo: false }).expect(200);
  expect((await coupons()).find((c) => c.id === original.id).status).toBe(
    "inativo",
  );
  expect((await quote(payload("editado")).expect(400)).body.erro).toMatch(
    /desativado/,
  );
  await first.patch(path).send({ ativo: true }).expect(200);
  await quote(payload("editado")).expect(200);
  await first.delete(path).expect(200);
  expect((await coupons()).map((c) => c.id)).not.toContain(original.id);
  expect((await quote(payload("EDITADO")).expect(400)).body.erro).toMatch(
    /inexistente/,
  );
  expect((await createCoupon("editado")).id).not.toBe(original.id);
});

test("valida valores, tipo, código, datas, limite e status no backend", async () => {
  for (const fields of [
    { valor: -1 },
    { valor: 0 },
    { valor: 10001 },
    { valor: 1.5 },
    { tipo: "outro" },
    { codigo: "dois códigos" },
    { pedido_minimo: -1 },
    { inicio_em: date(2) },
    { inicio_em: "2027-02-30T12:00:00Z" },
    { limite_usos: 0 },
    { ativo: "true" },
  ])
    await first
      .post(adminRoute)
      .send(couponData("INVALIDO", fields))
      .expect(400);
});

test("isola listagem, mutações e descontos, com o mesmo código em duas lojas", async () => {
  const a = await createCoupon("IGUAL", { tipo: "fixo", valor: 500 });
  await quote(payload("IGUAL", {}, otherProduct), otherStore).expect(400);
  const b = await createCoupon("igual", { tipo: "fixo", valor: 300 }, second);
  const path = adminRoute + "/" + a.id;
  await second.put(path).send(couponData("TENTATIVA")).expect(404);
  await second.patch(path).send({ ativo: false }).expect(404);
  await second.delete(path).expect(404);
  expect((await coupons(second)).map((c) => c.id)).toEqual([b.id]);
  expect((await quote(payload("IGUAL")).expect(200)).body.desconto).toBe(500);
  expect(
    (await quote(payload("IGUAL", {}, otherProduct), otherStore).expect(200))
      .body.desconto,
  ).toBe(300);
  await quote(payload("IGUAL", {}, otherProduct)).expect(400);
});

test("usa preços do catálogo, arredonda o percentual e limita desconto fixo ao subtotal", async () => {
  await createCoupon("PERCENTUAL", { valor: 1275 });
  await createCoupon("FIXO", { tipo: "fixo", valor: 99999 });
  const extra = product.grupos[0].adicionais.find((a) => a.preco === 400);
  const entrega = {
    modalidade: "entrega",
    endereco: { rua: "Rua A", numero: "1", bairro: "Centro" },
    itens: [
      {
        produto_id: product.id,
        quantidade: 1,
        preco: 1,
        adicionais: [extra.id],
      },
    ],
    total: 1,
    subtotal: 1,
    taxa_entrega: 0,
    desconto: 999999,
    cupons: ["FIXO", "PERCENTUAL"],
  };
  const subtotal = product.preco + extra.preco;
  const original = subtotal + 500;
  const desconto = Math.round(subtotal * 0.1275);
  const expected = {
    cupom_codigo: "PERCENTUAL",
    total_original: original,
    desconto,
    total: original - desconto,
  };
  const data = payload(" percentual ", entrega);
  expect((await quote(data).expect(200)).body).toMatchObject({
    ...expected,
    subtotal,
    taxa_entrega: 500,
  });
  expect(
    (
      await order({
        ...data,
        forma_pagamento: "dinheiro",
        troco_para: expected.total,
      }).expect(201)
    ).body,
  ).toMatchObject(expected);
  expect(
    (await quote(payload("FIXO", entrega)).expect(200)).body,
  ).toMatchObject({ desconto: subtotal, total: 500 });
  expect((await order(payload("FIXO")).expect(201)).body.total).toBe(0);
  await order(payload(["FIXO", "PERCENTUAL"])).expect(400);
});

test("retorna mensagens de inexistência, vigência e mínimo e revalida no pedido", async () => {
  await createCoupon("CEDO", { inicio_em: date(1), fim_em: date(2) });
  await createCoupon("VENCIDO", { inicio_em: date(-2), fim_em: date(-1) });
  await createCoupon("MINIMO", { pedido_minimo: product.preco + 1 });
  for (const [code, message] of [
    ["DESCONHECIDO", /inexistente/],
    ["CEDO", /ainda não está disponível/],
    ["VENCIDO", /expirou/],
    ["MINIMO", /abaixo do mínimo/],
  ]) {
    const data = payload(code, {
      modalidade: "entrega",
      endereco: { rua: "Rua A", numero: "1", bairro: "Centro" },
    });
    expect((await quote(data).expect(400)).body.erro).toMatch(message);
    expect((await order(data).expect(400)).body.erro).toMatch(message);
  }
  const coupon = await createCoupon("REVALIDA");
  const data = payload("REVALIDA");
  await quote(data).expect(200);
  await first
    .patch(adminRoute + "/" + coupon.id)
    .send({ ativo: false })
    .expect(200);
  expect((await order(data).expect(400)).body.codigo).toBe("cupom_invalido");
  expect((await coupons()).find((c) => c.id === coupon.id).usos).toBe(0);
  expect((await coupons()).find((c) => c.codigo === "VENCIDO").status).toBe(
    "expirado",
  );
  expect((await coupons()).find((c) => c.codigo === "CEDO").status).toBe(
    "agendado",
  );
});

test("protege a última utilização, deduplica reenvios e libera uma vaga no cancelamento", async () => {
  const coupon = await createCoupon("UNICO", { limite_usos: 1 });
  const left = payload("UNICO");
  const right = payload("UNICO");
  await quote(left).expect(200);
  await quote(right).expect(200);
  const results = await Promise.all([order(left), order(right)]);
  expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  const [winner, loser] = results[0].status === 201 ? [0, 1] : [1, 0];
  const saved = results[winner].body;
  expect(results[loser].body.erro).toMatch(/Limite de utilizações/);
  expect((await order([left, right][winner]).expect(201)).body).toEqual(saved);
  await quote(right).expect(409);
  expect((await coupons()).find((c) => c.id === coupon.id)).toMatchObject({
    status: "esgotado",
    usos: 1,
  });
  const cancelPath = "/api/admin/pedidos/" + saved.id + "/status";
  await Promise.all([
    first.patch(cancelPath).send({ status: "cancelado" }).expect(200),
    first.patch(cancelPath).send({ status: "cancelado" }).expect(200),
  ]);
  expect((await coupons()).find((c) => c.id === coupon.id)).toMatchObject({
    status: "ativo",
    usos: 0,
  });
  await order([left, right][loser]).expect(201);
  expect((await coupons()).find((c) => c.id === coupon.id).usos).toBe(1);
  const orders = (await first.get("/api/admin/pedidos").expect(200)).body;
  expect(orders.find((p) => p.id === saved.id)).toMatchObject({
    status: "cancelado",
    cupom_id: coupon.id,
    cupom_codigo: "UNICO",
    total_original: saved.total_original,
    desconto: saved.desconto,
    total: saved.total,
  });
});

test("preserva o histórico após alteração e exclusão e mantém pedidos sem cupom", async () => {
  const coupon = await createCoupon("HISTORICO", { tipo: "fixo", valor: 700 });
  const data = payload("HISTORICO");
  const saved = (await order(data).expect(201)).body;
  const path = adminRoute + "/" + coupon.id;
  await first
    .put(path)
    .send(couponData("NOVO-CODIGO", { valor: 5500 }))
    .expect(200);
  await first.delete(path).expect(200);
  const another = await createCoupon("HISTORICO");
  expect((await coupons()).find((c) => c.id === another.id).usos).toBe(0);
  expect((await order(data).expect(201)).body).toEqual(saved);
  const regular = (
    await order(payload(undefined, { desconto: 1000, total: 1 })).expect(201)
  ).body;
  expect(regular.total).toBe(product.preco);
  expect(regular.cupom_codigo).toBeUndefined();
  const orders = (await first.get("/api/admin/pedidos").expect(200)).body;
  const old = orders.find((p) => p.id === saved.id);
  expect(old).toMatchObject({
    cupom_id: coupon.id,
    cupom_codigo: "HISTORICO",
    total_original: product.preco,
    desconto: 700,
    total: product.preco - 700,
  });
  expect(new URL(old.whatsapp_url).searchParams.get("text")).toContain(
    "Cupom: HISTORICO",
  );
  expect(orders.find((p) => p.id === regular.id)).toMatchObject({
    cupom_id: null,
    cupom_codigo: null,
    total_original: null,
    desconto: 0,
    total: product.preco,
  });
});

if (process.env.COUPONS_CHROME === "1")
  test("Chrome no desktop e no celular cadastra, aplica, remove e revalida o cupom", async () => {
    const { chromium } = require("playwright-core");
    const env = require("../src/config/env");
    const previousOrigin = env.origin;
    const server = await new Promise((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    env.origin = "http://127.0.0.1:" + server.address().port;
    let browser;
    try {
      browser = await chromium.launch({
        executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
        args: ["--no-sandbox"],
      });
      const desktop = await browser.newPage({
        viewport: { width: 1280, height: 900 },
        timezoneId: "America/Sao_Paulo",
      });
      const mobile = await browser.newPage({
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      });
      await mobile
        .context()
        .route("https://wa.me/**", (r) =>
          r.fulfill({ body: "WhatsApp interceptado" }),
        );
      await desktop.goto(env.origin + "/admin");
      await desktop
        .locator("#login [name=email]")
        .fill("admin@hamburguer.demo");
      await desktop.locator("#login [name=senha]").fill(password);
      await desktop.locator("#login button").click();
      const section = desktop.getByRole("button", {
        name: "Cupons de desconto",
      });
      await section.click();
      await desktop.getByRole("button", { name: "+ Novo cupom" }).click();
      const editor = desktop.locator("#editor-form");
      await editor.getByLabel("Código do cupom").fill("chrome10");
      await editor.getByLabel("Desconto (%)").fill("10,00");
      await editor.getByLabel("Encerramento").fill(date(2).slice(0, 16));
      await editor.getByLabel("Limite de utilizações").fill("1");
      await editor.getByRole("button", { name: "Salvar" }).click();
      const row = desktop.locator(".record").filter({ hasText: "CHROME10" });
      await row.getByText(/Ativo/).waitFor();
      await row.getByRole("button", { name: "Editar" }).click();
      expect(await editor.getByLabel("Código do cupom").inputValue()).toBe(
        "CHROME10",
      );
      await editor.getByLabel("Desconto (%)").fill("12,50");
      await editor.getByRole("button", { name: "Salvar" }).click();
      await row.getByText(/12,5%/).waitFor();

      await mobile.goto(env.origin + "/" + store);
      await mobile.getByRole("button", { name: /Personalizar Aprox/ }).click();
      await mobile.getByRole("button", { name: /Adicionar ao pedido/ }).click();
      await mobile.locator("#cart-open").click();
      await mobile
        .getByRole("button", { name: /Continuar para finalizar/ })
        .click();
      await mobile.getByText("Tem um cupom de desconto?").waitFor();
      const summary = mobile.locator("#checkout-total");
      const apply = mobile.getByRole("button", {
        name: "Aplicar",
        exact: true,
      });
      const remove = mobile.getByRole("button", { name: "Remover cupom" });
      const code = mobile.getByLabel("Código do cupom");
      const confirm = mobile.locator("#confirm-order");
      await mobile.getByLabel("Modalidade").selectOption("retirada");
      const original = await summary.textContent();
      await code.fill("inexistente");
      await apply.click();
      await mobile.getByText("Cupom inexistente.").waitFor();
      await code.fill("chrome10");
      await code.press("Enter");
      await summary.getByText("CHROME10").waitFor();
      expect(await summary.textContent()).toMatch(
        /Desconto.*3,61.*Total.*25,29/,
      );
      await remove.click();
      expect(await summary.textContent()).toBe(original);
      await code.fill("chrome10");
      await apply.click();
      await summary.getByText("CHROME10").waitFor();
      await mobile.getByLabel("Modalidade").selectOption("entrega");
      await summary.getByText("CHROME10").waitFor();
      expect(await summary.textContent()).toMatch(/Total.*30,29/);
      await mobile.getByLabel("Modalidade").selectOption("retirada");
      await summary.getByText("CHROME10").waitFor();
      expect(
        await mobile
          .locator("#checkout-dialog")
          .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
      ).toBe(true);
      await row.getByRole("button", { name: "Desativar" }).click();
      await row.getByText(/Inativo/).waitFor();
      await mobile.getByLabel("Seu nome").fill("Ana Chrome");
      await mobile.getByLabel("Telefone com DDD").fill("11999998888");
      await confirm.click();
      await mobile.getByText(/Este cupom está desativado/).waitFor();
      expect(await confirm.isEnabled()).toBe(false);
      expect(await summary.textContent()).toBe(original);
      await row.getByRole("button", { name: "Ativar" }).click();
      await row.getByText(/Ativo/).waitFor();
      await apply.click();
      await summary.getByText("CHROME10").waitFor();
      await confirm.click();
      await mobile
        .getByRole("heading", { name: /Pedido nº .* salvo/ })
        .waitFor();
      await section.click();
      await row.getByText(/Esgotado/).waitFor();
      await desktop.setViewportSize({ width: 375, height: 812 });
      expect(
        await desktop.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      try {
        await browser?.close();
      } finally {
        env.origin = previousOrigin;
        await new Promise((resolve) => server.close(resolve));
      }
    }
  }, 60000);
