const router = require("express").Router();
const { z } = require("zod");
const bcrypt = require("bcrypt");
const crypto = require("node:crypto");
const { rateLimit } = require("express-rate-limit");
const pool = require("../database/pool");
const sessions = require("../services/sessions");
const { parse, id, slug, phone } = require("../middlewares/validation");
const {
  audit,
  subscription,
  reconcile,
  fail,
  todaySQL,
  effectiveSQL,
} = require("../services/billing");
const reserved = new Set([
  "api",
  "admin",
  "superadmin",
  "assets",
  "uploads",
  "health",
  "favicon",
  "robots",
  "contratar",
]);
const friendlySlug = slug.refine(
  (s) => !reserved.has(s),
  "Endereço reservado pela plataforma",
);
const text = z.string().trim().min(1).max(120);
const email = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email())
  .transform((v) => v.toLowerCase());
const cents = z.number().int().min(0).max(10000000);
const password = z
  .string()
  .min(12)
  .max(72)
  .refine((v) => Buffer.byteLength(v) <= 72, "Senha deve ter até 72 bytes");
const storeSchema = z.object({
  nome: text,
  responsavel: text,
  email,
  telefone: phone,
  slug: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() || undefined : v),
    friendlySlug.optional(),
  ),
  plano_id: id,
  valor: cents,
  vencimento: z.iso.date(),
  admin_email: email,
  senha: password,
  status: z.enum(["trialing", "active"]).default("active"),
});
const editSchema = storeSchema
  .omit({ senha: true, status: true })
  .extend({ senha: password.optional() });
