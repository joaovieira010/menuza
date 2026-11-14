/* Executar no host com pg_dump compatível com a versão do servidor. Nunca grava credenciais no manifesto. */
require("dotenv").config({ path: "backend/.env", quiet: true });
const fs = require("node:fs/promises"),
  path = require("node:path"),
  { spawn } = require("node:child_process"),
  crypto = require("node:crypto");
function pgEnv(value) {
  const u = new URL(value);
  return {
    ...process.env,
    PGHOST: u.searchParams.get("host") || decodeURIComponent(u.hostname),
    PGPORT: u.searchParams.get("port") || u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
    PGSSLMODE:
      u.searchParams.get("sslmode") || process.env.PGSSLMODE || "prefer",
    ...(u.searchParams.get("sslrootcert")
      ? { PGSSLROOTCERT: u.searchParams.get("sslrootcert") }
      : {}),
  };
}
function run(cmd, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env, stdio: ["ignore", "ignore", "ignore"] });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(cmd + " falhou: " + code)),
    );
  });
}
async function checksum(p) {
  const { createReadStream } = require("node:fs");
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(p)) hash.update(chunk);
  return hash.digest("hex");
}
async function backup() {
  if (!process.env.DATABASE_URL || !process.env.BACKUP_DIR)
    throw new Error(
      "Configure DATABASE_URL e BACKUP_DIR em armazenamento persistente.",
    );
  const uploads = path.resolve(process.env.UPLOAD_DIR || "backend/uploads");
  const dir = path.join(
    path.resolve(process.env.BACKUP_DIR),
    new Date().toISOString().replace(/[:.]/g, "-") +
      "-" +
      crypto.randomBytes(3).toString("hex"),
  );
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    await run(
      process.env.PG_DUMP_BIN || "pg_dump",
      [
        "--format=custom",
        "--no-owner",
        "--no-acl",
        "--file",
        path.join(dir, "database.dump"),
      ],
      pgEnv(process.env.DATABASE_URL),
    );
    let imageSource = uploads;
    const remoteFiles = [];
    if (process.env.IMAGE_STORAGE === "cloudinary") {
      const images = require("../backend/src/services/images");
      imageSource = path.join(dir, "cloudinary-uploads");
      await fs.mkdir(imageSource, { mode: 0o700 });
      for (const name of await images.listRemote()) {
        const data = await images.readRemote(name);
        await fs.writeFile(path.join(imageSource, name), data, {
          flag: "wx",
          mode: 0o600,
        });
        remoteFiles.push({
          path: name,
          bytes: data.length,
          sha256: await checksum(path.join(imageSource, name)),
        });
      }
    } else await fs.mkdir(uploads, { recursive: true });
    await run("tar", [
      "-czf",
      path.join(dir, "uploads.tar.gz"),
      "-C",
      imageSource,
      ".",
    ]);
    await fs.writeFile(
      path.join(dir, "manifest.json"),
      JSON.stringify(
        {
          version: 1,
          created_at: new Date().toISOString(),
          database_sha256: await checksum(path.join(dir, "database.dump")),
          uploads_sha256: await checksum(path.join(dir, "uploads.tar.gz")),
          image_storage: process.env.IMAGE_STORAGE || "local",
          remote_files: remoteFiles,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log("Backup concluído:", dir);
    return dir;
  } catch (e) {
    await fs.writeFile(
      path.join(dir, "FAILED"),
      "Backup incompleto: não restaurar.",
    );
    throw e;
  }
}
if (require.main === module)
  backup().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { backup, run, pgEnv, checksum };
