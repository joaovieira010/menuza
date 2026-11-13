const { Pool } = require("pg");
const env = require("../config/env");
module.exports = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 5000,
});
