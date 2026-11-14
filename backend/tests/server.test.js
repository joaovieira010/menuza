const net = require("node:net");
const { spawn } = require("node:child_process");

test("porta ocupada falha com diagnóstico sem iniciar cobrança", async () => {
  const occupied = net.createServer();
  await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "-e",
          // Falha explícita se o bootstrap tentar acessar a cobrança antes de ouvir.
          'require("./backend/src/services/billing").reconcile = () => { throw new Error("COBRANCA_INDEVIDA"); }; require("./backend/src/server");',
        ],
        {
          env: {
            ...process.env,
            NODE_ENV: "test",
            HOST: "127.0.0.1",
            PORT: String(occupied.address().port),
            DATABASE_URL: "postgresql://unused@127.0.0.1/menuza_test",
            JWT_SECRET: "segredo-unitario-efemero-sem-uso-em-producao",
          },
        },
      );
      let output = "";
      child.stdout.on("data", (data) => (output += data));
      child.stderr.on("data", (data) => (output += data));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, output }));
    });
    expect(result.code).toBe(1);
    expect(result.output).toContain("já está em uso");
    expect(result.output).toContain("Esta instância não iniciou");
    expect(result.output).not.toContain("COBRANCA_INDEVIDA");
    expect(result.output).not.toContain("Menuza em http");
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }
});
