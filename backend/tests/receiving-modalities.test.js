// Isolado: sem .env, PostgreSQL, migrations ou serviços externos.
jest.mock("../src/database/pool", () => ({ query: jest.fn() }));
jest.mock("../src/services/billing", () => ({
  assertAccess: jest.fn(async () => ({ adicionais: true })),
}));
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const pool = require("../src/database/pool");
const admin = require("../src/controllers/admin");
const catalog = require("../src/services/catalog");
const { createOrder } = require("../src/services/orders");
const { parse, schemas } = require("../src/middlewares/validation");
const settings = {
  nome: "Loja QA",
  whatsapp: "11999998888",
  taxa_entrega: 500,
  aberto: true,
  cor_principal: "#C2410C",
};
const order = (modalidade) =>
  parse(schemas.pedido, {
    modalidade,
    cliente: { nome: "QA", telefone: "11999998888" },
    forma_pagamento: "pix",
    endereco: { rua: "Rua QA", numero: "1", bairro: "Centro" },
    itens: [{ produto_id: 1, quantidade: 1 }],
  });
function database(flags = {}) {
  const store = {
    id: "7",
    slug: "loja-qa",
    nome: "QA",
    whatsapp: "5511999998888",
    aberto: true,
    taxa_entrega: 500,
    proximo_numero: 1,
    ...flags,
  };
  const client = {
    release: jest.fn(),
    query: jest.fn(async (sql) => {
      if (sql.includes("FROM estabelecimentos")) return { rows: [store] };
      if (sql.includes("SELECT p.adicionais"))
        return { rows: [{ adicionais: true }] };
      if (sql.startsWith("SELECT * FROM categorias"))
        return { rows: [{ id: "1" }] };
      if (sql.includes("FROM produtos r WHERE"))
        return {
          rows: [
            {
              id: "1",
              nome: "Produto QA",
              preco: 1000,
              categoria_id: "1",
              categoria_ids: [],
            },
          ],
        };
      if (/^INSERT INTO (clientes|pedidos|itens_pedido)\(/.test(sql))
        return { rows: [{ id: "1" }] };
      return { rows: [] };
    }),
  };
  return { client, pool: { connect: async () => client }, store };
}
beforeEach(() => pool.query.mockReset());

test.each([{}, { entrega_ativa: true, retirada_ativa: true }])(
  "catálogo público e administrativo preservam ambas por padrão: %j",
  async (flags) => {
    const db = database(flags);
    for (const isAdmin of [false, true]) {
      const data = await catalog(db.client, db.store, isAdmin);
      expect(data.loja).toMatchObject({
        entrega_ativa: true,
        retirada_ativa: true,
      });
      expect(data.loja).not.toHaveProperty("proximo_numero");
    }
  },
);

test("modalidades são individuais: catálogo de outra loja mantém ambas habilitadas", async () => {
  const first = database({ entrega_ativa: false, retirada_ativa: true });
  const second = database();
  const a = await catalog(first.client, first.store, true);
  const b = await catalog(second.client, { ...second.store, id: "8" }, true);
  expect(a.loja).toMatchObject({ entrega_ativa: false, retirada_ativa: true });
  expect(b.loja).toMatchObject({
    id: "8",
    entrega_ativa: true,
    retirada_ativa: true,
  });
});

test.each(["entrega", "retirada"])(
  "rejeita %s desativada antes de gravar qualquer dado",
  async (mode) => {
    const db = database({ [`${mode}_ativa`]: false });
    await expect(
      createOrder(db.pool, "loja-qa", order(mode)),
    ).rejects.toMatchObject({ status: 400 });
    const sql = db.client.query.mock.calls.map(([sql]) => sql);
    expect(sql[1]).toContain("FOR UPDATE");
    expect(sql).toContain("ROLLBACK");
    expect(sql.some((s) => /^(INSERT|UPDATE)/.test(s))).toBe(false);
    expect(db.client.release).toHaveBeenCalled();
  },
);

test.each([
  ["entrega", {}, 1500],
  ["retirada", {}, 1000],
  ["entrega", { entrega_ativa: true, retirada_ativa: false }, 1500],
  ["retirada", { entrega_ativa: false, retirada_ativa: true }, 1000],
])(
  "aceita %s habilitada (%j), preservando taxa e total",
  async (mode, flags, total) => {
    const db = database(flags);
    await expect(
      createOrder(db.pool, "loja-qa", order(mode)),
    ).resolves.toMatchObject({ total });
    expect(db.client.query.mock.calls.map(([sql]) => sql)).toContain("COMMIT");
  },
);

test("reenvio idempotente devolve pedido já salvo mesmo após desativar modalidade", async () => {
  const db = database({ retirada_ativa: false });
  const original = db.client.query.getMockImplementation();
  const data = {
    ...order("retirada"),
    idempotencia: "1518bcb2-7440-48d5-b137-60ea50159151",
  };
  const resposta = { id: "42", total: 1000 };
  db.client.query.mockImplementation(async (sql, args) =>
    sql.includes("SELECT requisicao_hash")
      ? {
          rows: [
            {
              requisicao_hash: require("node:crypto")
                .createHash("sha256")
                .update(JSON.stringify(data))
                .digest("hex"),
              resposta,
            },
          ],
        }
      : original(sql, args),
  );
  await expect(createOrder(db.pool, "loja-qa", data)).resolves.toEqual(
    resposta,
  );
  expect(
    db.client.query.mock.calls.some(([sql]) => /^(INSERT|UPDATE)/.test(sql)),
  ).toBe(false);
});

async function save(flags) {
  const res = { json: jest.fn() };
  await admin.settings(
    {
      user: { estabelecimento_id: "7" },
      subscription: { personalizacao: true },
      body: { ...settings, ...flags, estabelecimento_id: "8" },
    },
    res,
  );
  return res;
}
test("configuração usa apenas a loja autenticada e valida estado final atomicamente", async () => {
  pool.query.mockResolvedValue({
    rows: [{ entrega_ativa: false, retirada_ativa: true }],
  });
  await save({ entrega_ativa: false });
  const [sql, args] = pool.query.mock.calls[0];
  expect(args[0]).toBe("7");
  expect(sql).toMatch(/WHERE id=\$1 AND \(\$\d+::boolean OR retirada_ativa\)/);
  expect(sql).not.toContain("estabelecimento_id=");
  expect(sql).toContain("entrega_ativa,retirada_ativa");
});
test("API rejeita estado final sem modalidades (inclusive alteração parcial)", async () => {
  pool.query.mockResolvedValue({ rows: [] });
  await expect(save({ entrega_ativa: false })).rejects.toMatchObject({
    status: 400,
  });
  await expect(
    save({ entrega_ativa: false, retirada_ativa: false }),
  ).rejects.toMatchObject({ status: 400 });
});
test("cliente antigo omite campos sem reativar modalidade desabilitada", async () => {
  pool.query.mockResolvedValue({
    rows: [{ entrega_ativa: false, retirada_ativa: true }],
  });
  const response = await save({});
  const [sql] = pool.query.mock.calls[0];
  expect(sql.split(" WHERE ")[0]).not.toMatch(/entrega_ativa|retirada_ativa/);
  expect(response.json).toHaveBeenCalledWith({
    entrega_ativa: false,
    retirada_ativa: true,
  });
});
test.each(["false", 0, null])(
  "rejeita modalidade não booleana: %j",
  async (value) => {
    await expect(save({ entrega_ativa: value })).rejects.toMatchObject({
      status: 400,
    });
    expect(pool.query).not.toHaveBeenCalled();
  },
);

test("migration apenas adiciona flags com DEFAULT true, NOT NULL e CHECK", () => {
  const sql = fs
    .readFileSync(
      path.join(
        __dirname,
        "../src/database/migrations/009_modalidades_recebimento.sql",
      ),
      "utf8",
    )
    .replace(/--[^\n]*/g, "");
  expect(sql).toContain(
    "ADD COLUMN entrega_ativa boolean NOT NULL DEFAULT true",
  );
  expect(sql).toContain(
    "ADD COLUMN retirada_ativa boolean NOT NULL DEFAULT true",
  );
  expect(sql).toContain("CHECK (entrega_ativa OR retirada_ativa)");
  expect(sql).not.toMatch(/\b(UPDATE|DELETE|INSERT|DROP|TRUNCATE)\b/i);
});

test.each([
  [{}, ["entrega", "retirada"], "entrega"],
  [{ entrega_ativa: false }, ["retirada"], "retirada"],
  [{ retirada_ativa: false }, ["entrega"], "entrega"],
])(
  "checkout filtra opções e ajusta endereço e taxa: %j",
  (flags, expected, selected) => {
    const source = fs.readFileSync(
      path.join(__dirname, "../../frontend/cardapio/js/app.js"),
      "utf8",
    );
    const functions = source.slice(
      source.indexOf("function configureModalities()"),
      source.indexOf("form.elements.modalidade.addEventListener"),
    );
    const select = {
      options: [],
      _value: "entrega",
      get value() {
        return this._value;
      },
      set value(v) {
        this._value = v;
      },
      replaceChildren() {
        this.options = [];
        this._value = "";
      },
      append(option) {
        this.options.push(option);
        if (!this._value) this._value = option.value;
      },
    };
    const elements = { modalidade: select, rua: {}, numero: {}, bairro: {} };
    const address = {},
      total = { replaceChildren: jest.fn() };
    vm.runInNewContext(
      functions + "\nconfigureModalities(); checkoutTotal();",
      {
        menu: { loja: flags },
        form: { elements },
        el: () => ({}),
        $: (selector) => (selector === "#address" ? address : total),
        totals: (mode) => mode,
      },
    );
    expect(select.options.map((o) => o.value)).toEqual(expected);
    expect(select.value).toBe(selected);
    expect(address.hidden).toBe(selected !== "entrega");
    expect(elements.rua.required).toBe(selected === "entrega");
    expect(total.replaceChildren).toHaveBeenCalledWith(selected);
  },
);

test("rejeita ambas desativadas na validação antes de consultar o banco", async () => {
  pool.query.mockResolvedValue({ rows: [{ id: "7" }] });
  await expect(
    save({ entrega_ativa: false, retirada_ativa: false }),
  ).rejects.toMatchObject({ status: 400 });
  expect(pool.query).not.toHaveBeenCalled();
});

test.each(["entrega", "retirada"])(
  "valida o tipo booleano da flag de %s independentemente",
  (mode) => {
    for (const value of ["true", "false", 0, 1, null, [], {}]) {
      expect(() =>
        parse(schemas.loja, { ...settings, [`${mode}_ativa`]: value }),
      ).toThrow();
    }
  },
);

test.each(["", "delivery", "RETIRADA", null])(
  "rejeita modalidade de pedido inválida: %j",
  (modalidade) => {
    expect(() => order(modalidade)).toThrow();
  },
);

test("retirada aceita endereço vazio e não cobra taxa de entrega", async () => {
  const db = database({ entrega_ativa: false, retirada_ativa: true });
  const data = parse(schemas.pedido, {
    ...order("retirada"),
    endereco: {},
  });
  const result = await createOrder(db.pool, "loja-qa", data);
  expect(result).toMatchObject({ total: 1000 });
  const [, params] = db.client.query.mock.calls.find(([sql]) =>
    sql.startsWith("INSERT INTO pedidos("),
  );
  expect(params[3]).toBe("retirada");
  expect(params[7]).toBe(0);
  expect(params.slice(12)).toEqual(["", "", "", "", ""]);
  expect(result.mensagem).toContain("Retirada no estabelecimento");
});

test.each(["rua", "numero", "bairro"])(
  "entrega exige o campo de endereço %s",
  (field) => {
    const data = order("entrega");
    data.endereco[field] = "";
    expect(() => parse(schemas.pedido, data)).toThrow();
  },
);

test("todas as consultas de catálogo mantêm o escopo da loja", async () => {
  const db = database({ entrega_ativa: false, retirada_ativa: true });
  await catalog(db.client, db.store, true);
  for (const [sql, params] of db.client.query.mock.calls) {
    expect(sql).toContain("estabelecimento_id=$1");
    expect(params).toEqual([db.store.id]);
  }
});

test.each([
  { entrega_ativa: false, retirada_ativa: true },
  { entrega_ativa: true, retirada_ativa: false },
  { entrega_ativa: true, retirada_ativa: true },
])("UPDATE valida as duas flags enviadas atomicamente: %j", async (flags) => {
  pool.query.mockResolvedValue({ rows: [flags] });
  await save(flags);
  const [sql, params] = pool.query.mock.calls[0];
  const placeholders = sql.match(
    /AND \(\$(\d+)::boolean OR \$(\d+)::boolean\)/,
  );
  expect(placeholders).not.toBeNull();
  expect(params[Number(placeholders[1]) - 1]).toBe(flags.entrega_ativa);
  expect(params[Number(placeholders[2]) - 1]).toBe(flags.retirada_ativa);
});

test.each([
  ["entrega", { entrega_ativa: false, retirada_ativa: true }, 400],
  ["retirada", { entrega_ativa: false, retirada_ativa: true }, 201],
  ["retirada", { entrega_ativa: true, retirada_ativa: false }, 400],
  ["entrega", { entrega_ativa: true, retirada_ativa: true }, 201],
])(
  "API real de pedidos: %s com %j responde %s",
  async (mode, flags, status) => {
    const db = database(flags);
    pool.connect = jest.fn(db.pool.connect);
    const response = await require("supertest")(require("../src/app"))
      .post("/api/loja-qa/pedidos")
      .send(order(mode));
    expect(response.status).toBe(status);
    if (status === 400) {
      expect(response.body.erro).toContain(`pedidos de ${mode}`);
      expect(
        db.client.query.mock.calls.some(([sql]) =>
          /^(INSERT|UPDATE)/.test(sql),
        ),
      ).toBe(false);
    } else {
      expect(response.body.total).toBe(mode === "entrega" ? 1500 : 1000);
    }
  },
);
