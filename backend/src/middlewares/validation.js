const { z } = require("zod");
const id = z
  .union([z.number(), z.string().regex(/^[1-9][0-9]*$/)])
  .pipe(z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER));
const slug = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const text = (max = 120) => z.string().trim().min(1).max(max);
const optional = (max = 1000) => z.string().trim().max(max).default("");
const money = z.number().int().min(0).max(10000000);
const phone = z
  .string()
  .transform((v) => v.replace(/[\s()+.-]/g, ""))
  .refine(
    (v) => /^(55)?[1-9][0-9](?:9[0-9]{8}|[2-5][0-9]{7})$/.test(v),
    "Telefone brasileiro inválido",
  )
  .transform((v) => (v.startsWith("55") && v.length >= 12 ? v : "55" + v));
const image = z
  .string()
  .max(500)
  .refine(
    (v) => v === "" || /^\/uploads\/[a-f0-9-]+\.(png|jpg|webp)$/.test(v),
    "Use uma imagem enviada pela plataforma",
  )
  .default("");
const schemas = {
  login: z.object({
    email: z
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    senha: text(72).refine(
      (v) => Buffer.byteLength(v, "utf8") <= 72,
      "Senha deve ter até 72 bytes",
    ),
  }),
  categoria: z.object({
    nome: text(),
    ordem: z.number().int().min(0).max(9999).default(0),
    ativo: z.boolean().default(true),
  }),
  produto: z.object({
    categoria_id: id,
    nome: text(),
    descricao: optional(),
    preco: money,
    ativo: z.boolean().default(true),
    imagem_url: image,
  }),
  grupo: z
    .object({
      nome: text(),
      produto_id: id.nullable().default(null),
      categoria_id: id.nullable().default(null),
      minimo: z.number().int().min(0).max(20).default(0),
      maximo: z.number().int().min(0).max(20).default(5),
      ativo: z.boolean().default(true),
    })
    .refine(
      (v) => !!v.produto_id !== !!v.categoria_id && v.maximo >= v.minimo,
      "Selecione produto OU categoria e limites válidos",
    ),
  adicional: z.object({
    grupo_id: id,
    nome: text(),
    preco: money,
    ativo: z.boolean().default(true),
  }),
  loja: z.object({
    nome: text(),
    descricao: optional(),
    logo_url: image,
    whatsapp: phone,
    taxa_entrega: money,
    aberto: z.boolean(),
    horarios: optional(),
    cor_principal: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
  pedido: z
    .object({
      cliente: z.object({ nome: text(), telefone: phone }),
      modalidade: z.enum(["entrega", "retirada"]),
      forma_pagamento: z.enum(["dinheiro", "pix", "cartao"]),
      troco_para: money.nullable().default(null),
      observacoes: optional(),
      endereco: z
        .object({
          rua: optional(150),
          numero: optional(20),
          bairro: optional(100),
          complemento: optional(150),
          referencia: optional(150),
        })
        .default({
          rua: "",
          numero: "",
          bairro: "",
          complemento: "",
          referencia: "",
        }),
      itens: z
        .array(
          z.object({
            produto_id: id,
            quantidade: z.number().int().min(1).max(99),
            adicionais: z.array(id).max(40).default([]),
            observacao: optional(500),
          }),
        )
        .min(1)
        .max(50),
    })
    .superRefine((v, c) => {
      if (
        v.modalidade === "entrega" &&
        (!v.endereco.rua || !v.endereco.numero || !v.endereco.bairro)
      )
        c.addIssue({
          code: "custom",
          message: "Informe rua, número e bairro para entrega",
        });
      if (v.forma_pagamento !== "dinheiro" && v.troco_para !== null)
        c.addIssue({
          code: "custom",
          message: "Troco é permitido apenas em dinheiro",
        });
    }),
  status: z.object({
    status: z.enum([
      "confirmado",
      "em_preparacao",
      "saiu_para_entrega",
      "concluido",
      "cancelado",
    ]),
  }),
  filtros: z
    .object({
      inicio: z.iso.date().optional(),
      fim: z.iso.date().optional(),
      status: z
        .enum([
          "pendente",
          "confirmado",
          "em_preparacao",
          "saiu_para_entrega",
          "concluido",
          "cancelado",
        ])
        .optional(),
    })
    .refine(
      (v) => !v.inicio || !v.fim || v.inicio <= v.fim,
      "Período inválido",
    ),
};
const parse = (schema, value) => {
  const r = schema.safeParse(value);
  if (!r.success) {
    const e = new Error(r.error.issues.map((i) => i.message).join("; "));
    e.status = 400;
    throw e;
  }
  return r.data;
};
module.exports = { schemas, parse, id, slug };
