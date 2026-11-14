// Entrada interativa; reutiliza o provisionamento bcrypt que recusa sobrescritas.
const readline = require("node:readline/promises");
const { Writable } = require("node:stream");
const pool = require("../backend/src/database/pool");
async function main() {
  if (
    (
      await pool.query(
        "SELECT 1 FROM usuarios WHERE papel='SUPERADMIN' AND ativo=true LIMIT 1",
      )
    ).rowCount
  )
    return;
  if (!process.stdin.isTTY)
    throw new Error(
      "Execute npm run superadmin:setup em um terminal interativo.",
    );
  const visible = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const email = await visible.question("E-mail do NOVO Superadmin: ");
  visible.close();
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
  let password, confirmation;
  try {
    process.stdout.write(
      "Nova senha (12 caracteres ou mais, entrada oculta): ",
    );
    password = await prompt.question("");
    process.stdout.write("\nConfirme a senha (entrada oculta): ");
    confirmation = await prompt.question("");
    process.stdout.write("\n");
  } finally {
    prompt.close();
    hidden.end();
  }
  if (password !== confirmation) throw new Error("As senhas não conferem.");
  process.env.SUPERADMIN_EMAIL = email;
  process.env.SUPERADMIN_PASSWORD = password;
  try {
    await require("../backend/src/database/create-superadmin")();
  } finally {
    delete process.env.SUPERADMIN_PASSWORD;
    delete process.env.SUPERADMIN_EMAIL;
  }
}
main()
  .catch((e) => {
    console.error(e.code || e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