// Normalização exclusiva do cadastro; a edição mantém a validação anterior.
const normalizeStoreSlug = (value) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const createStoreSchema = storeSchema.extend({
  slug: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const address = value.trim();
    if (!address) return undefined;
    return normalizeStoreSlug(address);
  }, friendlySlug.optional()),
});
const planSchema = z.object({
  nome: text,
  preco: cents,
  limite_produtos: z
    .number()
    .int()
    .positive()
    .max(1000000)
    .nullable()
    .default(null),
  limite_pedidos_mes: z
    .number()
    .int()
    .positive()
    .max(10000000)
    .nullable()
    .default(null),
  adicionais: z.boolean(),
  personalizacao: z.boolean(),
  ativo: z.boolean().default(true),
});
async function transaction(work) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await work(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
async function lockedStore(c, tid) {
  const {
    rows: [l],
  } = await c.query("SELECT * FROM estabelecimentos WHERE id=$1 FOR UPDATE", [
    tid,
  ]);
  if (!l) fail("Estabelecimento não encontrado.", 404);
  return l;
}
router.post(
  "/login",
  rateLimit({
    windowMs: 900000,
    limit: 10,
    message: { erro: "Muitas tentativas. Aguarde 15 minutos." },
  }),
  sessions.login("SUPERADMIN"),
);
router.use(sessions.auth("SUPERADMIN"));
router.post("/logout", sessions.logout("SUPERADMIN"));
router.get("/me", (req, res) => res.json(req.user));
router.use(
  "/lojas/:lojaId/cardapio",
  async (req, res, next) => {
    req.catalogStoreId = parse(id, req.params.lojaId);
    req.subscription = await subscription(pool, req.catalogStoreId);
    if (!req.subscription) fail("Estabelecimento não encontrado.", 404);
    next();
  },
  require("./catalog-admin"),
);
router.get("/dashboard", async (req, res) => {
  const {
    rows: [stats],
  } = await pool.query(`SELECT count(*)::int AS total,
 count(*) FILTER(WHERE l.situacao='active' AND (${effectiveSQL}) NOT IN ('suspended','canceled'))::int AS ativos,
 count(*) FILTER(WHERE l.situacao='suspended' OR (${effectiveSQL})='suspended')::int AS suspensos,
 count(*) FILTER(WHERE a.vencimento<=${todaySQL} AND a.status<>'canceled' AND l.situacao<>'archived')::int AS em_atraso,
 COALESCE(sum(a.valor) FILTER(WHERE l.situacao<>'archived' AND a.status<>'canceled'),0)::bigint AS mrr_contratada,
 count(*) FILTER(WHERE l.criado_em>=date_trunc('month',now()))::int AS novos_clientes
 FROM estabelecimentos l JOIN assinaturas a ON a.estabelecimento_id=l.id CROSS JOIN politica_cobranca p WHERE NOT l.demonstracao`);
  const {
    rows: [received],
  } = await pool.query(
    `SELECT COALESCE(sum(valor),0)::bigint AS pagamentos_recebidos_mes FROM pagamentos pg JOIN estabelecimentos l ON l.id=pg.estabelecimento_id WHERE NOT l.demonstracao AND date_trunc('month',pago_em::timestamp)=date_trunc('month',${todaySQL}::timestamp)`,
  );
  const { rows: proximos } = await pool.query(
    `SELECT l.id,l.nome,a.vencimento,a.valor FROM assinaturas a JOIN estabelecimentos l ON l.id=a.estabelecimento_id WHERE NOT l.demonstracao AND l.situacao<>'archived' AND a.status<>'canceled' AND a.vencimento>=${todaySQL} ORDER BY a.vencimento LIMIT 10`,
  );
  res.json({ ...stats, ...received, proximos });
});
router.get("/lojas", async (req, res) => {
  const f = parse(
    z.object({
      busca: z.string().max(120).default(""),
      situacao: z.enum(["active", "suspended", "archived", ""]).default(""),
    }),
    req.query,
  );
  const { rows } = await pool.query(
    `SELECT l.id,l.nome,l.slug,l.responsavel,l.email,l.telefone,l.situacao,l.criado_em,a.plano_id,a.valor,a.vencimento,a.ultimo_pagamento,pl.nome AS plano,${effectiveSQL} AS status,
 (SELECT email FROM usuarios u WHERE u.estabelecimento_id=l.id AND u.papel='STORE_ADMIN' ORDER BY id LIMIT 1) AS admin_email
 FROM estabelecimentos l JOIN assinaturas a ON a.estabelecimento_id=l.id JOIN planos pl ON pl.id=a.plano_id CROSS JOIN politica_cobranca p
 WHERE ($1::text='' OR l.nome ILIKE '%'||$1||'%') AND ($2::text='' OR l.situacao=$2 OR ($2='suspended' AND (${effectiveSQL})='suspended')) ORDER BY l.id DESC LIMIT 500`,
    [f.busca, f.situacao],
  );
  res.json(rows);
});
router.post("/lojas", async (req, res) => {
  const d = parse(createStoreSchema, req.body);
  const result = await transaction(async (c) => {
    if (
      !(
        await c.query("SELECT id FROM planos WHERE id=$1 AND ativo=true", [
          d.plano_id,
        ])
      ).rowCount
    )
      fail("Plano indisponível.");
    let base =
      normalizeStoreSlug(d.nome).slice(0, 60).replace(/-$/, "") || "loja";
    if (reserved.has(base)) base += "-loja";
    let address = d.slug || base;
    let l;
    for (let attempt = 0; attempt < 10; attempt++) {
      // A restrição única resolve também cadastros automáticos concorrentes.
      const { rows } = await c.query(
        "INSERT INTO estabelecimentos(nome,slug,responsavel,email,telefone,whatsapp,aberto,cor_principal) VALUES($1,$2,$3,$4,$5,$5,false,'#7f3aed')" +
          (d.slug ? "" : " ON CONFLICT (slug) DO NOTHING") +
          " RETURNING id,slug",
        [d.nome, address, d.responsavel, d.email, d.telefone],
      );
      l = rows[0];
      if (l) break;
      address = base + "-" + crypto.randomBytes(4).toString("hex");
    }
    if (!l)
      fail(
        "slug: Não foi possível gerar um endereço disponível. Tente novamente.",
        409,
      );
    await c.query(
      "INSERT INTO usuarios(estabelecimento_id,email,senha_hash,papel) VALUES($1,$2,$3,'STORE_ADMIN')",
      [l.id, d.admin_email, await bcrypt.hash(d.senha, 12)],
    );
    await c.query(
      "INSERT INTO assinaturas(estabelecimento_id,plano_id,valor,vencimento,status) VALUES($1,$2,$3,$4,$5)",
      [l.id, d.plano_id, d.valor, d.vencimento, d.status],
    );
    await audit(c, l.id, req.user.id, "loja.criada", {
      slug: address,
      plano_id: d.plano_id,
      valor: d.valor,
      vencimento: d.vencimento,
    });
    return l;
  }).catch((e) => {
    if (e.code === "23505") {
      if (e.constraint === "estabelecimentos_slug_key")
        fail("slug: Endereço do cardápio já cadastrado. Escolha outro.", 409);
      if (e.constraint === "usuarios_email_key")
        fail("admin_email: E-mail de acesso já cadastrado. Use outro.", 409);
    }
    throw e;
  });
  res.status(201).json(result);
});
router.put("/lojas/:id", async (req, res) => {
  const tid = parse(id, req.params.id),
    d = parse(editSchema, req.body);
  await transaction(async (c) => {
    const l = await lockedStore(c, tid);
    if (l.situacao === "archived")
      fail("Loja arquivada. Reative antes de editar.");
    if (
      ["hamburgueria-demo", "doces-demo", "frutellagourmet-d9b505e6"].includes(
        l.slug,
      ) &&
      d.slug &&
      d.slug !== l.slug
    )
      fail("Este endereço público deve ser preservado.");
    if (
      !(
        await c.query(
          "SELECT p.id FROM planos p WHERE p.id=$1 AND (p.ativo OR EXISTS(SELECT 1 FROM assinaturas a WHERE a.estabelecimento_id=$2 AND a.plano_id=p.id))",
          [d.plano_id, tid],
        )
      ).rowCount
    )
      fail("Plano indisponível.");
    await c.query(
      "UPDATE estabelecimentos SET nome=$2,slug=$3,responsavel=$4,email=$5,telefone=$6 WHERE id=$1",
      [tid, d.nome, d.slug || l.slug, d.responsavel, d.email, d.telefone],
    );
    await c.query(
      "UPDATE assinaturas SET plano_id=$2,valor=$3,vencimento=$4 WHERE estabelecimento_id=$1",
      [tid, d.plano_id, d.valor, d.vencimento],
    );
    const {
      rows: [u],
    } = await c.query(
      "SELECT id,email FROM usuarios WHERE estabelecimento_id=$1 AND papel='STORE_ADMIN' ORDER BY id LIMIT 1",
      [tid],
    );
    if (!u) fail("Administrador da loja não encontrado.", 409);
    await c.query("UPDATE usuarios SET email=$2 WHERE id=$1", [
      u.id,
      d.admin_email,
    ]);
    if (d.senha)
      await c.query("UPDATE usuarios SET senha_hash=$2 WHERE id=$1", [
        u.id,
        await bcrypt.hash(d.senha, 12),
      ]);
    if (d.senha || d.admin_email !== u.email)
      await c.query("DELETE FROM sessoes WHERE usuario_id=$1", [u.id]);
    await audit(c, tid, req.user.id, "loja.editada", {
      slug: d.slug || l.slug,
      plano_id: d.plano_id,
      valor: d.valor,
      vencimento: d.vencimento,
      senha_alterada: !!d.senha,
    });
  });
  res.json({ ok: true });
});
router.post("/lojas/:id/situacao", async (req, res) => {
  const tid = parse(id, req.params.id),
    d = parse(
      z.object({
        acao: z.enum(["suspender", "reativar", "arquivar", "cancelar"]),
        observacao: z.string().trim().min(3).max(1000),
      }),
      req.body,
    );
  await transaction(async (c) => {
    await lockedStore(c, tid);
    // Reativação administrativa exige vencimento regular; não contorna política automática.
    if (d.acao === "reativar") {
      const {
        rows: [s],
      } = await c.query(
        `SELECT vencimento>${todaySQL} AS regular FROM assinaturas WHERE estabelecimento_id=$1`,
        [tid],
      );
      if (!s?.regular)
        fail("Registre a quitação ou ajuste o vencimento antes de reativar.");
      await c.query(
        "UPDATE estabelecimentos SET situacao='active' WHERE id=$1",
        [tid],
      );
      await c.query(
        "UPDATE assinaturas SET suspensao_manual=false,status='active' WHERE estabelecimento_id=$1",
        [tid],
      );
    } else {
      const archived = d.acao === "arquivar";
      await c.query("UPDATE estabelecimentos SET situacao=$2 WHERE id=$1", [
        tid,
        archived ? "archived" : "suspended",
      ]);
      await c.query(
        "UPDATE assinaturas SET suspensao_manual=true,status=$2 WHERE estabelecimento_id=$1",
        [tid, archived || d.acao === "cancelar" ? "canceled" : "suspended"],
      );
      await c.query(
        "DELETE FROM sessoes WHERE usuario_id IN (SELECT id FROM usuarios WHERE estabelecimento_id=$1)",
        [tid],
      );
    }
    await audit(c, tid, req.user.id, "loja." + d.acao, {
      observacao: d.observacao,
    });
  });
  res.json({ ok: true });
});
router.get("/lojas/:id/historico", async (req, res) => {
  const tid = parse(id, req.params.id),
    s = await subscription(pool, tid);
  if (!s) fail("Loja não encontrada.", 404);
  const { rows: pagamentos } = await pool.query(
    "SELECT * FROM pagamentos WHERE estabelecimento_id=$1 ORDER BY id DESC LIMIT 200",
    [tid],
  );
  const { rows: historico } = await pool.query(
    "SELECT id,acao,detalhes,criado_em FROM auditoria_plataforma WHERE estabelecimento_id=$1 ORDER BY id DESC LIMIT 200",
    [tid],
  );
  res.json({ assinatura: s, pagamentos, historico });
});
router.post("/lojas/:id/pagamentos", async (req, res) => {
  const tid = parse(id, req.params.id),
    d = parse(
      z.object({
        valor: cents.refine((n) => n > 0),
        pago_em: z.iso.date(),
        referencia: text,
        observacao: z.string().trim().max(1000).default(""),
        proximo_vencimento: z.iso.date(),
        confirmado: z.literal(true),
      }),
      req.body,
    );
  const result = await transaction(async (c) => {
    const l = await lockedStore(c, tid);
    if (l.situacao === "archived")
      fail("Reative o cliente arquivado antes de registrar novo pagamento.");
    if (
      (
        await c.query(
          "SELECT id FROM pagamentos WHERE estabelecimento_id=$1 AND referencia=$2",
          [tid, d.referencia],
        )
      ).rowCount
    )
      fail("Referência de pagamento já registrada.", 409);
    const {
      rows: [a],
    } = await c.query(
      `SELECT *,to_char(vencimento,'YYYY-MM-DD') AS due,to_char(${todaySQL},'YYYY-MM-DD') AS hoje FROM assinaturas WHERE estabelecimento_id=$1 FOR UPDATE`,
      [tid],
    );
    if (
      d.pago_em > a.hoje ||
      d.proximo_vencimento <= a.hoje ||
      d.proximo_vencimento <= a.due
    )
      fail(
        "Confira a data de pagamento e informe o próximo vencimento após o atual e após hoje.",
      );
    if (d.valor < a.valor)
      fail(
        "O pagamento deve quitar o valor contratado. Ajuste a negociação na assinatura antes de registrar.",
      );
    const {
      rows: [p],
    } = await c.query(
      "INSERT INTO pagamentos(estabelecimento_id,valor,pago_em,referencia,observacao,registrado_por,proximo_vencimento) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [
        tid,
        d.valor,
        d.pago_em,
        d.referencia,
        d.observacao,
        req.user.id,
        d.proximo_vencimento,
      ],
    );
    const {
      rows: [policy],
    } = await c.query("SELECT * FROM politica_cobranca WHERE id=1");
    // Suspensão manual e cancelamento continuam exigindo decisão explícita do proprietário.
    const automatic =
      policy.reativar_automaticamente &&
      !a.suspensao_manual &&
      a.status !== "canceled";
    await c.query(
      "UPDATE assinaturas SET vencimento=$2,ultimo_pagamento=$3,status=$4,suspensao_manual=$5 WHERE estabelecimento_id=$1",
      [
        tid,
        d.proximo_vencimento,
        d.pago_em,
        a.status === "canceled"
          ? "canceled"
          : automatic
            ? "active"
            : "suspended",
        !automatic,
      ],
    );
    await audit(c, tid, req.user.id, "pagamento.confirmado", {
      pagamento_id: p.id,
      valor: d.valor,
      referencia: d.referencia,
      proximo_vencimento: d.proximo_vencimento,
    });
    return p;
  });
  res.status(201).json(result);
});
router.get("/planos", async (req, res) =>
  res.json((await pool.query("SELECT * FROM planos ORDER BY preco")).rows),
);
router.post("/planos", async (req, res) => {
  const d = parse(planSchema, req.body);
  const {
    rows: [p],
  } = await pool.query(
    "INSERT INTO planos(nome,preco,limite_produtos,limite_pedidos_mes,adicionais,personalizacao,ativo) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
    Object.values(d),
  );
  await audit(pool, null, req.user.id, "plano.criado", { id: p.id });
  res.status(201).json(p);
});
router.put("/planos/:id", async (req, res) => {
  const d = parse(planSchema, req.body);
  const {
    rows: [p],
  } = await pool.query(
    "UPDATE planos SET nome=$2,preco=$3,limite_produtos=$4,limite_pedidos_mes=$5,adicionais=$6,personalizacao=$7,ativo=$8 WHERE id=$1 RETURNING *",
    [parse(id, req.params.id), ...Object.values(d)],
  );
  if (!p) fail("Plano não encontrado.", 404);
  await audit(pool, null, req.user.id, "plano.editado", { id: p.id, ...d });
  res.json(p);
});
router.get("/politica", async (req, res) =>
  res.json(
    (await pool.query("SELECT * FROM politica_cobranca WHERE id=1")).rows[0],
  ),
);
router.put("/politica", async (req, res) => {
  const d = parse(
    z
      .object({
        lembrete_dias: z.number().int().min(0).max(90),
        suspender_dias: z.number().int().min(1).max(180),
        suspender_automaticamente: z.boolean(),
        reativar_automaticamente: z.boolean(),
      })
      .refine((d) => d.suspender_dias >= d.lembrete_dias),
    req.body,
  );
  await transaction(async (c) => {
    await c.query(
      "UPDATE politica_cobranca SET lembrete_dias=$1,suspender_dias=$2,suspender_automaticamente=$3,reativar_automaticamente=$4 WHERE id=1",
      Object.values(d),
    );
    await audit(c, null, req.user.id, "politica.editada", d);
  });
  res.json({ ok: true });
});
router.get("/cobranca/execucoes", async (req, res) =>
  res.json({
    execucoes: (
      await pool.query(
        "SELECT * FROM execucoes_cobranca ORDER BY id DESC LIMIT 30",
      )
    ).rows,
    lembretes: (
      await pool.query(
        "SELECT id,estabelecimento_id,vencimento,enviado_em,tentativas,ultimo_erro FROM lembretes_cobranca ORDER BY id DESC LIMIT 100",
      )
    ).rows,
  }),
);
router.post("/cobranca/executar", async (req, res) =>
  res.json(await reconcile()),
);
router.get("/interesses", async (req, res) =>
  res.json(
    (
      await pool.query(
        "SELECT * FROM interesses_comerciais ORDER BY id DESC LIMIT 200",
      )
    ).rows,
  ),
);
router.patch("/interesses/:id", async (req, res) => {
  const d = parse(z.object({ atendido: z.boolean() }), req.body);
  const r = await pool.query(
    "UPDATE interesses_comerciais SET atendido=$2 WHERE id=$1",
    [parse(id, req.params.id), d.atendido],
  );
  if (!r.rowCount) fail("Contato não encontrado.", 404);
  res.json({ ok: true });
});
module.exports = router;
