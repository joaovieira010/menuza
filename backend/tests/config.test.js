const { spawnSync } = require("node:child_process");
const env = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://unused@db/menuza?sslmode=verify-full",
  IMAGE_STORAGE: "cloudinary",
  CLOUDINARY_CLOUD_NAME: "test-cloud",
  CLOUDINARY_API_KEY: "test-key",
  CLOUDINARY_API_SECRET: "test-secret",
  JWT_SECRET: require("node:crypto").randomBytes(48).toString("hex"),
  APP_ORIGIN: "https://menuza.example",
  APP_ALLOWED_ORIGINS: "",
};
function check(extra) {
  return spawnSync(
    process.execPath,
    ["-e", "require('./backend/src/config/env')"],
    { env: { ...env, ...extra }, encoding: "utf8" },
  );
}
test.each([
  "http://menuza.example",
  "https://localhost",
  "https://127.0.0.1",
  "https://menuza.example/",
])("produção recusa origem %s", (origin) =>
  expect(check({ APP_ORIGIN: origin }).status).not.toBe(0),
);
test("produção recusa banco descartável e segredo de exemplo", () => {
  expect(
    check({ DATABASE_URL: "postgresql://unused@db/menuza_test" }).status,
  ).not.toBe(0);
  expect(
    check({
      JWT_SECRET: "gere_um_segredo_aleatorio_de_pelo_menos_32_caracteres",
    }).status,
  ).not.toBe(0);
});
test("produção aceita origem HTTPS exata e secret provisionado", () =>
  expect(check({}).status).toBe(0));
test("produção recusa storage efêmero, pooler transacional e TLS incompleto", () => {
  expect(check({ IMAGE_STORAGE: "local" }).status).not.toBe(0);
  expect(
    check({
      DATABASE_URL:
        "postgresql://unused@ep-demo-pooler.neon.tech/menuza?sslmode=verify-full",
    }).status,
  ).not.toBe(0);
  expect(
    check({ DATABASE_URL: "postgresql://unused@db/menuza?sslmode=require" })
      .status,
  ).not.toBe(0);
  expect(check({ CLOUDINARY_API_SECRET: "" }).status).not.toBe(0);
});
test("URL inválida não vaza seu valor no diagnóstico", () => {
  const result = check({ DATABASE_URL: "credencial-privada-invalida" });
  expect(result.status).not.toBe(0);
  expect(result.stderr).not.toContain("credencial-privada-invalida");
});
test.each(["", "origem-privada-invalida"])(
  "APP_ORIGIN ausente ou inválido tem diagnóstico seguro",
  (origin) => {
    const result = check({ APP_ORIGIN: origin });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Produção exige APP_ORIGIN público com HTTPS.",
    );
    expect(result.stderr).not.toContain("origem-privada-invalida");
  },
);

test("produção aceita allowlist HTTPS explícita dos dois domínios", () => {
  expect(
    check({
      APP_ALLOWED_ORIGINS:
        " https://menuzatech.com.br, https://menuza-0ax7.onrender.com ",
    }).status,
  ).toBe(0);
});

test.each([
  "*",
  "null",
  "https://*.onrender.com",
  "http://menuzatech.com.br",
  "https://menuzatech.com.br/",
  "https://menuzatech.com.br/path",
  "https://menuzatech.com.br?secret=privado",
  "https://user:privado@menuzatech.com.br",
  "https://localhost",
  "https://127.0.0.1",
  "https://[::1]",
  "https://menuzatech.com.br,origem-privada-invalida",
])("produção rejeita alias inválido sem vazar configuração (%s)", (value) => {
  const result = check({ APP_ALLOWED_ORIGINS: value });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(
    "APP_ALLOWED_ORIGINS deve conter origens HTTP(S) exatas",
  );
  expect(result.stderr).not.toContain("origem-privada-invalida");
  expect(result.stderr).not.toContain("privado");
});
