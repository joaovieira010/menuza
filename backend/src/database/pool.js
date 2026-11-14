const { Pool } = require("pg");
const env = require("../config/env");
const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 15000,
});
// Uma desconexão de cliente ocioso não deve encerrar o servidor.
// Não registrar o objeto de erro: ele pode conter detalhes da conexão.
pool.on("error", () => console.error("database.idle_connection_error"));
module.exports = pool;
