require("dotenv").config({ path: "backend/.env", quiet: true });
const target = process.env.TEST_DATABASE_URL;
if (
  !target ||
  !new URL(target).pathname.endsWith("_test") ||
  target === process.env.DATABASE_URL
)
  throw new Error("Catálogo exige TEST_DATABASE_URL separado e descartável.");
process.env.DATABASE_URL = target;

const request = require("supertest");
const bcrypt = require("bcrypt");
const { randomUUID } = require("node:crypto");
const { readdir, readFile } = require("node:fs/promises");
const path = require("node:path");
const app = require("../src/app");
const pool = require("../src/database/pool");
const migrate = require("../src/database/migrate");

const run = randomUUID();
const password = randomUUID();
const ownerEmail = `catalogo-owner-${run}@qa.test`;
const storePath = "/api/admin";
const admin = request.agent(app);
const owner = request.agent(app);
const anonymous = request(app);

async function fixture(label, hash, plan = "Completo") {
  const slug = `catalogo-${label}-${run}`;
  const email = `${slug}@qa.test`;
  const {
    rows: [store],
  } = await pool.query(
    "INSERT INTO estabelecimentos(nome,slug,whatsapp) VALUES($1,$2,'5511999998888') RETURNING id,nome",
    [`Menu QA ${label} ${run}`, slug],
  );
  await pool.query(
    "INSERT INTO usuarios(estabelecimento_id,email,senha_hash) VALUES($1,$2,$3)",
    [store.id, email, hash],
  );
  await pool.query(
    "INSERT INTO assinaturas(estabelecimento_id,plano_id,valor,vencimento,status) SELECT $1,id,preco,current_date+30,'active' FROM planos WHERE nome=$2",
    [store.id, plan],
  );
  const {
    rows: [category],
  } = await pool.query(
    "INSERT INTO categorias(estabelecimento_id,nome) VALUES($1,'Categoria original') RETURNING id,nome",
    [store.id],
  );
  const {
    rows: [product],
  } = await pool.query(
    "INSERT INTO produtos(estabelecimento_id,categoria_id,nome,preco) VALUES($1,$2,'Produto existente',2000) RETURNING *",
    [store.id, category.id],
  );
  const {
    rows: [group],
  } = await pool.query(
    "INSERT INTO grupos_adicionais(estabelecimento_id,categoria_id,nome,minimo,maximo) VALUES($1,$2,'Grupo existente',1,2) RETURNING *",
    [store.id, category.id],
  );
  const {
    rows: [extra, inherited],
  } = await pool.query(
    "INSERT INTO adicionais(estabelecimento_id,grupo_id,nome,preco) VALUES($1,$2,'Adicional existente',300),($1,$2,'Opção herdada',500) RETURNING *",
    [store.id, group.id],
  );
  return { ...store, slug, email, category, product, group, extra, inherited };
}

const ownerPath = (store) => `/api/superadmin/lojas/${store.id}/cardapio`;
const catalog = async (agent, path) =>
  (await agent.get(path + "/catalogo").expect(200)).body;
const menu = async (store) =>
  (await anonymous.get(`/api/${store.slug}/cardapio`).expect(200)).body;
const links = (store) => ({
  produtos: [store.product.id],
  grupos: [store.group.id],
  adicionais: [store.extra.id],
});
const order = (store, categoryId, extras = [store.extra.id]) =>
  anonymous.post(`/api/${store.slug}/pedidos`).send({
    cliente: { nome: "Cliente QA", telefone: "11999998888" },
    modalidade: "retirada",
    forma_pagamento: "pix",
    itens: [
      {
        produto_id: store.product.id,
        categoria_id: categoryId,
        quantidade: 1,
        adicionais: extras,
      },
    ],
  });

