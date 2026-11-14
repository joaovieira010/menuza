// Diagnóstico somente de leitura: nunca redefine credenciais nem cria sessões.
const readline = require("node:readline/promises");
const { Writable } = require("node:stream");
const bcrypt = require("bcrypt");
const pool = require("../backend/src/database/pool");
const { parse, schemas } = require("../backend/src/middlewares/validation");

function usageError(message) {
  return Object.assign(new Error(message), { safeDiagnostic: true });
}

async function passwordPrompt() {
  if (!process.stdin.isTTY)
    throw usageError(
      "Execute em um terminal interativo; a senha não é aceita por argumento ou pipe.",
    );
  const hidden = new Writable({
    write(chunk, encoding, callback) {
      callback();
    },
  });
  const prompt = readline.createInterface({
    input: process.stdin,
    output: hidden,
    terminal: true,
    historySize: 0,
  });
  process.stderr.write("Senha (entrada oculta): ");
  try {
    return await prompt.question("");
  } finally {
    prompt.close();
    hidden.end();
    process.stderr.write("\n");
  }
}

async function check(email, senha, role) {
  const credentials = parse(schemas.login, { email, senha });
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const {
      rows: [database],
    } = await client.query(
      "SELECT current_database() AS banco, inet_server_addr()::text AS servidor, inet_server_port() AS porta",
    );
    const {
      rows: [user],
    } = await client.query(
      "SELECT * FROM usuarios WHERE email=$1 AND papel=$2 AND ativo=true",
      [credentials.email, role],
    );
    const result = { ...database, papel: role, conta_encontrada: !!user };
    if (user) {
      result.formato_bcrypt_valido = /^\$2[ab]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(
        user.senha_hash,
      );
      result.senha_confere = await bcrypt.compare(
        credentials.senha,
        user.senha_hash,
      );
      if (role === "STORE_ADMIN" && result.senha_confere) {
        try {
          await require("../backend/src/services/billing").assertAccess(
            client,
            user.estabelecimento_id,
          );
          result.acesso_loja_liberado = true;
        } catch (error) {
          if (error.status !== 423) throw error;
          result.acesso_loja_liberado = false;
        }
      }
    }
    console.log(JSON.stringify(result, null, 2));
    return !!result.senha_confere && result.acesso_loja_liberado !== false;
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

async function main() {
  const [email, role = "SUPERADMIN", ...extra] = process.argv.slice(2);
  if (!email || !["SUPERADMIN", "STORE_ADMIN"].includes(role) || extra.length)
    throw usageError(
      "Uso: npm run auth:check -- email [SUPERADMIN|STORE_ADMIN]. Não inclua a senha.",
    );
  const senha = await passwordPrompt();
  if (!(await check(email, senha, role))) process.exitCode = 1;
}
if (require.main === module)
  main()
    .catch((error) => {
      // Erros de validação/driver podem carregar valores de entrada; não os imprima.
      console.error(
        "Diagnóstico não concluído:",
        error.safeDiagnostic ? error.message : error.code || error.name,
      );
      process.exitCode = 1;
    })
    .finally(() => pool.end());
module.exports = { check };
