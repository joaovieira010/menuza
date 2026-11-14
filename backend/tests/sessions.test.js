// Integração em banco descartável; fixtures de autenticação em tabelas temporárias.
require("dotenv").config({ path: "backend/.env", quiet: true });
const target = process.env.TEST_DATABASE_URL;
if (
  !target ||
  !new URL(target).pathname.endsWith("_test") ||
  target === process.env.DATABASE_URL
)
  throw new Error(
    "TEST_DATABASE_URL separado, terminado em _test, obrigatório.",
  );
process.env.DATABASE_URL = target;
process.env.NODE_ENV = "test";
const crypto = require("node:crypto");
process.env.JWT_SECRET = crypto.randomBytes(48).toString("hex");
const bcrypt = require("bcrypt");
const request = require("supertest");
const pool = require("../src/database/pool");
const app = require("../src/app");
const password = " " + crypto.randomBytes(20).toString("hex") + " ";
let client, query;

beforeAll(async () => {
  await require("../src/database/migrate")(pool);
  client = await pool.connect();
  await client.query("BEGIN");
  // Cada consulta da aplicação usa esta conexão e suas tabelas temporárias.
  // Não copiamos triggers nem registros persistentes; IDs são explícitos.
  for (const table of [
    "usuarios",
    "sessoes",
    "estabelecimentos",
    "assinaturas",
    "planos",
    "politica_cobranca",
  ]) {
    await client.query(
      `CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS) ON COMMIT DROP`,
    );
    if (table !== "assinaturas")
      await client.query(`ALTER TABLE ${table} ALTER COLUMN id DROP DEFAULT`);
  }
  await client.query("ALTER TABLE sessoes ALTER COLUMN expira_em SET NOT NULL");
  const hash = await bcrypt.hash(password, 12);
  await client.query(
    `INSERT INTO usuarios(id,email,senha_hash,papel,ativo,estabelecimento_id) VALUES
    (1,'owner@auth.test',$1,'SUPERADMIN',true,NULL),
    (2,'store@auth.test',$1,'STORE_ADMIN',true,1),
    (3,'inactive@auth.test',$1,'SUPERADMIN',false,NULL)`,
    [hash],
  );
  await client.query(
    "INSERT INTO estabelecimentos(id,nome,slug,whatsapp,situacao) VALUES(1,'Fixture','auth-test','11999999999','active')",
  );
  await client.query(
    "INSERT INTO planos(id,nome,preco) VALUES(1,'Fixture',4990)",
  );
  await client.query(
    "INSERT INTO politica_cobranca(id,lembrete_dias,suspender_dias,suspender_automaticamente,reativar_automaticamente) VALUES(1,3,7,true,true)",
  );
  await client.query(
    "INSERT INTO assinaturas(estabelecimento_id,plano_id,valor,vencimento,status,suspensao_manual) VALUES(1,1,4990,current_date+30,'active',false)",
  );
  query = jest
    .spyOn(pool, "query")
    .mockImplementation((...args) => client.query(...args));
}, 30000);

afterAll(async () => {
  query?.mockRestore();
  if (client) {
    await client.query("ROLLBACK");
    client.release();
  }
  await pool.end();
});

test.each([
  ["superadmin", "owner@auth.test", "SUPERADMIN", "menuza_platform"],
  ["admin", "store@auth.test", "STORE_ADMIN", "menuza"],
])(
  "%s autentica com bcrypt, persiste sessão, valida cookie e faz logout",
  async (route, email, role, cookie) => {
    const agent = request.agent(app);
    const response = await agent
      .post(`/api/${route}/login`)
      .send({ email: email.toUpperCase(), senha: password });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ email, papel: role });
    expect(response.headers["set-cookie"][0]).toContain(`${cookie}=`);
    expect(response.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(response.headers["set-cookie"][0]).toContain("SameSite=Strict");
    const me = await agent.get(`/api/${route}/me`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);
    expect(me.body.senha_hash).toBeUndefined();
    const other = route === "admin" ? "superadmin" : "admin";
    expect((await agent.get(`/api/${other}/me`)).status).toBe(401);
    expect((await agent.post(`/api/${route}/logout`)).status).toBe(200);
    expect((await agent.get(`/api/${route}/me`)).status).toBe(401);
  },
);

test.each([
  ["superadmin", "owner@auth.test", "wrong"],
  ["superadmin", "missing@auth.test", password],
  ["superadmin", "inactive@auth.test", password],
  ["superadmin", "store@auth.test", password],
  ["admin", "owner@auth.test", password],
  ["admin", "store@auth.test", "wrong"],
  ["superadmin", "owner@auth.test", password.trim()],
])(
  "%s rejeita credenciais inválidas sem criar sessão (%s)",
  async (route, email, senha) => {
    const before = (await client.query("SELECT count(*) AS n FROM sessoes"))
      .rows[0].n;
    const response = await request(app)
      .post(`/api/${route}/login`)
      .send({ email, senha });
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ erro: "E-mail ou senha inválidos." });
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(
      (await client.query("SELECT count(*) AS n FROM sessoes")).rows[0].n,
    ).toBe(before);
  },
);

test("validação rejeita payload sem senha antes de consultar o banco", async () => {
  query.mockClear();
  const response = await request(app)
    .post("/api/admin/login")
    .send({ email: "store@auth.test" });
  expect(response.status).toBe(400);
  expect(query).not.toHaveBeenCalled();
});

test("loja suspensa continua bloqueada mesmo com senha correta", async () => {
  await client.query(
    "UPDATE estabelecimentos SET situacao='suspended' WHERE id=1",
  );
  const response = await request(app)
    .post("/api/admin/login")
    .send({ email: "store@auth.test", senha: password });
  expect(response.status).toBe(423);
  expect(response.headers["set-cookie"]).toBeUndefined();
});
