/* Preserva a base configurada sem autorizá-la automaticamente como origem de migração. */
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { Client } = require("pg");
require("dotenv").config({ path: "backend/.env", quiet: true });
process.umask(0o077);
const bin = process.env.PUBLICATION_PG_BIN || "/usr/lib/postgresql/12/bin";
const quote = (s) => '"' + s.replace(/"/g, '""') + '"';
const digest = (s) => crypto.createHash("sha256").update(s).digest("hex");
async function hash(file) {
  return digest(await fs.readFile(file));
}
async function run(name, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(name, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.resume(); // Não expor detalhes que possam conter credenciais.
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(path.basename(name) + " falhou: " + code)),
    );
  });
}
async function inventory(dir, prefix = "") {
  const result = [];
  const entries = (
    await fs.readdir(path.join(dir, prefix), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name));
  for (const x of entries) {
    const relative = path.join(prefix, x.name),
      full = path.join(dir, relative);
    if (x.isDirectory()) result.push(...(await inventory(dir, relative)));
    else if (x.isFile())
      result.push({
        path: relative,
        size: (await fs.stat(full)).size,
        sha256: await hash(full),
      });
    else throw new Error("Upload não regular; revisão manual necessária.");
  }
  return result;
}
async function state(c) {
  const tables = (
    await c.query(
      "SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2",
    )
  ).rows;
  const result = [],
    rows = {};
  for (const t of tables) {
    const data = (
      await c.query(
        `SELECT row_to_json(t)::text AS row FROM ${quote(t.schemaname)}.${quote(t.tablename)} t ORDER BY row_to_json(t)::text COLLATE "C"`,
      )
    ).rows.map((x) => x.row);
    result.push({
      schema: t.schemaname,
      table: t.tablename,
      count: data.length,
      sha256: digest(data.map((r) => r + "\n").join("")),
    });
    rows[t.tablename] = data.map((r) => JSON.parse(r));
  }
  const sequences = [];
  for (const s of (
    await c.query(
      "SELECT schemaname,sequencename FROM pg_sequences WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2",
    )
  ).rows) {
    sequences.push({
      ...s,
      ...(
        await c.query(
          `SELECT last_value::text,is_called FROM ${quote(s.schemaname)}.${quote(s.sequencename)}`,
        )
      ).rows[0],
    });
  }
  const large = (
    await c.query(
      "SELECT oid::text AS oid,encode(lo_get(oid),'hex') AS data FROM pg_largeobject_metadata ORDER BY oid",
    )
  ).rows;
  return {
    summary: {
      tables: result,
      sequences,
      large_objects: {
        count: large.length,
        sha256: digest(JSON.stringify(large)),
      },
    },
    rows,
  };
}
async function readState(c) {
  await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    return await state(c);
  } finally {
    await c.query("ROLLBACK");
  }
}
function compareRows(oldRows, currentRows) {
  const result = {};
  for (const [table, before] of Object.entries(oldRows)) {
    const after = currentRows[table] || [];
    const key = ["id", "estabelecimento_id", "nome"].find(
      (k) => before.length && before.every((r) => Object.hasOwn(r, k)),
    );
    if (!key) {
      result[table] = {
        before: before.length,
        after: after.length,
        equal: JSON.stringify(before) === JSON.stringify(after),
      };
      continue;
    }
    const map = new Map(after.map((r) => [String(r[key]), r]));
    const changed = [],
      missing = [];
    for (const r of before) {
      const now = map.get(String(r[key]));
      if (!now) missing.push(r[key]);
      else {
        const fields = Object.keys(r).filter(
          (k) => JSON.stringify(r[k]) !== JSON.stringify(now[k]),
        );
        if (fields.length) changed.push({ key: r[key], fields });
      }
    }
    result[table] = {
      before: before.length,
      after: after.length,
      missing,
      changed,
      added: after
        .filter((r) => !before.some((b) => String(b[key]) === String(r[key])))
        .map((r) => r[key]),
    };
  }
  return result;
}
const normalizeSchema = (s) =>
  s
    .replace(
      /\('((?:[^']|'')*)'::character varying\)::text/g,
      "'$1'::character varying",
    )
    .replace(
      /\(\(ARRAY\[((?:'(?:[^']|'')*'::character varying)(?:, '(?:[^']|'')*'::character varying)*)\]\)::text\[\]\)/g,
      "(ARRAY[$1])",
    );
