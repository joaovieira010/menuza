const pool = require("../backend/src/database/pool");
(async () => {
  const {
    rows: [r],
  } = await pool.query(
    "SELECT current_database() AS db, inet_server_port() AS port, (SELECT count(*)::int FROM migrations) AS migrations",
  );
  if (
    r.db !== "menuza_recovered_20261114" ||
    r.port !== 55433 ||
    r.migrations !== 6
  )
    throw new Error("Base recuperada não validada.");
  console.log("Conexão validada: base recuperada separada, seis migrations.");
})()
  .catch((e) => {
    console.error(e.code || e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
