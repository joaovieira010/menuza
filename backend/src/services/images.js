const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const env = require("../config/env");
const filename = /^[a-f0-9-]+\.(?:png|jpg|webp)$/;
const maxBytes = 8 * 1024 * 1024;
function checkName(name) {
  if (!filename.test(name)) {
    const e = new Error("Imagem não encontrada.");
    e.status = 404;
    throw e;
  }
}
function failure(status = 502) {
  const e = new Error(
    status === 404
      ? "Imagem não encontrada."
      : "Armazenamento de imagens indisponível.",
  );
  e.status = status;
  return e;
}
function remoteUrl(name) {
  checkName(name);
  return `https://res.cloudinary.com/${env.cloudinary.cloudName}/raw/upload/${env.cloudinary.prefix}/${name}`;
}
async function readRemote(name) {
  let response;
  try {
    response = await fetch(remoteUrl(name), {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw failure();
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw failure(response.status === 404 ? 404 : 502);
  }
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw failure();
  }
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) throw failure();
      chunks.push(chunk);
    }
  } catch {
    throw failure();
  }
  return Buffer.concat(chunks);
}
async function putRemote(name, buffer) {
  checkName(name);
  if (buffer.length > maxBytes) throw failure(413);
  const params = {
    overwrite: "false",
    public_id: `${env.cloudinary.prefix}/${name}`,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  const signed = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  const signature = crypto
    .createHash("sha256")
    .update(signed + env.cloudinary.apiSecret)
    .digest("hex");
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) form.set(key, value);
  form.set("api_key", env.cloudinary.apiKey);
  form.set("signature", signature);
  form.set("file", new Blob([buffer]), name);
  let response;
  try {
    response = await fetch(
      `https://api.cloudinary.com/v1_1/${env.cloudinary.cloudName}/raw/upload`,
      {
        method: "POST",
        body: form,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      },
    );
  } catch {
    throw failure();
  }
  // Não registrar o payload de erros do provedor ou URLs assinadas.
  await response.body?.cancel();
  if (!response.ok) throw failure();
  // Confirma persistência byte a byte e detecta colisões sem sobrescrever.
  const stored = await readRemote(name);
  if (!stored.equals(buffer)) throw failure();
}
async function listRemote() {
  const names = [];
  const cursors = new Set();
  let cursor;
  do {
    const url = new URL(
      `https://api.cloudinary.com/v1_1/${env.cloudinary.cloudName}/resources/raw/upload`,
    );
    url.searchParams.set("prefix", env.cloudinary.prefix + "/");
    url.searchParams.set("max_results", "500");
    if (cursor) url.searchParams.set("next_cursor", cursor);
    let response, data;
    try {
      response = await fetch(url, {
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              env.cloudinary.apiKey + ":" + env.cloudinary.apiSecret,
            ).toString("base64"),
        },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw failure();
      data = await response.json();
    } catch {
      throw failure();
    }
    if (!Array.isArray(data.resources)) throw failure();
    for (const item of data.resources) {
      if (
        typeof item.public_id !== "string" ||
        !item.public_id.startsWith(env.cloudinary.prefix + "/")
      )
        throw failure();
      const name = item.public_id.slice(env.cloudinary.prefix.length + 1);
      checkName(name);
      names.push(name);
    }
    cursor = data.next_cursor;
    if (cursor && cursors.has(cursor)) throw failure();
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return [...new Set(names)].sort();
}
async function save(name, buffer) {
  checkName(name);
  if (env.imageStorage === "cloudinary") await putRemote(name, buffer);
  else {
    await fs.mkdir(env.uploadDir, { recursive: true });
    await fs.writeFile(path.join(env.uploadDir, name), buffer, { flag: "wx" });
  }
  return "/uploads/" + name;
}
async function serve(req, res) {
  const name = req.params.name;
  checkName(name);
  const data = await readRemote(name);
  const type = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" }[
    name.split(".").pop()
  ];
  const etag =
    '"' + crypto.createHash("sha256").update(data).digest("hex") + '"';
  res.set({
    "Content-Type": type,
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "public, max-age=86400, immutable",
    ETag: etag,
  });
  if (req.fresh) return res.status(304).end();
  res.send(data);
}
module.exports = { save, serve, readRemote, putRemote, listRemote };
