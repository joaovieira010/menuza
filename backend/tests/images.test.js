process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://unused@127.0.0.1/menuza_images_test";
process.env.JWT_SECRET = require("node:crypto").randomBytes(48).toString("hex");
process.env.IMAGE_STORAGE = "cloudinary";
process.env.CLOUDINARY_CLOUD_NAME = "isolated-test";
process.env.CLOUDINARY_API_KEY = "public-test-key";
process.env.CLOUDINARY_API_SECRET = "private-test-secret";
process.env.CLOUDINARY_PREFIX = "qa/menuza";
const request = require("supertest");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const app = require("../src/app");
const pool = require("../src/database/pool");
const images = require("../src/services/images");
const name = "12345678-abcd-1234-abcd-123456789abc.webp";
let objects, network, write;
beforeEach(() => {
  objects = new Map();
  write = jest.spyOn(fs, "writeFile");
  network = jest
    .spyOn(global, "fetch")
    .mockImplementation(async (url, options) => {
      if (String(url).startsWith("https://api.cloudinary.com/")) {
        const body = options.body;
        const publicId = body.get("public_id");
        const signed = `overwrite=false&public_id=${publicId}&timestamp=${body.get("timestamp")}`;
        expect(body.get("signature")).toBe(
          crypto
            .createHash("sha256")
            .update(signed + process.env.CLOUDINARY_API_SECRET)
            .digest("hex"),
        );
        expect(body.get("overwrite")).toBe("false");
        if (!objects.has(publicId))
          objects.set(
            publicId,
            Buffer.from(await body.get("file").arrayBuffer()),
          );
        return new Response("{}", { status: 200 });
      }
      const key = String(url).split("/raw/upload/")[1];
      return objects.has(key)
        ? new Response(objects.get(key))
        : new Response("", { status: 404 });
    });
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => pool.end());
test("confirma persistência remota sem gravar em disco e preserva a referência", async () => {
  const bytes = Buffer.from("imagem-normalizada-de-teste");
  expect(await images.save(name, bytes)).toBe("/uploads/" + name);
  expect(write).not.toHaveBeenCalled();
  const r = await request(app).get("/uploads/" + name);
  expect(r.status).toBe(200);
  expect(r.body).toEqual(bytes);
  expect(r.headers["content-type"]).toMatch(/image\/webp/);
  expect(r.headers["content-security-policy"]).toContain("sandbox");
});
test("reimportação idêntica funciona, colisão de conteúdo não sobrescreve", async () => {
  const bytes = Buffer.from("original");
  await images.save(name, bytes);
  await expect(images.save(name, bytes)).resolves.toBe("/uploads/" + name);
  await expect(images.save(name, Buffer.from("outro"))).rejects.toMatchObject({
    status: 502,
  });
  expect(objects.get("qa/menuza/" + name)).toEqual(bytes);
});
test("erro de upload não confirma sucesso e não recorre ao disco local", async () => {
  network.mockResolvedValueOnce(
    new Response("segredo-do-provedor", { status: 401 }),
  );
  await expect(images.save(name, Buffer.from("teste"))).rejects.toMatchObject({
    status: 502,
    message: "Armazenamento de imagens indisponível.",
  });
  expect(write).not.toHaveBeenCalled();
});
test("falha de leitura, imagem ausente e caminhos inválidos não expõem credenciais", async () => {
  const missing = await request(app).get("/uploads/" + name);
  expect(missing.status).toBe(404);
  network.mockRejectedValueOnce(new Error(process.env.CLOUDINARY_API_SECRET));
  const fail = await request(app).get("/uploads/" + name);
  expect(fail.status).toBe(502);
  expect(JSON.stringify(fail.body)).not.toContain(
    process.env.CLOUDINARY_API_SECRET,
  );
  network.mockClear();
  expect((await request(app).get("/uploads/evil.svg")).status).toBe(404);
  expect((await request(app).get("/uploads/sub/file.webp")).status).toBe(404);
  expect(network).not.toHaveBeenCalled();
});
test("resposta remota excessiva é recusada", async () => {
  network.mockResolvedValueOnce(
    new Response("x", {
      headers: { "content-length": String(9 * 1024 * 1024) },
    }),
  );
  await expect(images.readRemote(name)).rejects.toMatchObject({ status: 502 });
});
test("mantém imagens após recarregar o módulo e fornece ETag", async () => {
  await images.save(name, Buffer.from("persistente"));
  jest.resetModules();
  expect(await require("../src/services/images").readRemote(name)).toEqual(
    Buffer.from("persistente"),
  );
  const first = await request(app).get("/uploads/" + name);
  expect(
    (
      await request(app)
        .get("/uploads/" + name)
        .set("If-None-Match", first.headers.etag)
    ).status,
  ).toBe(304);
});
test("exportação lista todas as páginas e inclui arquivos sem referência no banco", async () => {
  network.mockReset();
  network.mockResolvedValueOnce(
    Response.json({
      resources: [{ public_id: "qa/menuza/" + name }],
      next_cursor: "page2",
    }),
  );
  const second = "abcd-abcd-abcd.png";
  network.mockResolvedValueOnce(
    Response.json({ resources: [{ public_id: "qa/menuza/" + second }] }),
  );
  expect(await images.listRemote()).toEqual([name, second].sort());
  expect(network.mock.calls[1][0].searchParams.get("next_cursor")).toBe(
    "page2",
  );
});