let a, b, basic, historicalOrder;
let second, third;
beforeAll(async () => {
  const {
    rows: [db],
  } = await pool.query("SELECT current_database() AS nome");
  if (!db.nome.endsWith("_test")) throw new Error("Banco inseguro para testes");
  await migrate();
  const hash = await bcrypt.hash(password, 4);
  a = await fixture("a", hash);
  b = await fixture("b", hash);
  const restrictedPlan = "Sem adicionais " + run;
  await pool.query(
    "INSERT INTO planos(nome,preco,adicionais) VALUES($1,1000,false)",
    [restrictedPlan],
  );
  basic = await fixture("basico", hash, restrictedPlan);
  await pool.query(
    "INSERT INTO usuarios(email,senha_hash,papel) VALUES($1,$2,'SUPERADMIN')",
    [ownerEmail, hash],
  );
  await admin
    .post(storePath + "/login")
    .send({ email: a.email, senha: password })
    .expect(200);
  await owner
    .post("/api/superadmin/login")
    .send({ email: ownerEmail, senha: password })
    .expect(200);
  historicalOrder = (await order(a).expect(201)).body;
}, 30000);
afterAll(() => pool.end());

test("migration 013 mantém cadastros e preços históricos já gravados no schema anterior", async () => {
  const client = await pool.connect();
  const schema = "catalog_legacy_" + run.replaceAll("-", "");
  const dir = path.join(__dirname, "../src/database/migrations");
  const version = "013_vinculos_categorias.sql";
  const migration = (file) => readFile(path.join(dir, file), "utf8");
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema}`);
    for (const file of (await readdir(dir)).sort())
      if (file.endsWith(".sql") && file < version)
        await client.query(await migration(file));
    await client.query(`
      INSERT INTO estabelecimentos(nome,slug,whatsapp) VALUES('Loja','legado','5511999998888');
      INSERT INTO categorias(estabelecimento_id,nome) VALUES(1,'Categoria antiga');
      INSERT INTO produtos(estabelecimento_id,categoria_id,nome,preco) VALUES(1,1,'Produto',1000);
      INSERT INTO grupos_adicionais(estabelecimento_id,categoria_id,nome,minimo,maximo) VALUES(1,1,'Grupo',1,2);
      INSERT INTO adicionais(estabelecimento_id,grupo_id,nome,preco) VALUES(1,1,'Adicional',200);
      INSERT INTO clientes(estabelecimento_id,nome,telefone) VALUES(1,'Cliente','5511999998888');
      INSERT INTO pedidos(estabelecimento_id,cliente_id,numero,modalidade,forma_pagamento,subtotal,taxa_entrega,total,cliente_nome,cliente_telefone)
        VALUES(1,1,1,'retirada','pix',1200,0,1200,'Cliente','5511999998888');
      INSERT INTO itens_pedido(estabelecimento_id,pedido_id,produto_id,nome,preco,quantidade) VALUES(1,1,1,'Produto',1000,1);
      INSERT INTO itens_pedido_adicionais(estabelecimento_id,item_pedido_id,adicional_id,nome,preco) VALUES(1,1,1,'Adicional',200);
    `);
    await client.query(await migration(version));
    const {
      rows: [record],
    } = await client.query(`
      SELECT p.categoria_id,a.herda_categorias,g.minimo,g.maximo,i.preco AS produto,h.preco AS adicional,o.total
      FROM itens_pedido_adicionais h
      JOIN adicionais a ON a.id=h.adicional_id
      JOIN grupos_adicionais g ON g.id=a.grupo_id AND g.categoria_id=1
      JOIN itens_pedido i ON i.id=h.item_pedido_id
      JOIN produtos p ON p.id=i.produto_id
      JOIN pedidos o ON o.id=i.pedido_id
    `);
    expect(record).toEqual({
      categoria_id: "1",
      herda_categorias: true,
      minimo: 1,
      maximo: 2,
      produto: 1000,
      adicional: 200,
      total: 1200,
    });
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("ADM cria categoria e vincula os três tipos existentes; Superadmin vincula os mesmos itens em outra categoria", async () => {
  second = (
    await admin
      .post(storePath + "/categorias")
      .send({
        nome: "Categoria ADM",
        vinculos: {
          ...links(a),
          produtos: [a.product.id, Number(a.product.id)],
        },
      })
      .expect(201)
  ).body;
  third = (
    await owner
      .post(ownerPath(a) + "/categorias")
      .send({
        nome: "Categoria Superadmin",
        vinculos: links(a),
      })
      .expect(201)
  ).body;
  for (const [agent, path] of [
    [admin, storePath],
    [owner, ownerPath(a)],
  ]) {
    const data = await catalog(agent, path);
    const ids = [a.category.id, second.id, third.id];
    expect(data.produtos).toEqual([
      expect.objectContaining({
        id: a.product.id,
        categoria_ids: ids,
        preco: 2000,
      }),
    ]);
    expect(data.grupos).toEqual([
      expect.objectContaining({
        id: a.group.id,
        categoria_ids: ids,
        minimo: 1,
        maximo: 2,
        adicionais: [
          expect.objectContaining({ id: a.extra.id }),
          expect.objectContaining({ id: a.inherited.id }),
        ],
      }),
    ]);
    expect(data.adicionais).toEqual([
      expect.objectContaining({
        id: a.extra.id,
        categoria_ids: ids.slice(1),
        herda_categorias: true,
        preco: 300,
      }),
      expect.objectContaining({
        id: a.inherited.id,
        categoria_ids: null,
        herda_categorias: true,
      }),
    ]);
  }
  const publicMenu = await menu(a);
  expect(publicMenu.produtos).toHaveLength(1);
  const [product] = publicMenu.produtos;
  expect(product.categoria_ids).toEqual([a.category.id, second.id, third.id]);
  for (const groups of [
    product.grupos,
    ...Object.values(product.grupos_por_categoria),
  ]) {
    expect(groups).toEqual([
      expect.objectContaining({
        id: a.group.id,
        minimo: 1,
        maximo: 2,
        adicionais: [
          expect.objectContaining({ id: a.extra.id }),
          expect.objectContaining({ id: a.inherited.id }),
        ],
      }),
    ]);
  }
  await order(a, second.id, []).expect(400);
  await order(a, third.id, [a.extra.id, a.inherited.id]).expect(201);
  expect((await order(a, second.id).expect(201)).body.total).toBe(2300);
});

test("permite criar e editar itens com várias categorias e mantém os vínculos em edições pelo formato legado", async () => {
  const path = ownerPath(a);
  const categoryIds = [a.category.id, second.id, third.id];
  const product = (
    await admin
      .post(storePath + "/produtos")
      .send({
        nome: "Produto novo",
        preco: 1000,
        categoria_ids: categoryIds,
      })
      .expect(201)
  ).body;
  const group = (
    await owner
      .post(path + "/grupos")
      .send({
        nome: "Grupo novo",
        produto_id: product.id,
        categoria_ids: [second.id, third.id],
        minimo: 0,
        maximo: 3,
      })
      .expect(201)
  ).body;
  const extra = (
    await admin
      .post(storePath + "/adicionais")
      .send({
        nome: "Adicional novo",
        grupo_id: group.id,
        categoria_ids: categoryIds,
        preco: 150,
      })
      .expect(201)
  ).body;
  expect(extra.categoria_ids).toEqual(categoryIds);
  const updated = await owner
    .put(path + "/produtos/" + product.id)
    .send({
      nome: "Produto atualizado",
      categoria_id: a.category.id,
      preco: 1250,
      descricao: "Descrição atualizada",
      imagem_url: "/uploads/f00.webp",
    })
    .expect(200);
  expect(updated.body.categoria_ids).toEqual(categoryIds);
  const groupUpdate = await admin
    .put(storePath + "/grupos/" + group.id)
    .send({
      nome: "Grupo atualizado",
      produto_id: product.id,
      minimo: 0,
      maximo: 3,
    })
    .expect(200);
  expect(groupUpdate.body.categoria_ids).toEqual([second.id, third.id]);
  const extraUpdate = await owner
    .put(path + "/adicionais/" + extra.id)
    .send({
      nome: "Adicional atualizado",
      grupo_id: group.id,
      preco: 200,
    })
    .expect(200);
  expect(extraUpdate.body.categoria_ids).toEqual(categoryIds);

  await admin
    .put(storePath + "/produtos/" + product.id)
    .send({
      nome: "Produto atualizado",
      categoria_ids: [second.id, third.id],
      preco: 1250,
      descricao: "Descrição atualizada",
      imagem_url: "/uploads/f00.webp",
    })
    .expect(200);
  await owner
    .put(path + "/grupos/" + group.id)
    .send({
      nome: "Grupo atualizado",
      categoria_ids: [],
      produto_id: product.id,
      maximo: 3,
    })
    .expect(200);
  await admin
    .put(storePath + "/adicionais/" + extra.id)
    .send({
      nome: "Adicional atualizado",
      grupo_id: group.id,
      categoria_ids: [third.id],
      preco: 200,
    })
    .expect(200);

  const updatedProduct = (await menu(a)).produtos.find(
    (p) => p.id === product.id,
  );
  expect(updatedProduct).toMatchObject({
    nome: "Produto atualizado",
    preco: 1250,
    descricao: "Descrição atualizada",
    imagem_url: "/uploads/f00.webp",
    categoria_ids: [second.id, third.id],
  });
  const adminCatalog = await catalog(admin, storePath);
  expect(adminCatalog.grupos.find((g) => g.id === group.id)).toMatchObject({
    categoria_ids: [],
    produto_id: product.id,
    maximo: 3,
  });
  expect(
    adminCatalog.adicionais.find((item) => item.id === extra.id),
  ).toMatchObject({
    categoria_ids: [third.id],
    preco: 200,
    herda_categorias: false,
  });
});

test("remoção pela categoria mantém os outros vínculos, preços históricos e pedidos antigos sem categoria no payload", async () => {
  const path = ownerPath(a);
  await owner
    .put(path + "/categorias/" + a.category.id)
    .send({
      nome: a.category.nome,
      vinculos: { produtos: [], grupos: [], adicionais: [] },
    })
    .expect(200);
  await admin
    .put(storePath + "/categorias/" + second.id)
    .send({
      nome: "Categoria ADM",
      vinculos: { grupos: [], adicionais: [a.extra.id] },
    })
    .expect(200);

  const [product] = (await menu(a)).produtos;
  expect(product.categoria_ids).toEqual([second.id, third.id]);
  expect(product.grupos.find((g) => g.id === a.group.id)).toMatchObject({
    minimo: 0,
    maximo: 2,
    adicionais: [expect.objectContaining({ id: a.extra.id })],
  });
  expect(
    product.grupos_por_categoria[third.id].find((g) => g.id === a.group.id),
  ).toMatchObject({
    minimo: 1,
    maximo: 2,
    adicionais: expect.arrayContaining([
      expect.objectContaining({ id: a.inherited.id }),
    ]),
  });
  await order(a, a.category.id).expect(400);
  await order(a, second.id, [a.inherited.id]).expect(400);
  expect((await order(a).expect(201)).body.total).toBe(2300);

  await owner
    .put(path + "/produtos/" + a.product.id)
    .send({
      nome: "Novo nome",
      preco: 2500,
      categoria_id: second.id,
    })
    .expect(200);
  await owner
    .put(path + "/adicionais/" + a.extra.id)
    .send({
      nome: "Novo nome do adicional",
      preco: 700,
      grupo_id: a.group.id,
    })
    .expect(200);
  expect((await order(a, third.id).expect(201)).body.total).toBe(3200);
  const { body: orders } = await admin.get(storePath + "/pedidos").expect(200);
  expect(orders.find((p) => p.id === historicalOrder.id)).toMatchObject({
    total: 2300,
    itens: [
      expect.objectContaining({
        nome: a.product.nome,
        preco: 2000,
        adicionais: [
          expect.objectContaining({ nome: a.extra.nome, preco: 300 }),
        ],
      }),
    ],
  });
});

test("isola IDs e permissões, faz rollback dos vínculos inválidos e desativação afeta todas as categorias atuais", async () => {
  const path = ownerPath(a);
  const bad = {
    nome: "Categoria inválida",
    vinculos: { ...links(a), adicionais: [b.extra.id] },
  };
  await admin
    .post(storePath + "/categorias")
    .send(bad)
    .expect(400);
  await owner
    .put(path + "/categorias/" + third.id)
    .send(bad)
    .expect(400);
  await admin.get(path + "/catalogo").expect(401);
  await owner.get(storePath + "/catalogo").expect(401);
  await owner
    .put(path + "/categorias/" + b.category.id)
    .send({ nome: "Outra loja", vinculos: links(a) })
    .expect(404);
  for (const [name, record] of [
    ["produtos", a.product],
    ["grupos", a.group],
    ["adicionais", a.extra],
  ]) {
    await owner
      .put(path + "/" + name + "/" + record.id)
      .send({
        ...record,
        categoria_ids: [b.category.id],
      })
      .expect(400);
  }
  await owner
    .post(ownerPath(basic) + "/categorias")
    .send({
      nome: "Bloqueada",
      vinculos: { grupos: [basic.group.id] },
    })
    .expect(403);
  await owner
    .post(ownerPath(basic) + "/categorias")
    .send({
      nome: "Permitida",
      vinculos: { produtos: [basic.product.id] },
    })
    .expect(201);
  const data = await catalog(admin, storePath);
  expect(data.categorias.map((c) => c.nome)).toEqual([
    "Categoria original",
    "Categoria ADM",
    "Categoria Superadmin",
  ]);
  expect(
    data.adicionais.find((item) => item.id === a.extra.id).categoria_ids,
  ).toEqual([second.id, third.id]);
  expect((await menu(b)).produtos[0]).toMatchObject({
    id: b.product.id,
    categoria_ids: [b.category.id],
  });
  await owner.delete(path + "/produtos/" + a.product.id).expect(200);
  expect((await menu(a)).produtos.some((p) => p.id === a.product.id)).toBe(
    false,
  );
});

if (process.env.CATALOG_CHROME === "1")
  test("desktop e celular gerenciam a mesma categoria no ADM, no Superadmin e no cardápio", async () => {
    const { chromium } = require("playwright-core");
    const env = require("../src/config/env");
    const store = await fixture("chrome", await bcrypt.hash(password, 4));
    const previousOrigin = env.origin;
    const server = await new Promise((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    env.origin = `http://127.0.0.1:${server.address().port}`;
    let browser;
    const errors = [];
    try {
      browser = await chromium.launch({
        executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
        args: ["--no-sandbox"],
      });
      const desktop = await browser.newPage({
        viewport: { width: 1280, height: 900 },
      });
      const mobile = await browser.newPage({
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      });
      for (const page of [desktop, mobile])
        page.on("pageerror", (error) => errors.push(error.message));
      const button = (page, name) =>
        page.getByRole("button", { name, exact: true });
      const editor = (page) => page.locator("#editor");
      const noOverflow = (page) =>
        page.evaluate(() => {
          const dialog = document.querySelector("#editor");
          return (
            document.documentElement.scrollWidth <= innerWidth &&
            (!dialog?.open || dialog.scrollWidth <= dialog.clientWidth)
          );
        });
      async function login(page, path, email) {
        await page.goto(env.origin + path);
        const form = page.locator("#login");
        await form.locator("[name=email]").fill(email);
        await form.locator("[name=senha]").fill(password);
        await form.getByRole("button", { name: /Entrar no painel/ }).click();
      }
      await login(desktop, "/admin", store.email);
      await button(desktop, "Categorias").click();
      await button(desktop, "+ Adicionar").click();
      const desktopEditor = editor(desktop);
      await desktopEditor
        .getByLabel("Nome", { exact: true })
        .fill("Categoria navegador");
      for (const label of [
        "Produto existente",
        "Grupo existente",
        "Adicional existente · Grupo existente",
      ])
        await desktopEditor
          .getByRole("checkbox", { name: label, exact: true })
          .check();
      expect(await noOverflow(desktop)).toBe(true);
      await button(desktopEditor, "Salvar").click();
      await desktop.getByText("Categoria navegador", { exact: true }).waitFor();

      await button(desktop, "Produtos").click();
      await button(
        desktop.locator(".record").filter({ hasText: "Produto existente" }),
        "Editar",
      ).click();
      expect(
        await desktopEditor
          .getByRole("checkbox", { name: "Categoria original" })
          .isChecked(),
      ).toBe(true);
      expect(
        await desktopEditor
          .getByRole("checkbox", { name: "Categoria navegador" })
          .isChecked(),
      ).toBe(true);
      await button(desktopEditor, "Fechar edição").click();
      await button(desktop, "Adicionais").click();
      await button(
        desktop.locator(".record").filter({ hasText: "Adicional existente" }),
        "Editar",
      ).click();
      expect(
        await desktopEditor.getByLabel("Disponibilidade").inputValue(),
      ).toBe("grupo_e_categorias");
      expect(
        await desktopEditor
          .getByRole("checkbox", { name: "Categoria navegador" })
          .isChecked(),
      ).toBe(true);
      await button(desktopEditor, "Fechar edição").click();

      await login(mobile, "/superadmin", ownerEmail);
      await button(mobile, "Estabelecimentos").click();
      await mobile.getByLabel("Buscar pelo nome").fill(store.nome);
      await button(mobile, "Buscar").click();
      await button(
        mobile.locator(`[data-store-id="${store.id}"]`),
        "Gerenciar cardápio",
      ).click();
      const row = mobile
        .locator(".record")
        .filter({ hasText: "Categoria navegador" });
      await button(row, "Editar").tap();
      const mobileEditor = editor(mobile);
      expect(await noOverflow(mobile)).toBe(true);
      await mobileEditor
        .getByRole("checkbox", { name: "Grupo existente", exact: true })
        .uncheck();
      await button(mobileEditor, "Salvar").tap();
      await mobileEditor.waitFor({ state: "hidden" });
      await button(row, "Editar").tap();
      expect(
        await mobileEditor
          .getByRole("checkbox", { name: "Grupo existente", exact: true })
          .isChecked(),
      ).toBe(false);
      expect(
        await mobileEditor
          .getByRole("checkbox", { name: /Adicional existente/ })
          .isChecked(),
      ).toBe(true);

      for (const page of [desktop, mobile]) {
        await page.goto(env.origin + "/" + store.slug);
        for (const [category, minimum, optionCount] of [
          ["Categoria original", 1, 2],
          ["Categoria navegador", 0, 1],
        ]) {
          const section = page.locator(".category-section").filter({
            has: page.getByRole("heading", { name: category, exact: true }),
          });
          await section
            .getByRole("button", { name: /Personalizar Produto existente/ })
            .click();
          const product = page.locator("#product-dialog");
          await product.getByText(`Escolha de ${minimum} a 2 opções`).waitFor();
          expect(await product.getByRole("checkbox").count()).toBe(optionCount);
          await page.keyboard.press("Escape");
          await product.waitFor({ state: "hidden" });
        }
        expect(await noOverflow(page)).toBe(true);
      }
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      await new Promise((resolve) => server.close(resolve));
      env.origin = previousOrigin;
    }
  }, 60000);
