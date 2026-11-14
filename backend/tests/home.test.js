// Executa o JavaScript real da home com DOM e rede isolados, sem servidor ou banco.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs
  .readFileSync(path.join(__dirname, "../../frontend/home.js"), "utf8")
  .replace(/^import[^\n]+\n/, "");
const whatsapp = "https://wa.me/5548988780394?text=interesse";
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function setup({ plans = deferred().promise, contact, open } = {}) {
  const button = { disabled: false };
  const output = {
    textContent: "",
    replaceChildren(...children) {
      this.children = children;
      this.textContent = children.map((c) => c.textContent).join("");
    },
  };
  const form = {
    elements: { consentimento: { checked: true } },
    querySelector: () => button,
  };
  const root = { replaceChildren() {}, append() {} };
  const popup = { location: {}, close: jest.fn() };
  const api = jest.fn((endpoint) =>
    endpoint === "public/planos"
      ? plans
      : contact
        ? contact()
        : Promise.resolve({ whatsapp_url: whatsapp }),
  );
  const finished = vm.runInNewContext(`(async () => {${source}})()`, {
    document: {
      querySelector: (s) =>
        ({
          "#contact": form,
          "#contact-result": output,
          "#plans": root,
          "#open-menu": { addEventListener() {} },
        })[s],
    },
    window: { open: open || (() => popup) },
    FormData: class {
      constructor() {
        return [
          ["nome", "Ana"],
          ["estabelecimento", "Loja"],
          ["email", "ana@example.com"],
          ["telefone", "48988780394"],
        ];
      }
    },
    api,
    send: (method, body) => ({ method, body }),
    el: (tag, textContent) => ({ tag, textContent }),
    money: () => "",
  });
  return {
    api,
    button,
    output,
    popup,
    root,
    form,
    finished,
    submit: () => form.onsubmit({ target: form, preventDefault() {} }),
  };
}
test("formulário envia enquanto os planos permanecem pendentes", async () => {
  const s = setup();
  expect(typeof s.form.onsubmit).toBe("function");
  await s.submit();
  expect(s.api).toHaveBeenCalledWith("public/contato", {
    method: "POST",
    body: expect.objectContaining({ nome: "Ana", consentimento: true }),
  });
  expect(s.popup.location.href).toBe(whatsapp);
  expect(s.output.textContent).toContain("Interesse registrado");
});
test("falha de planos não impede envio comercial", async () => {
  const plans = deferred();
  const s = setup({ plans: plans.promise });
  plans.reject(new Error("Indisponível"));
  await s.finished;
  await s.submit();
  expect(s.root.textContent).toContain("Consulte os planos");
  expect(s.output.textContent).toContain("Interesse registrado");
});
test("envios simultâneos geram uma única requisição de contato", async () => {
  const request = deferred();
  const s = setup({ contact: () => request.promise });
  const first = s.submit();
  expect(s.button.disabled).toBe(true);
  expect(s.output.textContent).toContain("Enviando");
  await s.submit();
  expect(s.api.mock.calls.filter(([p]) => p === "public/contato")).toHaveLength(
    1,
  );
  request.resolve({ whatsapp_url: whatsapp });
  await first;
  expect(s.button.disabled).toBe(false);
});
test("erro HTTP informa o motivo e permite tentar novamente", async () => {
  const contact = jest
    .fn()
    .mockRejectedValueOnce(
      Object.assign(new Error("Telefone inválido"), { status: 400 }),
    )
    .mockResolvedValue({ whatsapp_url: whatsapp });
  const s = setup({ contact });
  await s.submit();
  expect(s.output.textContent).toContain("Telefone inválido");
  expect(s.popup.close).toHaveBeenCalled();
  expect(s.button.disabled).toBe(false);
  await s.submit();
  expect(contact).toHaveBeenCalledTimes(2);
  expect(s.output.textContent).toContain("Interesse registrado");
});
test("erro de rede informa como tentar novamente", async () => {
  const s = setup({
    contact: () => Promise.reject(new TypeError("Failed to fetch")),
  });
  await s.submit();
  expect(s.output.textContent).toContain(
    "Verifique sua conexão e tente novamente",
  );
  expect(s.button.disabled).toBe(false);
});
test.each([
  () => null,
  () => {
    throw new Error("Popup bloqueado");
  },
])("popup bloqueado preserva confirmação e link manual", async (open) => {
  const s = setup({ open });
  await s.submit();
  expect(s.output.textContent).toContain("Interesse registrado");
  expect(s.output.children[1]).toMatchObject({
    href: whatsapp,
    rel: "noopener noreferrer",
  });
});
test("erro ao navegar popup não transforma contato salvo em erro", async () => {
  const s = setup({
    open: () => ({
      get location() {
        throw new Error("Bloqueado");
      },
    }),
  });
  await s.submit();
  expect(s.output.textContent).toContain("Interesse registrado");
  expect(s.output.children[1].href).toBe(whatsapp);
});
