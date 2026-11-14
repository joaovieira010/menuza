const bcrypt = require("bcrypt");
const pool = require("./pool");
async function create() {
  const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase(),
    senha = process.env.SUPERADMIN_PASSWORD;
  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !senha ||
    senha.length < 12 ||
    Buffer.byteLength(senha) > 72
  )
    throw new Error(
      "Configure SUPERADMIN_EMAIL e SUPERADMIN_PASSWORD (12 caracteres, até 72 bytes).",
    );
  // Nunca sobrescreve credenciais existentes silenciosamente.
  await pool.query(
    "INSERT INTO usuarios(email,senha_hash,papel) VALUES($1,$2,'SUPERADMIN')",
    [email, await bcrypt.hash(senha, 12)],
  );
  console.log(
    "Superadmin criado. Remova SUPERADMIN_PASSWORD do ambiente após a criação.",
  );
}
if (require.main === module)
  create()
    .catch((e) => {
      console.error(e.code === "23505" ? "E-mail já cadastrado." : e.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
module.exports = create;
