/* Importa somente uma cópia restaurada e verificada; não escreve no PostgreSQL. */
require("dotenv").config({ path: "backend/.env", quiet: true });
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
async function main() {
  if (process.env.IMAGE_STORAGE !== "cloudinary")
    throw new Error("Configure IMAGE_STORAGE=cloudinary.");
  const reportPath = process.env.CLOUDINARY_SOURCE_REPORT;
  if (!reportPath)
    throw new Error(
      "Informe CLOUDINARY_SOURCE_REPORT de uma origem inequivocamente verificada.",
    );
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  if (
    report.source_selection_status !== "VERIFIED" ||
    !report.current_backup_restored ||
    !report.source_still_equal
  )
    throw new Error("Origem não liberada: importação bloqueada.");
  const dir = path.join(
    path.dirname(path.resolve(reportPath)),
    "restored-uploads",
  );
  const expected = report.uploads.files;
  if (!Array.isArray(expected) || expected.length !== report.uploads.count)
    throw new Error("Inventário inválido.");
  // Valida todo o conjunto antes da primeira gravação remota.
  const files = [];
  for (const f of expected) {
    if (!/^[a-f0-9-]+\.(png|jpg|webp)$/.test(f.path))
      throw new Error("Nome inválido no inventário.");
    const data = await fs.readFile(path.join(dir, f.path));
    if (
      data.length !== f.size ||
      crypto.createHash("sha256").update(data).digest("hex") !== f.sha256
    )
      throw new Error("Imagem diverge do backup validado.");
    files.push([f.path, data]);
  }
  const images = require("../backend/src/services/images");
  for (const [name, data] of files) await images.putRemote(name, data);
  console.log(
    JSON.stringify({
      imported_and_verified: files.length,
      references_changed: false,
      database_accessed: false,
    }),
  );
}
main().catch((e) => {
  console.error(e.code || e.message);
  process.exitCode = 1;
});
