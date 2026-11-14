/* Toda saída variável usa textContent: os dados nunca são interpretados como HTML. */
export function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined && text !== null) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
export function button(text, action, cls = "") {
  const n = el("button", text, cls);
  n.type = "button";
  n.addEventListener("click", action);
  return n;
}
export function label(text, input) {
  const n = el("label");
  n.append(el("span", text), input);
  return n;
}
export function input(name, type = "text", value = "") {
  const n = el("input");
  n.name = name;
  n.type = type;
  n.value = value;
  n.maxLength = 1000;
  return n;
}
export function select(name, options, value) {
  const n = el("select");
  n.name = name;
  for (const [id, text] of options) {
    const o = el("option", text);
    o.value = id;
    n.append(o);
  }
  if (value !== undefined) n.value = value;
  return n;
}
export const money = (v) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(v) / 100,
  );
export async function api(path, options = {}) {
  const r = await fetch("/api/" + path, {
    credentials: "same-origin",
    ...options,
    headers:
      options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json", ...options.headers },
  });
  const data = await r.json();
  if (!r.ok) {
    const err = new Error(data.erro || "Não foi possível concluir.");
    err.status = r.status;
    throw err;
  }
  return data;
}
export function send(method, body) {
  return { method, body: JSON.stringify(body) };
}
export function image(url, alt, cls = "") {
  const n = el("img", null, cls);
  n.src = url || "/assets/placeholder.svg";
  n.alt = alt;
  n.loading = "lazy";
  n.addEventListener("error", () => {
    if (!n.src.endsWith("/placeholder.svg")) n.src = "/assets/placeholder.svg";
  });
  return n;
}
export function decimalToCents(value) {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(String(value)))
    throw new Error("Informe um valor monetário válido, por exemplo 28,90.");
  const [whole, dec = ""] = String(value).replace(",", ".").split(".");
  return Number(whole) * 100 + Number(dec.padEnd(2, "0"));
}
export const statuses = {
  pendente: "Aguardando confirmação",
  confirmado: "Pedido recebido",
  em_preparacao: "Em preparação",
  pronto: "Pedido pronto",
  saiu_para_entrega: "Saiu para entrega",
  concluido: "Concluído",
  cancelado: "Cancelado",
};
