const { z } = require("zod");
const id = z
  .union([z.number(), z.string().regex(/^[1-9][0-9]*$/)])
  .pipe(z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER));
const slug = z
  .string()
  .min(1)
  .max(80)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Endereço deve conter letras minúsculas, números e hífens entre palavras",
  );
const text = (max = 120) => z.string().trim().min(1).max(max);
const optional = (max = 1000) => z.string().trim().max(max).default("");
const money = z.number().int().min(0).max(10000000);
const categoryIds = z.array(id).transform((ids) => [...new Set(ids)]);
const couponCode = z
  .string({ error: "Informe o código do cupom" })
  .trim()
  .regex(
    /^[A-Za-z0-9_-]{1,40}$/,
    "Use de 1 a 40 letras, números, hífens ou sublinhados",
  )
  .toUpperCase();
const couponDate = z.iso
  .datetime({ offset: true, error: "Informe uma data e hora com fuso horário" })
  .refine((value) => {
    const year = new Date(value).getUTCFullYear();
    return year >= 1 && year <= 9999;
  }, "Informe uma data e hora válidas")
  .transform((value) => new Date(value).toISOString());
const activeCoupon = z.object({
  ativo: z.boolean({ error: "Informe se o cupom está ativo" }),
});
const couponAmount = z
  .int({ error: "Informe um valor com até duas casas decimais" })
  .max(10000000, "Valor acima do máximo permitido");
const coupon = activeCoupon
  .extend({
    codigo: couponCode,
    tipo: z.enum(["percentual", "fixo"], {
      error: "Selecione porcentagem ou valor fixo",
    }),
    valor: couponAmount.min(1, "O desconto deve ser maior que zero"),
    pedido_minimo: couponAmount.min(
      0,
      "O pedido mínimo deve ser zero ou maior",
    ),
    inicio_em: couponDate,
    fim_em: couponDate,
    limite_usos: z
      .int({ error: "Informe um número inteiro ou deixe o limite em branco" })
      .min(1, "O limite deve ser de pelo menos uma utilização")
      .max(2147483647, "Limite acima do máximo permitido")
      .nullable(),
  })
  .refine((value) => value.tipo !== "percentual" || value.valor <= 10000, {
    path: ["valor"],
    message: "Informe um percentual maior que zero e de até 100%",
  })
  .refine((value) => Date.parse(value.inicio_em) < Date.parse(value.fim_em), {
    path: ["fim_em"],
    message: "O encerramento deve ser posterior ao início",
  });
const modality = z.enum(["entrega", "retirada"]);
const orderItems = z
  .array(
    z.object({
      produto_id: id,
      categoria_id: id.optional(),
      quantidade: z.number().int().min(1).max(99),
      adicionais: z.array(id).max(40).default([]),
      observacao: optional(500),
    }),
  )
  .min(1)
  .max(50);
const { normalizePhone } = require("../services/whatsapp");
const phone = z.string().transform((value, ctx) => {
  try {
    return normalizePhone(value);
  } catch {
    ctx.addIssue({ code: "custom", message: "Telefone brasileiro inválido" });
    return z.NEVER;
  }
});
const image = z
  .string()
  .max(500)
  .refine(
    (v) => v === "" || /^\/uploads\/[a-f0-9-]+\.(png|jpg|webp)$/.test(v),
    "Use uma imagem enviada pela plataforma",
  )
  .default("");
const schemas = {
  coupon,
  activeCoupon,
  couponQuote: z.object({
    cupom_codigo: couponCode,
    modalidade: modality,
    itens: orderItems,
  }),
  login: z.object({
    email: z
      .string()
      .trim()
      .max(254)
      .pipe(z.email())
      .transform((s) => s.toLowerCase()),
    senha: z
      .string()
      .min(1)
      .max(72)
      .refine(
        (v) => Buffer.byteLength(v, "utf8") <= 72,
        "Senha deve ter até 72 bytes",
      ),
  }),
  categoria: z.object({
    nome: text(),
    ordem: z.number().int().min(0).max(9999).default(0),
    ativo: z.boolean().default(true),
    vinculos: z
      .object({
        produtos: categoryIds.optional(),
        grupos: categoryIds.optional(),
        adicionais: categoryIds.optional(),
      })
      .optional(),
  }),
  produto: z
    .object({
      categoria_id: id.optional(),
      categoria_ids: categoryIds.optional(),
      nome: text(),
      descricao: optional(),
      preco: money,
      ativo: z.boolean().default(true),
      imagem_url: image,
    })
    .refine(
      (v) => v.categoria_ids !== undefined || v.categoria_id !== undefined,
      "Informe as categorias do produto",
    ),
  grupo: z
    .object({
      nome: text(),
      produto_id: id.nullable().default(null),
      categoria_id: id.nullable().default(null),
      categoria_ids: categoryIds.optional(),
      minimo: z.number().int().min(0).max(20).default(0),
      maximo: z.number().int().min(0).max(20).default(5),
      ativo: z.boolean().default(true),
    })
    .refine(
      (v) =>
        v.maximo >= v.minimo &&
        (v.categoria_ids !== undefined || !!v.produto_id !== !!v.categoria_id),
      "Informe os vínculos e limites válidos do grupo",
    ),
  adicional: z.object({
    grupo_id: id,
    categoria_ids: categoryIds.nullable().optional(),
    herdar_categorias: z.boolean().optional(),
    nome: text(),
    preco: money,
    ativo: z.boolean().default(true),
  }),
  loja: z
    .object({
      nome: text(),
      descricao: optional(),
      logo_url: image,
      banner_url: image,
      whatsapp: phone,
      taxa_entrega: money,
      aberto: z.boolean(),
      entrega_ativa: z.boolean().optional(),
      retirada_ativa: z.boolean().optional(),
      horarios: optional(),
      cor_principal: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    })
    .refine(
      (v) => v.entrega_ativa !== false || v.retirada_ativa !== false,
      "Mantenha ao menos uma modalidade de recebimento ativa.",
    ),
  pedido: z
    .object({
      idempotencia: z.uuid().optional(),
      cliente: z.object({ nome: text(), telefone: phone }),
      modalidade: modality,
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
      itens: orderItems,
      cupom_codigo: couponCode.optional(),
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
    status_anterior: z.string().max(30).optional(),
    status: z.enum([
      "confirmado",
      "em_preparacao",
      "pronto",
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
          "pronto",
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
    const e = new Error(
      r.error.issues
        .map((i) => `${i.path.join(".") || "Dados"}: ${i.message}`)
        .join("; "),
    );
    e.status = 400;
    throw e;
  }
  return r.data;
};
module.exports = { schemas, parse, id, slug, phone };
