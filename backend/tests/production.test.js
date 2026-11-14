// Toda consulta e toda leitura remota são simuladas; nenhum serviço real é usado.
process.env.NODE_ENV = "production";
process.env.DATABASE_URL =
  "postgresql://unused@ep-isolated.neon.tech/menuza?sslmode=verify-full";
process.env.JWT_SECRET = require("node:crypto").randomBytes(48).toString("hex");
process.env.APP_ORIGIN = "https://menuza.example";
process.env.IMAGE_STORAGE = "cloudinary";
process.env.CLOUDINARY_CLOUD_NAME = "isolated-test";
process.env.CLOUDINARY_API_KEY = "isolated-key";
process.env.CLOUDINARY_API_SECRET = "isolated-secret";
process.env.CLOUDINARY_PREFIX = "menuza";
process.env.TRUST_PROXY = "";
jest.mock("../src/database/pool", () => ({ query: jest.fn() }));
jest.mock("../src/services/billing", () => ({
  ...jest.requireActual("../src/services/billing"),
  assertAccess: jest.fn().mockResolvedValue({}),
}));
const request = require("supertest");
const bcrypt = require("bcrypt");
const pool = require("../src/database/pool");
const app = require("../src/app");
beforeEach(() => pool.query.mockReset());
afterEach(() => jest.restoreAllMocks());

test("health confirma disponibilidade e retorna 503 se o banco falhar", async () => {
  pool.query.mockResolvedValueOnce({ rows: [{ n: 1 }] });
  expect((await request(app).get("/health")).status).toBe(200);
  expect(pool.query).toHaveBeenCalledWith("SELECT 1");
  pool.query.mockRejectedValueOnce(new Error("detalhe-privado"));
  const failed = await request(app).get("/health");
  expect(failed.status).toBe(503);
  expect(failed.body).toEqual({ status: "indisponivel" });
});

test.each([
  ["superadmin", "SUPERADMIN", "menuza_platform", null],
  ["admin", "STORE_ADMIN", "menuza", 2],
])(
  "login %s usa cookie seguro e valida sessão",
  async (route, papel, name, loja) => {
    const senha = require("node:crypto").randomBytes(18).toString("hex");
    const user = {
      id: 1,
      papel,
      email: "owner@example.test",
      estabelecimento_id: loja,
      senha_hash: await bcrypt.hash(senha, 4),
    };
    pool.query
      .mockResolvedValueOnce({ rows: [user] })
      .mockResolvedValueOnce({ rows: [] });
    const login = await request(app)
      .post(`/api/${route}/login`)
      .set("Origin", process.env.APP_ORIGIN)
      .send({ email: user.email, senha });
    expect(login.status).toBe(200);
    const cookie = login.headers["set-cookie"][0];
    expect(cookie).toMatch(new RegExp(`^${name}=`));
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(login.body).not.toHaveProperty("senha_hash");
    pool.query.mockResolvedValueOnce({ rows: [user] });
    const me = await request(app)
      .get(`/api/${route}/me`)
      .set("Cookie", cookie.split(";")[0]);
    expect(me.status).toBe(200);
    expect(me.body.papel).toBe(papel);
    expect((await request(app).get(`/api/${route}/me`)).status).toBe(401);
  },
);

test("origem divergente bloqueia login antes de consultar o banco", async () => {
  const r = await request(app)
    .post("/api/admin/login")
    .set("Origin", "https://other.example")
    .send({ email: "owner@example.test", senha: "unused" });
  expect(r.status).toBe(403);
  expect(pool.query).not.toHaveBeenCalled();
});

test("proxy de imagem preserva bytes e funciona com CSP de produção", async () => {
  const bytes = Buffer.from("isolated-image");
  const fetch = jest
    .spyOn(global, "fetch")
    .mockResolvedValue(new Response(bytes));
  const r = await request(app).get("/uploads/abcd-1234.webp");
  expect(r.status).toBe(200);
  expect(r.body).toEqual(bytes);
  expect(fetch.mock.calls[0][0]).toBe(
    "https://res.cloudinary.com/isolated-test/raw/upload/menuza/abcd-1234.webp",
  );
  expect(r.headers["content-type"]).toMatch(/image\/webp/);
  const page = await request(app).get("/admin");
  expect(page.status).toBe(200);
  expect(page.headers["content-security-policy"]).toContain(
    "img-src 'self' data:",
  );
  expect(page.headers["content-security-policy"]).toContain(
    "upgrade-insecure-requests",
  );
  expect(pool.query).not.toHaveBeenCalled();
});
