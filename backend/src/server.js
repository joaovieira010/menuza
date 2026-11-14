const app = require("./app");
const pool = require("./database/pool");
const { port, host } = require("./config/env");
const billing = require("./services/billing");
const check = () =>
  billing
    .reconcile()
    .catch((e) => console.error("billing.failed", e.code || e.name));
let timer;
const server = app.listen(port, host, (err) => {
  // Express 5 também chama este callback quando o bind falha.
  if (err) return;
  console.log(`Menuza em http://localhost:${port} (PID ${process.pid})`);
  console.log(`Superadmin: http://localhost:${port}/superadmin`);
  console.log(`Painel da loja: http://localhost:${port}/admin`);
  if (process.env.BILLING_ENABLED !== "false") {
    check();
    timer = setInterval(check, 15 * 60 * 1000);
    timer.unref();
  }
});
server.on("error", async (err) => {
  if (err.code === "EADDRINUSE")
    console.error(
      `A porta ${port} já está em uso. Esta instância não iniciou. Encerre a instância anterior do Menuza e execute npm start novamente; durante o desenvolvimento, use npm run dev para recarregar alterações no backend.`,
    );
  else console.error("Falha ao iniciar o Menuza:", err.code || err.name);
  await pool.end();
  process.exitCode = 1;
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(
    signal,
    () => (
      clearInterval(timer),
      server.close(() => pool.end().then(() => process.exit(0)))
    ),
  );