async function main() {
  const original = process.env.DATABASE_URL;
  const u = new URL(original);
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== "55433" ||
    u.pathname !== "/menuza_recovered_20261114"
  )
    throw new Error("Origem difere da base inventariada.");
  const old = path.resolve(".local/preservation-20261114/validated");
  const sums = (await fs.readFile(path.join(old, "SHA256SUMS"), "utf8"))
    .trim()
    .split("\n");
  for (const line of sums) {
    const [, expected, file] = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/) || [];
    if (!file || (await hash(path.join(old, file))) !== expected)
      throw new Error("Backup anterior com hash divergente.");
  }
  const root = await fs.mkdtemp(path.resolve(".local/publication-"));
  const additional = await fs.mkdtemp(
    path.join(os.tmpdir(), "menuza-publication-"),
  );
  const cluster = path.join(root, "verification-cluster"),
    socket = path.join(additional, "socket");
  const uploads = path.resolve(process.env.UPLOAD_DIR || "backend/uploads");
  const source = new Client({
    connectionString: original,
    application_name: "menuza_publication_readonly",
    connectionTimeoutMillis: 5000,
    options:
      "-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=3000",
  });
  const pgEnv = {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port,
    PGDATABASE: u.pathname.slice(1),
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGOPTIONS: "-c default_transaction_read_only=on",
  };
  const local = {
    ...process.env,
    PGHOST: socket,
    PGPORT: "55447",
    PGUSER: process.env.USER || "antonio",
  };
  delete local.PGPASSWORD;
  delete local.PGOPTIONS;
  let started = false;
  try {
    await source.connect();
    await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const baseline = await state(source);
    const identity = (
      await source.query(
        "SELECT current_database() AS database,inet_server_port() AS port,version(),current_setting('transaction_read_only') AS read_only",
      )
    ).rows[0];
    const snapshot = (await source.query("SELECT pg_export_snapshot() AS s"))
      .rows[0].s;
    const files = await inventory(uploads);
    await run(
      path.join(bin, "pg_dump"),
      [
        "--format=custom",
        "--snapshot=" + snapshot,
        "--file=" + path.join(root, "database.dump"),
      ],
      pgEnv,
    );
    await run(
      path.join(bin, "pg_dump"),
      [
        "--schema-only",
        "--no-owner",
        "--no-acl",
        "--snapshot=" + snapshot,
        "--file=" + path.join(root, "schema.sql"),
      ],
      pgEnv,
    );
    await run("tar", [
      "-czf",
      path.join(root, "uploads.tar.gz"),
      "-C",
      uploads,
      ".",
    ]);
    await fs.copyFile(
      "backend/.env",
      path.join(root, "application.env.private"),
    );
    await fs.chmod(path.join(root, "application.env.private"), 0o600);
    await source.query("ROLLBACK");
    if (JSON.stringify(files) !== JSON.stringify(await inventory(uploads)))
      throw new Error("Uploads mudaram durante o backup.");
    await fs.mkdir(socket, { mode: 0o700 });
    await run(path.join(bin, "initdb"), [
      "-D",
      cluster,
      "--auth=trust",
      "--no-locale",
      "--encoding=UTF8",
    ]);
    await run(path.join(bin, "pg_ctl"), [
      "-D",
      cluster,
      "-l",
      path.join(root, "verification.log"),
      "-o",
      `-c listen_addresses='' -c unix_socket_directories='${socket}' -p 55447`,
      "-w",
      "start",
    ]);
    started = true;
    const restoredStates = {};
    for (const [name, file] of [
      ["menuza_previous_backup", path.join(old, "database.dump")],
      ["menuza_current_backup", path.join(root, "database.dump")],
    ]) {
      await run(
        path.join(bin, "createdb"),
        ["--template=template0", name],
        local,
      );
      await run(
        path.join(bin, "pg_restore"),
        [
          "--exit-on-error",
          "--single-transaction",
          "--no-owner",
          "--no-acl",
          "--dbname=" + name,
          file,
        ],
        local,
      );
      const c = new Client({
        host: socket,
        port: 55447,
        user: local.PGUSER,
        database: name,
      });
      await c.connect();
      try {
        restoredStates[name] = await readState(c);
      } finally {
        await c.end();
      }
    }
    const previous = JSON.parse(
      await fs.readFile(path.join(old, "source-state.json"), "utf8"),
    );
    if (
      JSON.stringify(previous) !==
      JSON.stringify(restoredStates.menuza_previous_backup.summary)
    )
      throw new Error("Backup antigo diverge do estado validado.");
    if (
      JSON.stringify(baseline.summary) !==
      JSON.stringify(restoredStates.menuza_current_backup.summary)
    )
      throw new Error("Restauração atual diverge da origem.");
    await run(
      path.join(bin, "pg_dump"),
      [
        "--schema-only",
        "--no-owner",
        "--no-acl",
        "--file=" + path.join(root, "restored-schema.sql"),
      ],
      { ...local, PGDATABASE: "menuza_current_backup" },
    );
    const schemaEqual =
      normalizeSchema(
        await fs.readFile(path.join(root, "schema.sql"), "utf8"),
      ) ===
      normalizeSchema(
        await fs.readFile(path.join(root, "restored-schema.sql"), "utf8"),
      );
    if (!schemaEqual) throw new Error("Estrutura restaurada divergente.");
    await fs.mkdir(path.join(root, "restored-uploads"), { mode: 0o700 });
    await run("tar", [
      "-xzf",
      path.join(root, "uploads.tar.gz"),
      "-C",
      path.join(root, "restored-uploads"),
    ]);
    if (
      JSON.stringify(files) !==
      JSON.stringify(await inventory(path.join(root, "restored-uploads")))
    )
      throw new Error("Imagens restauradas divergentes.");
    const differences = compareRows(
      restoredStates.menuza_previous_backup.rows,
      baseline.rows,
    );
    const rayssaOld =
      restoredStates.menuza_previous_backup.rows.estabelecimentos.find(
        (r) => r.id === 2 || r.id === "2",
      );
    const rayssaNow = baseline.rows.estabelecimentos.find(
      (r) => String(r.id) === "2",
    );
    const storeUnchanged =
      JSON.stringify(rayssaOld) === JSON.stringify(rayssaNow);
    const originalUsers = restoredStates.menuza_previous_backup.rows.usuarios;
    const usersUnchanged = originalUsers.every(
      (r) =>
        JSON.stringify(r) ===
        JSON.stringify(
          baseline.rows.usuarios.find((n) => String(n.id) === String(r.id)),
        ),
    );
    const after = await readState(source);
    const report = {
      created_at: new Date().toISOString(),
      source: identity,
      source_selection_status:
        "BLOCKED: cluster 5432 ainda sem acesso; não migrar nem publicar dados reais",
      root,
      additional_copy: additional,
      previous_backup_restored: true,
      current_backup_restored: true,
      all_tables_sequences_large_objects_equal: true,
      schema_equal: schemaEqual,
      original_users_and_password_hashes_equal: usersUnchanged,
      rayssa_record_equal: storeUnchanged,
      rayssa: {
        id: rayssaNow?.id,
        nome: rayssaNow?.nome,
        slug: rayssaNow?.slug,
        responsavel: rayssaNow?.responsavel,
      },
      differences,
      state: baseline.summary,
      uploads: {
        count: files.length,
        bytes: files.reduce((s, f) => s + f.size, 0),
        files,
      },
      source_still_equal:
        JSON.stringify(after.summary) === JSON.stringify(baseline.summary),
      original_env_equal:
        (await hash("backend/.env")) ===
        (await hash(path.join(root, "application.env.private"))),
    };
    await fs.writeFile(
      path.join(root, "validation.json"),
      JSON.stringify(report, null, 2),
    );
    const artifacts = [
      "database.dump",
      "uploads.tar.gz",
      "application.env.private",
      "schema.sql",
      "restored-schema.sql",
      "validation.json",
    ];
    const lines = [];
    for (const f of artifacts) {
      await fs.copyFile(path.join(root, f), path.join(additional, f));
      await fs.chmod(path.join(additional, f), 0o600);
      const h = await hash(path.join(root, f));
      if (h !== (await hash(path.join(additional, f))))
        throw new Error("Cópia adicional divergente.");
      lines.push(h + "  " + f);
    }
    await fs.writeFile(path.join(root, "SHA256SUMS"), lines.join("\n") + "\n");
    await fs.copyFile(
      path.join(root, "SHA256SUMS"),
      path.join(additional, "SHA256SUMS"),
    );
    console.log(
      JSON.stringify(
        {
          root,
          additional_copy: additional,
          previous_backup_restored: true,
          current_backup_restored: true,
          storeUnchanged,
          usersUnchanged,
          source_still_equal: report.source_still_equal,
          tables: baseline.summary.tables.length,
          differences,
        },
        null,
        2,
      ),
    );
  } finally {
    if (started)
      await run(path.join(bin, "pg_ctl"), [
        "-D",
        cluster,
        "-m",
        "fast",
        "-w",
        "stop",
      ]);
    await source.end();
  }
}
main().catch((e) => {
  console.error(e.code || e.message);
  process.exitCode = 1;
});
