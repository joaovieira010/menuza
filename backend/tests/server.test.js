const net = require("node:net");
const { spawn } = require("node:child_process");

test("bootstrap com cobrança desativada inicia sem consultar ou migrar banco", async () => {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        `const pool = require('./backend/src/database/pool');
        const forbidden = () => { throw new Error('BANCO_INDEVIDO'); };
        pool.query = forbidden;
        pool.connect = forbidden;
        require('./backend/src/services/billing').reconcile = forbidden;
        require('./backend/src/server');`,
      ],
      {
        env: {
          ...process.env,
          NODE_ENV: "production",
          HOST: "127.0.0.1",
          PORT: "0",
          BILLING_ENABLED: "false",
          DATABASE_URL:
            "postgresql://unused@ep-isolated.neon.tech/menuza?sslmode=verify-full",
          JWT_SECRET: require("node:crypto").randomBytes(48).toString("hex"),
          APP_ORIGIN: "https://menuza.example",
          IMAGE_STORAGE: "cloudinary",
          CLOUDINARY_CLOUD_NAME: "isolated-test",
          CLOUDINARY_API_KEY: "isolated-key",
          CLOUDINARY_API_SECRET: "isolated-secret",
        },
      },
    );
    let output = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), 3000);
    child.stdout.on("data", (data) => {
      output += data;
      if (output.includes("Painel da loja:")) child.kill("SIGTERM");
    });
    child.stderr.on("data", (data) => (output += data));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, output });
    });
  });
  expect(result.code).toBe(0);
  expect(result.output).toContain("Menuza em http");
  expect(result.output).not.toContain("BANCO_INDEVIDO");
});

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
