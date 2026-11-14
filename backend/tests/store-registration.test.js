jest.mock("../src/database/pool", () => ({ connect: jest.fn() }));
const pool = require("../src/database/pool");
const router = require("../src/routes/superadmin");
const handler = (method, path) =>
  router.stack.find((l) => l.route?.path === path && l.route.methods[method])
    .route.stack[0].handle;
const create = handler("post", "/lojas");
const edit = handler("put", "/lojas/:id");
const body = {
  nome: "Nova Loja Açaí",
  responsavel: "Responsável QA",
  email: "contato@example.com",
  telefone: "11999998888",
  plano_id: 1,
  valor: 4990,
  vencimento: "2026-12-14",
  admin_email: "admin@example.com",
  senha: "senha-exclusiva-de-teste",
};
let c, res;
beforeEach(() => {
  jest.clearAllMocks();
  c = {
    query: jest.fn(async (sql, params) => {
      if (sql.startsWith("SELECT id FROM planos"))
        return { rowCount: 1, rows: [{ id: 1 }] };
      if (sql.startsWith("INSERT INTO estabelecimentos"))
        return { rows: [{ id: "10", slug: params[1] }] };
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  pool.connect.mockResolvedValue(c);
  res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
});
async function register(extra) {
  await create({ body: { ...body, ...extra }, user: { id: "1" } }, res);
  return res.json.mock.calls[0][0];
}
test("cadastro normaliza acentos, maiúsculas e espaços antes de persistir", async () => {
  expect(await register({ slug: "  Nova Loja AÇAÍ  " })).toEqual({
    id: "10",
    slug: "nova-loja-acai",
  });
  expect(res.status).toHaveBeenCalledWith(201);
  expect(c.query).toHaveBeenCalledWith("COMMIT");
  expect(c.query.mock.calls.some(([sql]) => /UPDATE|DELETE/.test(sql))).toBe(
    false,
  );
});
test.each([undefined, "", "   "])(
  "endereço %p gera slug sem sufixo quando disponível",
  async (slug) => {
    expect((await register({ slug })).slug).toBe("nova-loja-acai");
  },
);
test.each(["ADMIN", " Ápi ", "Superadmin", "!!!", "a".repeat(81), 123])(
  "endereço %p é rejeitado antes de abrir transação",
  async (slug) => {
    await expect(register({ slug })).rejects.toMatchObject({ status: 400 });
    expect(pool.connect).not.toHaveBeenCalled();
  },
);
test.each([
  ["estabelecimentos_slug_key", "slug: Endereço"],
  ["usuarios_email_key", "admin_email: E-mail"],
])(
  "conflito %s informa o campo e desfaz todo o cadastro",
  async (constraint, message) => {
    const original = c.query.getMockImplementation();
    c.query.mockImplementation(async (sql, params) => {
      if (
        sql.startsWith(
          constraint === "usuarios_email_key"
            ? "INSERT INTO usuarios"
            : "INSERT INTO estabelecimentos",
        )
      )
        throw Object.assign(new Error("duplicate key"), {
          code: "23505",
          constraint,
        });
      return original(sql, params);
    });
    await expect(register({ slug: "nova-loja" })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining(message),
    });
    expect(c.query).toHaveBeenCalledWith("ROLLBACK");
    expect(c.query).not.toHaveBeenCalledWith("COMMIT");
    expect(c.release).toHaveBeenCalledTimes(1);
  },
);
test("edição mantém a validação anterior sem normalizar endereços existentes", async () => {
  await expect(
    edit(
      { params: { id: "2" }, body: { ...body, slug: "Nova Loja Açaí" } },
      res,
    ),
  ).rejects.toMatchObject({ status: 400 });
  expect(pool.connect).not.toHaveBeenCalled();
});

test.each([undefined, " Açaí & Cia São José! "])(
  "normaliza caracteres especiais no endereço %p",
  async (slug) => {
    expect((await register({ nome: "Açaí & Cia São José", slug })).slug).toBe(
      "acai-cia-sao-jose",
    );
  },
);
test("colisão no slug automático gera outro endereço sem alterar a loja existente", async () => {
  const original = c.query.getMockImplementation();
  let inserts = 0;
  c.query.mockImplementation(async (sql, params) => {
    if (sql.startsWith("INSERT INTO estabelecimentos") && inserts++ === 0)
      return { rows: [] };
    return original(sql, params);
  });
  expect((await register({})).slug).toMatch(/^nova-loja-acai-[a-f0-9]{8}$/);
  const attempts = c.query.mock.calls.filter(([sql]) =>
    sql.startsWith("INSERT INTO estabelecimentos"),
  );
  expect(attempts).toHaveLength(2);
  expect(attempts[0][1][1]).toBe("nova-loja-acai");
  expect(
    attempts.every(([sql]) => sql.includes("ON CONFLICT (slug) DO NOTHING")),
  ).toBe(true);
  expect(c.query.mock.calls.some(([sql]) => /UPDATE|DELETE/.test(sql))).toBe(
    false,
  );
});
test("nome reservado automático usa endereço válido", async () => {
  expect((await register({ nome: "Admin" })).slug).toBe("admin-loja");
});
