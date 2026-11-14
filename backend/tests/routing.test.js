// Estas verificações não consultam nem alteram o banco.
process.env.DATABASE_URL = "postgresql://unused@127.0.0.1/menuza_test";
process.env.JWT_SECRET = "segredo-unitario-efemero-sem-uso-em-producao";
const request = require("supertest");
const app = require("../src/app");
const pool = require("../src/database/pool");
afterAll(() => pool.end());

test.each(["/superadmin", "/superadmin/", "/superadmin?origem=login"])(
  "%s entrega o login da plataforma antes da rota de slug",
  async (url) => {
    const r = await request(app).get(url);
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/html/);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.text).toContain("<title>Superadmin • Menuza</title>");
    expect(r.text).toContain('src="/assets/superadmin/app.js"');
    expect(r.text).not.toContain("/assets/cardapio/js/app.js");
  },
);

test.each([
  ["/", "Menuza"],
  ["/admin", "Painel"],
  ["/admin/", "Painel"],
  ["/hamburgueria-demo", "Cardápio • Menuza"],
  ["/doces-demo", "Cardápio • Menuza"],
])("%s preserva a página correspondente", async (url, title) => {
  const r = await request(app).get(url);
  expect(r.status).toBe(200);
  expect(r.text.match(/<title>(.*?)<\/title>/)[1]).toContain(title);
});

test.each([
  "/assets/superadmin/app.js",
  "/assets/shared.js",
  "/assets/admin/style.css",
  "/assets/cardapio/css/style.css",
])("%s entrega o arquivo estático", async (url) => {
  const r = await request(app).get(url);
  expect(r.status).toBe(200);
  expect(r.headers["content-type"]).toMatch(/javascript|css/);
  expect(r.text).not.toContain("<!doctype html>");
});

test.each([
  "/api/superadmin/me",
  "/api/superadmin/dashboard",
  "/api/admin/catalogo",
])("%s exige sessão e responde JSON", async (url) => {
  const r = await request(app).get(url);
  expect(r.status).toBe(401);
  expect(r.headers["content-type"]).toMatch(/application\/json/);
});

test("recursos inexistentes não caem no cardápio", async () => {
  for (const url of ["/assets/superadmin/ausente.js", "/superadmin/ausente"])
    expect((await request(app).get(url)).status).toBe(404);
  const r = await request(app).get("/api/superadmin/ausente");
  expect(r.status).toBe(401);
  expect(r.headers["content-type"]).toMatch(/application\/json/);
});
