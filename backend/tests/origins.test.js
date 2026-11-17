// Rotas, bcrypt, JWT e cookies reais; armazenamento descartável em memória.
process.env.NODE_ENV = "production";
process.env.DATABASE_URL =
  "postgresql://unused@isolated.invalid/menuza?sslmode=verify-full";
process.env.JWT_SECRET = require("node:crypto").randomBytes(48).toString("hex");
process.env.APP_ORIGIN = "https://menuzatech.com.br";
process.env.APP_ALLOWED_ORIGINS =
  "https://menuzatech.com.br,https://menuza-0ax7.onrender.com";
process.env.IMAGE_STORAGE = "cloudinary";
process.env.CLOUDINARY_CLOUD_NAME = "isolated";
process.env.CLOUDINARY_API_KEY = "isolated";
process.env.CLOUDINARY_API_SECRET = "isolated";
process.env.TRUST_PROXY = "loopback";
jest.mock("../src/database/pool", () => {
  // Fixture exclusiva desta suíte. Nenhum helper local ou PostgreSQL real.
  const bcrypt = require("bcrypt");
  const password =
    " " + require("node:crypto").randomBytes(18).toString("hex") + " ";
  const hash = bcrypt.hashSync(password, 4);
  const users = [
    {
      id: "1",
      email: "owner@example.test",
      papel: "SUPERADMIN",
      estabelecimento_id: null,
      ativo: true,
      senha_hash: hash,
    },
    {
      id: "2",
      email: "store@example.test",
      papel: "STORE_ADMIN",
      estabelecimento_id: "7",
      ativo: true,
      senha_hash: hash,
    },
  ];
  const sessions = new Map();
  const rows = (...values) => ({ rows: values, rowCount: values.length });
  return {
    fixture: { password, sessions },
    query: jest.fn(async (sql, args = []) => {
      if (sql.startsWith("SELECT * FROM usuarios WHERE")) {
        return rows(
          ...users.filter(
            (u) =>
              (sql.includes("lower(btrim(email))")
                ? u.email.trim().toLowerCase()
                : u.email) === args[0] &&
              u.papel === args[1] &&
              u.ativo,
          ),
        );
      }
      if (sql.startsWith("INSERT INTO sessoes")) {
        // Valida os parâmetros adicionais de elegibilidade quando presentes.
        const user = users.find((u) => u.id === args[1] && u.ativo);
        if (
          !user ||
          (args.length > 2 &&
            (user.senha_hash !== args[2] ||
              user.papel !== args[3] ||
              user.estabelecimento_id !== args[4]))
        )
          return rows();
        sessions.set(args[0], {
          user: user.id,
          expires: Date.now() + 8 * 3600000,
        });
        return rows({ id: args[0] });
      }
      if (sql.includes("JOIN sessoes s")) {
        const session = sessions.get(args[1]);
        return rows(
          ...users
            .filter(
              (u) =>
                u.id === args[0] &&
                u.papel === args[2] &&
                u.ativo &&
                session?.user === u.id &&
                session.expires > Date.now(),
            )
            .map(({ senha_hash, ativo, ...u }) => u),
        );
      }
      if (sql.startsWith("DELETE FROM sessoes WHERE id=")) {
        if (sessions.get(args[0])?.user === args[1]) sessions.delete(args[0]);
        return rows();
      }
      if (
        sql.includes("AS efetivo") &&
        sql.includes("WHERE a.estabelecimento_id=$1") &&
        args[0] === "7"
      )
        return rows({
          estabelecimento_id: "7",
          situacao: "active",
          efetivo: "active",
        });
      throw new Error("SQL não previsto na suíte de origens");
    }),
    connect: jest.fn(() => {
      throw new Error("Conexão PostgreSQL proibida nesta suíte");
    }),
  };
});
const request = require("supertest");
const pool = require("../src/database/pool");
const { fixture } = pool;
const app = require("../src/app");
const origins = [
  "https://menuzatech.com.br",
  "https://menuza-0ax7.onrender.com",
];
beforeEach(() => {
  fixture.sessions.clear();
  pool.query.mockClear();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe.each(origins)("origem legítima %s", (origin) => {
  test.each([
    ["superadmin", "owner@example.test", "menuza_platform"],
    ["admin", "store@example.test", "menuza"],
  ])(
    "%s autentica, recupera sessão e faz logout",
    async (area, email, name) => {
      const req = (method, path) =>
        request(app)
          [method](path)
          .set("Host", new URL(origin).host)
          .set("Origin", origin)
          .set("Sec-Fetch-Site", "same-origin")
          .set("X-Forwarded-Proto", "https");
      const response = await req("post", `/api/${area}/login`).send({
        email,
        senha: fixture.password,
      });
      expect(response.status).toBe(200);
      expect(response.headers["access-control-allow-origin"]).toBe(origin);
      expect(response.headers["access-control-allow-credentials"]).toBe("true");
      expect(response.headers.vary).toContain("Origin");
      const cookie = response.headers["set-cookie"][0];
      expect(cookie).toMatch(new RegExp(`^${name}=`));
      for (const attribute of [
        "Secure",
        "HttpOnly",
        "SameSite=Strict",
        "Path=/",
      ])
        expect(cookie).toContain(attribute);
      expect(cookie).not.toContain("Domain=");
      expect(fixture.sessions.size).toBe(1);
      expect(
        (
          await req("get", `/api/${area}/me`).set(
            "Cookie",
            cookie.split(";")[0],
          )
        ).body.email,
      ).toBe(email);
      expect(
        (
          await req("post", `/api/${area}/logout`).set(
            "Cookie",
            cookie.split(";")[0],
          )
        ).status,
      ).toBe(200);
      expect(fixture.sessions.size).toBe(0);
    },
  );
  test("preflight permite JSON e POST sem acessar banco", async () => {
    const query = jest.spyOn(pool, "query");
    const response = await request(app)
      .options("/api/superadmin/login")
      .set("Origin", origin)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type");
    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(origin);
    expect(
      response.headers["access-control-allow-methods"].split(/,\s*/),
    ).toContain("POST");
    expect(response.headers["access-control-allow-headers"].toLowerCase()).toBe(
      "content-type",
    );
    expect(query).not.toHaveBeenCalled();
  });
});

test.each([
  "https://evil.example",
  "https://menuzatech.com.br.evil.example",
  "https://menuza-0ax7.onrender.com.evil.example",
  "https://other.onrender.com",
  "http://menuzatech.com.br",
  "https://menuzatech.com.br:444",
  "https://menuzatech.com.br/",
  "https://menuzatech.com.br@evil.example",
  "null",
  "*",
  "https://menuzatech.com.br, https://evil.example",
])("origem não autorizada %s falha antes de bcrypt/banco", async (origin) => {
  const query = jest.spyOn(pool, "query");
  const compare = jest.spyOn(require("bcrypt"), "compare");
  const response = await request(app)
    .post("/api/superadmin/login")
    .set("Origin", origin)
    .set("Host", "menuzatech.com.br")
    .set("Referer", "https://menuzatech.com.br/superadmin")
    .set("X-Forwarded-Host", "menuza-0ax7.onrender.com")
    .send({ email: "owner@example.test", senha: fixture.password });
  expect(response.status).toBe(403);
  expect(console.warn).toHaveBeenCalledWith("http.origin_rejected", {
    reason: "origin_not_allowed",
  });
  expect(response.body).toEqual({ erro: "Origem não autorizada." });
  expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  expect(response.headers["set-cookie"]).toBeUndefined();
  expect(query).not.toHaveBeenCalled();
  expect(compare).not.toHaveBeenCalled();
  expect(fixture.sessions.size).toBe(0);
});

test("preflight de origem externa é recusado", async () => {
  expect(
    (
      await request(app)
        .options("/api/superadmin/login")
        .set("Origin", "https://evil.example")
    ).status,
  ).toBe(403);
  expect(console.warn).toHaveBeenCalledWith("http.origin_rejected", {
    reason: "origin_not_allowed",
  });
});

test.each([undefined, ...origins])(
  "cross-site continua bloqueado (Origin %s)",
  async (origin) => {
    const query = jest.spyOn(pool, "query");
    const req = request(app)
      .post("/api/superadmin/login")
      .set("Sec-Fetch-Site", "cross-site");
    if (origin) req.set("Origin", origin);
    expect(
      (await req.send({ email: "owner@example.test", senha: fixture.password }))
        .status,
    ).toBe(403);
    expect(console.warn).toHaveBeenCalledWith("http.origin_rejected", {
      reason: "cross_site",
    });
    expect(query).not.toHaveBeenCalled();
  },
);

test("cliente sem Origin preserva comportamento anterior sem CORS curinga", async () => {
  const response = await request(app)
    .post("/api/superadmin/login")
    .send({ email: "owner@example.test" });
  expect(response.status).toBe(400);
  expect(response.headers["access-control-allow-origin"]).toBeUndefined();
});
