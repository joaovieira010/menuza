const app = require("./app");
const pool = require("./database/pool");
const { port } = require("./config/env");
const server = app.listen(port, "127.0.0.1", () =>
  console.log(`Menuza em http://localhost:${port}`),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => pool.end().then(() => process.exit(0))),
  );
