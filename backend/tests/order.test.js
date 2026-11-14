require("dotenv").config({ path: "backend/.env", quiet: true });
process.env.DATABASE_URL ||= "postgresql://unused@localhost/menuza_test";
process.env.JWT_SECRET ||= "segredo-unitario-efemero-sem-uso-em-producao";
const { calculate, message } = require("../src/services/orders");
const { parse, schemas } = require("../src/middlewares/validation");
const menu = {
  loja: { nome: "Teste", taxa_entrega: 500 },
  produtos: [
    {
      id: "1",
      nome: "Burger",
      preco: 2800,
      grupos: [
        {
          id: "1",
          nome: "Extras",
          minimo: 0,
          maximo: 1,
          adicionais: [{ id: "2", grupo_id: "1", nome: "Queijo", preco: 400 }],
        },
      ],
    },
  ],
};
const data = () =>
  parse(schemas.pedido, {
    cliente: { nome: "Ana", telefone: "(11) 99999-9999" },
    modalidade: "retirada",
    forma_pagamento: "pix",
    total: 1,
    itens: [{ produto_id: 1, quantidade: 2, preco: 1, adicionais: [2] }],
  });
test("ignora preços enviados pelo navegador e calcula centavos", () => {
  const d = data(),
    r = calculate(d, menu);
  expect(d.total).toBeUndefined();
  expect(d.itens[0].preco).toBeUndefined();
  expect(r.subtotal).toBe(6400);
  expect(r.total).toBe(6400);
});
test("soma taxa apenas para entrega", () =>
  expect(calculate({ ...data(), modalidade: "entrega" }, menu).total).toBe(
    6900,
  ));
test.each([0, -1, 1.5, 100])("rejeita quantidade %s", (n) =>
  expect(() =>
    parse(schemas.pedido, {
      ...data(),
      itens: [{ produto_id: 1, quantidade: n }],
    }),
  ).toThrow(),
);
test("rejeita telefone e entrega sem endereço", () => {
  expect(() =>
    parse(schemas.pedido, {
      ...data(),
      cliente: { nome: "Ana", telefone: "123" },
    }),
  ).toThrow();
  expect(() =>
    parse(schemas.pedido, { ...data(), modalidade: "entrega" }),
  ).toThrow();
});
test("rejeita produto estrangeiro, adicional inválido e duplicado", () => {
  expect(() =>
    calculate(
      { ...data(), itens: [{ produto_id: 9, quantidade: 1, adicionais: [] }] },
      menu,
    ),
  ).toThrow();
  expect(() =>
    calculate(
      { ...data(), itens: [{ produto_id: 1, quantidade: 1, adicionais: [9] }] },
      menu,
    ),
  ).toThrow();
  expect(() =>
    calculate(
      {
        ...data(),
        itens: [{ produto_id: 1, quantidade: 1, adicionais: [2, 2] }],
      },
      menu,
    ),
  ).toThrow();
});
test("enforce mínimo do grupo e valor de troco", () => {
  const copy = structuredClone(menu);
  copy.produtos[0].grupos[0].minimo = 1;
  expect(() =>
    calculate(
      { ...data(), itens: [{ produto_id: 1, quantidade: 1, adicionais: [] }] },
      copy,
    ),
  ).toThrow();
  expect(() => calculate({ ...data(), troco_para: 1 }, menu)).toThrow();
});
test("mensagem inclui número, adicionais, taxa e valores em reais", () => {
  const d = { ...data(), forma_pagamento: "dinheiro", troco_para: 10000 },
    m = message(menu.loja, d, { ...calculate(d, menu), numero: 125 });
  expect(m).toContain("🔔 NOVO PEDIDO #000125");
  expect(m).toContain("Retirada no estabelecimento");
  expect(m).toContain("Queijo");
  expect(m.replaceAll("\u00a0", " ")).toContain("R$ 64,00");
  expect(m.replaceAll("\u00a0", " ")).toContain(
    "Troco: R$ 36,00 (para R$ 100,00)",
  );
});

test("login preserva espaços da senha e valida limite bcrypt em bytes", () => {
  const senha = "  senha com espacos  ";
  expect(
    parse(schemas.login, { email: "teste@example.com", senha }).senha,
  ).toBe(senha);
  expect(() =>
    parse(schemas.login, { email: "teste@example.com", senha: "á".repeat(37) }),
  ).toThrow();
});

const {
  normalizePhone,
  whatsappUrl,
  statusMessage,
} = require("../src/services/whatsapp");
test.each(["(11) 99999-8888", "+55 (11) 99999-8888", "5511999998888"])(
  "normaliza telefone %s",
  (phone) => {
    expect(normalizePhone(phone)).toBe("5511999998888");
  },
);
test.each([
  "123",
  "5511000000000",
  "abc11999998888",
  "https://wa.me/11999998888",
])("rejeita telefone %s", (phone) => {
  expect(() => normalizePhone(phone)).toThrow("Telefone brasileiro inválido");
});
test("DDD 55 local e telefones fixos preservam país e DDD", () => {
  expect(normalizePhone("55999998888")).toBe("5555999998888");
  expect(normalizePhone("(11) 3333-4444")).toBe("551133334444");
});
test("link preserva quebras, acentos, emoji e caracteres reservados", () => {
  const text = "🔔 Olá, João!\nObservações: A&B #2 + limão ❤️";
  const url = new URL(whatsappUrl("11999998888", text));
  expect(url.origin).toBe("https://wa.me");
  expect(url.pathname).toBe("/5511999998888");
  expect(url.searchParams.get("text")).toBe(text);
  expect(url.hash).toBe("");
});
test.each([
  ["pronto", "entrega", "está pronto!"],
  ["pronto", "retirada", "está pronto para retirada!"],
  ["saiu_para_entrega", "entrega", "saiu para entrega!"],
  ["cancelado", "retirada", "foi cancelado."],
])("mensagem de %s para %s", (status, modalidade, text) => {
  const m = statusMessage({
    cliente_nome: "João Vieira Neto",
    numero: 2,
    status,
    modalidade,
  });
  expect(m).toContain("Olá, João");
  expect(m).toContain("#000002");
  expect(m).toContain(text);
});
test("preserva números com mais de seis dígitos e não notifica estado pendente", () => {
  expect(
    statusMessage({
      cliente_nome: "Ana",
      numero: "1000001",
      status: "pronto",
      modalidade: "retirada",
    }),
  ).toContain("#1000001");
  expect(
    statusMessage({ cliente_nome: "Ana", numero: 1, status: "pendente" }),
  ).toBeNull();
});
