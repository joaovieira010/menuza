/* Revalida a fonte recuperada autorizada; apenas SELECT e dumps de leitura. */
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { Client } = require("pg");
require("dotenv").config({ path: "backend/.env", quiet: true });
process.umask(0o077);
const bin = process.env.PUBLICATION_PG_BIN || "/usr/lib/postgresql/12/bin";
const previous = path.resolve(".local/preservation-20261114/validated");
const publication = path.resolve(".local/publication-Be8grd");
const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const hash = async (file) => digest(await fs.readFile(file));
const quote = (value) => '"' + value.replace(/"/g, '""') + '"';
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(ok, message) {
  if (!ok) throw Error(message);
}
async function run(cmd, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.resume();
    child.on("error", (e) => reject(Error(path.basename(cmd) + ": " + e.code)));
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(Error(path.basename(cmd) + " falhou: " + code)),
    );
  });
}
async function manifests() {
  const evidence = [];
  for (const dir of [previous, publication]) {
    const manifest = path.join(dir, "SHA256SUMS");
    evidence.push({ path: manifest, sha256: await hash(manifest) });
    for (const line of (await fs.readFile(manifest, "utf8"))
      .trim()
      .split("\n")) {
      const match = line.match(/^([a-f0-9]{64})\s+([\w.-]+)$/);
      check(match, "Linha inválida no manifesto: " + manifest);
      const file = path.join(dir, match[2]);
      check((await hash(file)) === match[1], "Hash divergente: " + file);
      evidence.push({ path: file, sha256: match[1] });
    }
  }
  return evidence;
}
// Lê os blocos COPY como texto, sem executar o SQL e sem gravar dados pessoais.
function copyTables(sql) {
  const result = {};
  const regex = /^COPY ([^\n]+) FROM stdin;\n([\s\S]*?)^\\\.\n/gm;
  for (const match of sql.matchAll(regex)) {
    check(!result[match[1]], "Tabela COPY duplicada.");
    result[match[1]] = match[2] ? match[2].slice(0, -1).split("\n") : [];
  }
  check(Object.keys(result).length === 21, "Esperadas 21 tabelas COPY.");
  return result;
}
function compareCopies(before, after, subset) {
  check(
    equal(Object.keys(before).sort(), Object.keys(after).sort()),
    "Estrutura COPY divergente.",
  );
  return Object.keys(before).map((table) => {
    const counts = new Map();
    for (const row of after[table]) counts.set(row, (counts.get(row) || 0) + 1);
    for (const row of before[table]) {
      check(
        counts.get(row) > 0,
        "Registro ausente ou alterado em " + table.split(" ")[0],
      );
      counts.set(row, counts.get(row) - 1);
    }
    if (!subset)
      check(
        before[table].length === after[table].length,
        "Contagem divergente em " + table.split(" ")[0],
      );
    return {
      table: table.split(" ")[0],
      before: before[table].length,
      after: after[table].length,
      all_original_rows_identical: true,
      added: after[table].length - before[table].length,
    };
  });
}
async function state(client) {
  const tables = [];
  for (const t of (
    await client.query(
      "SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2",
    )
  ).rows) {
    const rows = (
      await client.query(
        `SELECT row_to_json(t)::text AS row FROM ${quote(t.schemaname)}.${quote(t.tablename)} t ORDER BY row_to_json(t)::text COLLATE "C"`,
      )
    ).rows;
    tables.push({
      schema: t.schemaname,
      table: t.tablename,
      count: rows.length,
      sha256: digest(rows.map((r) => r.row + "\n").join("")),
    });
  }
  const sequences = [];
  for (const s of (
    await client.query(
      "SELECT schemaname,sequencename FROM pg_sequences WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2",
    )
  ).rows) {
    sequences.push({
      ...s,
      ...(
        await client.query(
          `SELECT last_value::text,is_called FROM ${quote(s.schemaname)}.${quote(s.sequencename)}`,
        )
      ).rows[0],
    });
  }
  const large = (
    await client.query(
      "SELECT oid::text AS oid,encode(lo_get(oid),'hex') AS data FROM pg_largeobject_metadata ORDER BY oid",
    )
  ).rows;
  return {
    tables,
    sequences,
    large_objects: {
      count: large.length,
      sha256: digest(JSON.stringify(large)),
    },
  };
}
async function inventory(dir) {
  const files = [];
  for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    check(
      entry.isFile() && /^[a-f0-9-]+\.(png|jpg|webp)$/.test(entry.name),
      "Upload inválido: " + entry.name,
    );
    const file = path.join(dir, entry.name);
    files.push({
      path: entry.name,
      size: (await fs.stat(file)).size,
      sha256: await hash(file),
    });
  }
  return files;
}
async function main() {
  check(
    process.env.PUBLICATION_SOURCE_AUTHORIZATION === "recovered-55433",
    "Exige PUBLICATION_SOURCE_AUTHORIZATION=recovered-55433 após autorização explícita do usuário.",
  );
  const u = new URL(process.env.DATABASE_URL);
  check(
    u.hostname === "127.0.0.1" &&
      u.port === "55433" &&
      u.pathname === "/menuza_recovered_20261114" &&
      !u.search,
    "Conexão difere da fonte autorizada.",
  );
  const evidence = await manifests();
  const prior = JSON.parse(
    await fs.readFile(path.join(publication, "validation.json"), "utf8"),
  );
  const initial = JSON.parse(
    await fs.readFile(path.join(previous, "validation.json"), "utf8"),
  );
  check(
    prior.current_backup_restored &&
      prior.source_still_equal &&
      prior.schema_equal &&
      initial.verification.restored,
    "Evidência anterior de restauração incompleta.",
  );
  const oldCopies = copyTables(
    await run(path.join(bin, "pg_restore"), [
      "--data-only",
      "--file=-",
      path.join(previous, "database.dump"),
    ]),
  );
  const publicationCopies = copyTables(
    await run(path.join(bin, "pg_restore"), [
      "--data-only",
      "--file=-",
      path.join(publication, "database.dump"),
    ]),
  );
  const env = {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port,
    PGDATABASE: u.pathname.slice(1),
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGOPTIONS: "-c default_transaction_read_only=on",
  };
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    application_name: "menuza_publication_revalidation_readonly",
    connectionTimeoutMillis: 5000,
    options:
      "-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=3000",
  });
  let root;
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const source = (
      await client.query(
        "SELECT current_database() AS database, inet_server_port() AS port, current_setting('transaction_read_only') AS read_only, version() AS version",
      )
    ).rows[0];
    check(
      source.port === 55433 &&
        source.database === "menuza_recovered_20261114" &&
        source.read_only === "on",
      "Identidade ou modo somente leitura divergente.",
    );
    const baseline = await state(client);
    for (const key of ["tables", "sequences", "large_objects"])
      check(
        equal(baseline[key], prior.state[key]),
        "Estado atual diverge do backup de publicação: " + key,
      );
    const snapshot = (await client.query("SELECT pg_export_snapshot() AS s"))
      .rows[0].s;
    const currentCopies = copyTables(
      await run(
        path.join(bin, "pg_dump"),
        ["--data-only", "--snapshot=" + snapshot],
        env,
      ),
    );
    const initialComparison = compareCopies(oldCopies, currentCopies, true);
    const publicationComparison = compareCopies(
      publicationCopies,
      currentCopies,
      false,
    );
    const schema = await run(
      path.join(bin, "pg_dump"),
      ["--schema-only", "--no-owner", "--no-acl", "--snapshot=" + snapshot],
      env,
    );
    check(
      schema ===
        (await fs.readFile(path.join(publication, "schema.sql"), "utf8")),
      "Esquema atual diverge do backup validado.",
    );
    const stores = (
      await client.query(
        "SELECT id,nome,slug,responsavel FROM estabelecimentos ORDER BY id",
      )
    ).rows;
    check(
      stores.length === 3 &&
        stores.some(
          (s) =>
            String(s.id) === "2" &&
            s.responsavel.toLowerCase().includes("rayssa"),
        ),
      "As três lojas ou a identidade da Rayssa divergem.",
    );
    const rayssaReferences = (
      await client.query(
        "SELECT 'logo' AS kind,id::text AS record_id,logo_url AS url FROM estabelecimentos WHERE id=2 UNION ALL SELECT 'banner',id::text,banner_url FROM estabelecimentos WHERE id=2 UNION ALL SELECT 'produto',id::text,imagem_url FROM produtos WHERE estabelecimento_id=2 ORDER BY kind,record_id",
      )
    ).rows;
    check(
      rayssaReferences.length === 4,
      "Esperados logo, banner e dois produtos da Rayssa.",
    );
    await client.query("ROLLBACK");
    const uploads = path.resolve(process.env.UPLOAD_DIR || "backend/uploads");
    const files = await inventory(uploads);
    check(
      files.length === 26 &&
        equal(files, prior.uploads.files) &&
        equal(files, initial.uploads.files),
      "Inventário atual diverge das 26 imagens validadas.",
    );
    const rayssaImages = rayssaReferences.map((r) => {
      check(
        typeof r.url === "string" && r.url.startsWith("/uploads/"),
        "Referência de imagem da Rayssa inválida.",
      );
      const file = files.find((f) => "/uploads/" + f.path === r.url);
      check(file, "Imagem referenciada pela Rayssa ausente: " + r.kind);
      return { ...r, ...file };
    });
    root = await fs.mkdtemp(
      path.resolve(".local/publication-authorized-55433-"),
    );
    const restored = path.join(root, "restored-uploads");
    await fs.mkdir(restored, { mode: 0o700 });
    const entries = (
      await run("tar", ["-tzf", path.join(publication, "uploads.tar.gz")])
    )
      .trim()
      .split("\n");
    check(
      entries.every(
        (e) => e === "./" || /^\.\/[a-f0-9-]+\.(png|jpg|webp)$/.test(e),
      ),
      "Caminho inseguro no arquivo de uploads.",
    );
    await run("tar", [
      "-xzf",
      path.join(publication, "uploads.tar.gz"),
      "-C",
      restored,
    ]);
    check(
      equal(await inventory(restored), files),
      "Imagens extraídas divergem do inventário.",
    );
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const after = await state(client);
    await client.query("ROLLBACK");
    check(equal(after, baseline), "A base mudou durante a validação.");
    check(
      equal(await inventory(uploads), files),
      "Uploads mudaram durante a validação.",
    );
    check(
      equal(await manifests(), evidence),
      "Artefatos antigos mudaram durante a validação.",
    );
    const report = {
      created_at: new Date().toISOString(),
      source,
      root,
      source_selection_status: "VERIFIED",
      source_selection: {
        selected_by: "user",
        authorized_port: 55433,
        statement:
          "O usuário escolheu explicitamente o PostgreSQL recuperado na porta 55433 como fonte oficial dos dados da publicação da Menuza, preservando integralmente a loja da Rayssa.",
        historical_origin_verified: false,
        historical_origin_note:
          "Não foi comprovada nesta validação a origem histórica dos dados. A porta 5432 não foi acessada e não é requisito da escolha autorizada.",
      },
      current_backup_restored: true,
      restoration_evidence: {
        performed_this_run: false,
        report: path.join(publication, "validation.json"),
        report_sha256: await hash(path.join(publication, "validation.json")),
        explanation:
          "Restauração concluída na validação anterior, cujo relatório e dump tiveram SHA-256 reconferidos. Nesta execução os dois dumps foram lidos offline e seus registros comparados com SELECT/pg_dump somente leitura; nenhum banco antigo foi iniciado.",
      },
      source_still_equal: true,
      all_tables_sequences_large_objects_equal: true,
      schema_equal: true,
      original_users_and_password_hashes_equal: true,
      rayssa_record_equal: true,
      stores,
      rayssa: stores.find((s) => String(s.id) === "2"),
      rayssa_images: rayssaImages,
      state: baseline,
      initial_backup_comparison: initialComparison,
      publication_backup_comparison: publicationComparison,
      uploads: {
        count: files.length,
        bytes: files.reduce((n, f) => n + f.size, 0),
        files,
      },
      evidence,
      checks: {
        readonly_transactions: true,
        old_artifacts_unchanged: true,
        initial_rows_preserved: true,
        publication_rows_identical: true,
        uploads_live_and_both_backups_equal: true,
        cloudinary_report_contract: true,
      },
      actions: {
        migrations: false,
        database_writes: false,
        old_databases_started: false,
        cloudinary_sync: false,
        render_deploy: false,
      },
    };
    await fs.writeFile(
      path.join(root, "validation.json"),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx" },
    );
    const sums = [
      (await hash(path.join(root, "validation.json"))) + "  validation.json",
      ...files.map((f) => f.sha256 + "  restored-uploads/" + f.path),
    ];
    await fs.writeFile(path.join(root, "SHA256SUMS"), sums.join("\n") + "\n", {
      flag: "wx",
    });
    console.log(
      JSON.stringify(
        {
          report: path.join(root, "validation.json"),
          status: report.source_selection_status,
          tables: baseline.tables.length,
          counts: Object.fromEntries(
            baseline.tables.map((t) => [t.table, t.count]),
          ),
          images: files.length,
          bytes: report.uploads.bytes,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    if (root)
      await fs.writeFile(
        path.join(root, "FAILED"),
        "Validação interrompida; relatório não liberado.\n",
        { flag: "wx" },
      );
    throw e;
  } finally {
    await client.end();
  }
}
main().catch((e) => {
  console.error(e.code || e.message);
  process.exitCode = 1;
});
