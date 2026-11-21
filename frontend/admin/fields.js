import { api, el, image, input, label, select } from "/assets/shared.js";

export function field(
  form,
  name,
  text,
  type = "text",
  value = "",
  required = true,
) {
  const n = input(name, type, value);
  n.required = required;
  form.append(label(text, n));
  return n;
}
export function check(form, name, text, value) {
  const n = input(name, "checkbox");
  n.checked = value;
  const l = label(text, n);
  l.className = "extra-option";
  form.append(l);
  return n;
}
export function pick(form, name, text, options, value) {
  const n = select(name, options, value);
  n.required = true;
  form.append(label(text, n));
  return n;
}
export function textarea(form, name, text, value, max = 1000) {
  const n = el("textarea");
  n.name = name;
  n.value = value || "";
  n.maxLength = max;
  n.rows = 3;
  form.append(label(text, n));
  return n;
}
export function uploadField(form, name, text, value, endpoint = "admin") {
  const hidden = input(name, "hidden", value || ""),
    preview = image(value, "Prévia da imagem", "product-editor-preview"),
    file = input("arquivo", "file");
  file.accept = "image/png,image/jpeg,image/webp";
  file.required = false;
  const status = el("p", "", "muted");
  form.append(
    hidden,
    preview,
    label(text + " (PNG, JPEG ou WebP; até 2 MB)", file),
    status,
  );
  file.addEventListener("change", async () => {
    if (!file.files[0]) return;
    status.textContent = "Enviando…";
    const submit = (form.closest("form") || form).querySelector(
      "button[type=submit]",
    );
    if (submit) submit.disabled = true;
    try {
      if (file.files[0].size > 2 * 1024 * 1024)
        throw new Error("O limite é 2 MB.");
      const data = new FormData();
      data.append("imagem", file.files[0]);
      const result = await api(endpoint + "/upload", {
        method: "POST",
        body: data,
      });
      hidden.value = result.url;
      preview.src = result.url;
      status.textContent = "Imagem enviada. Salve para aplicar.";
    } catch (e) {
      status.textContent = e.message;
      file.value = "";
    } finally {
      if (submit) submit.disabled = false;
    }
  });
  return hidden;
}
