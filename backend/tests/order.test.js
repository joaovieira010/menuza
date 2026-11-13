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
  expect(m).toContain("PEDIDO Nº 000125");
  expect(m).toContain("Retirada no estabelecimento");
  expect(m).toContain("Queijo");
  expect(m.replaceAll("\u00a0", " ")).toContain("R$ 64,00");
  expect(m.replaceAll("\u00a0", " ")).toContain("TROCO: R$ 36,00 (para R$ 100,00)");
});
