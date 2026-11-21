import {
  el,
  button,
  label,
  input,
  select,
  api,
  send,
  money,
  decimalToCents,
} from "/assets/shared.js";
import { renderCatalog } from "/assets/admin/catalog.js";
const $ = (s) => document.querySelector(s),
  endpoint = "superadmin/";
const call = (p, o) => api(endpoint + p, o);
let section = "dashboard",
  plans = [],
  busy = false,
  catalogStore = null,
  catalogSection = "categorias";
const names = {
  dashboard: "Visão geral",
  lojas: "Estabelecimentos",
  planos: "Planos",
  politica: "Cobrança e rotina",
  interesses: "Contatos comerciais",
};
const states = {
  trialing: "Em avaliação",
  active: "Ativa",
  pending: "Aguardando pagamento",
  past_due: "Em atraso",
  suspended: "Suspensa",
  canceled: "Cancelada",
};
const date = (v) => (v ? String(v).slice(0, 10) : "—");
function notify(t, error = false) {
  $("#feedback").textContent = t;
  $("#feedback").classList.toggle("error", error);
}
async function action(work) {
  if (busy) return;
  busy = true;
  try {
    await work();
  } catch (e) {
    notify(e.message, true);
  } finally {
    busy = false;
  }
}
function field(f, name, title, type = "text", value = "", required = true) {
  const n = input(name, type, value);
  n.required = required;
  f.append(label(title, n));
  return n;
}
function check(f, name, title, value) {
  const n = input(name, "checkbox");
  n.checked = value;
  f.append(label(title, n));
  return n;
}
function pick(f, name, title, options, value) {
  const n = select(name, options, value);
  f.append(label(title, n));
  return n;
}
function formData(f) {
  return Object.fromEntries(new FormData(f));
}
function editor(title, build, save) {
  $("#editor-title").textContent = title;
  const f = $("#editor-form");
  f.replaceChildren();
  build(f);
  const error = el("p", "", "error");
  error.setAttribute("role", "alert");
  const submit = el("button", "Salvar", "primary");
  submit.type = "submit";
  f.append(error, submit);
  f.onsubmit = async (e) => {
    e.preventDefault();
    submit.disabled = true;
    error.textContent = "";
    try {
      await save(f);
      $("#editor").close();
      await render();
      notify("Operação registrada.");
    } catch (e) {
      error.textContent = e.message;
    } finally {
      submit.disabled = false;
    }
  };
  $("#editor").showModal();
}
$("#close-editor").onclick = () => $("#editor").close();
for (const [k, n] of Object.entries(names))
  $("#navigation").append(
    button(n, () =>
      action(async () => {
        section = k;
        catalogStore = null;
        await render();
      }),
    ),
  );
async function enter() {
  plans = await call("planos");
  $("#login-screen").hidden = true;
  $("#panel").hidden = false;
  await render();
}
$("#login").onsubmit = async (e) => {
  e.preventDefault();
  const b = e.target.querySelector("button");
  b.disabled = true;
  try {
    await call("login", send("POST", formData(e.target)));
    await enter();
  } catch (e) {
    $("#login-error").textContent = e.message;
  } finally {
    b.disabled = false;
  }
};
$("#logout").onclick = () =>
  action(async () => {
    await call("logout", send("POST", {}));
    location.reload();
  });
async function render() {
  $("#page-title").textContent = names[section];
  $("#today").textContent = "MENUZA · OPERAÇÃO COMERCIAL";
  $("#feedback").textContent = "";
  [...$("#navigation").children].forEach((n, i) =>
    n.classList.toggle("ativa", Object.keys(names)[i] === section),
  );
  const view = $("#view");
  view.replaceChildren();
  if (section === "dashboard") {
    const d = await call("dashboard"),
      grid = el("div", null, "stat-grid");
    for (const [key, title, financial] of [
      ["total", "Estabelecimentos"],
      ["ativos", "Ativos"],
      ["suspensos", "Suspensos"],
      ["em_atraso", "Assinaturas vencidas"],
      ["mrr_contratada", "Receita mensal contratada", true],
      ["pagamentos_recebidos_mes", "Pagamentos recebidos no mês", true],
      ["novos_clientes", "Novos clientes neste mês"],
    ]) {
      const c = el("div", null, "stat");
      c.append(
        el("span", title),
        el("strong", financial ? money(d[key]) : d[key]),
      );
      grid.append(c);
    }
    const box = el("section", null, "box");
    box.append(el("h2", "Próximos vencimentos"));
    for (const r of d.proximos)
      box.append(
        el("p", `${r.nome} · ${date(r.vencimento)} · ${money(r.valor)}`),
      );
    if (!d.proximos.length) box.append(el("p", "Nenhum vencimento futuro."));
    view.append(
      grid,
      el(
        "p",
        "Receita contratada inclui contratos suspensos não cancelados; recebimentos vêm apenas dos pagamentos confirmados.",
        "help",
      ),
      box,
    );
    return;
  }
  if (section === "lojas") {
    if (catalogStore) {
      await storeCatalog(view);
      return;
    }
    const f = el("form", null, "filters");
    field(f, "busca", "Buscar pelo nome", "search", "", false);
    pick(f, "situacao", "Situação", [
      ["", "Todas"],
      ["active", "Ativas (cadastro)"],
      ["suspended", "Suspensas"],
      ["archived", "Arquivadas"],
    ]);
    const submit = el("button", "Buscar");
    f.append(submit);
    view.append(
      f,
      button("Cadastrar estabelecimento", () => storeEditor(), "primary"),
    );
    const list = el("div");
    view.append(list);
    const load = async () => {
      const rows = await call("lojas?" + new URLSearchParams(formData(f)));
      list.replaceChildren();
      if (!rows.length)
        list.append(el("p", "Nenhum estabelecimento encontrado.", "empty"));
      for (const l of rows) {
        const card = el("article", null, "box"),
          link = el("a", location.origin + "/" + l.slug);
        card.dataset.storeId = l.id;
        link.href = "/" + l.slug;
        link.target = "_blank";
        link.rel = "noopener";
        card.append(
          el("h2", l.nome),
          el(
            "p",
            [l.responsavel, l.email, l.telefone].filter(Boolean).join(" · ") ||
              "Contato ainda não informado",
          ),
          link,
          el(
            "p",
            `${l.plano} · ${money(l.valor)}/mês · Vence ${date(l.vencimento)}`,
          ),
          el("p", `${states[l.status]} · Cadastro: ${l.situacao}`),
        );
        const actions = el("div", null, "record-actions");
        actions.append(
          button("Editar", () => storeEditor(l)),
          button("Gerenciar cardápio", () =>
            action(async () => {
              catalogStore = l;
              catalogSection = "categorias";
              await render();
            }),
          ),
          button("Histórico e assinatura", () => action(() => history(l))),
          button("Registrar pagamento", () => payment(l)),
        );
        for (const [acao, title] of [
          ["suspender", "Suspender"],
          ["reativar", "Reativar"],
          ["arquivar", "Arquivar"],
          ["cancelar", "Cancelar assinatura"],
        ])
          actions.append(button(title, () => stateEditor(l, acao, title)));
        card.append(actions);
        list.append(card);
      }
    };
    f.onsubmit = (e) => {
      e.preventDefault();
      action(load);
    };
    await load();
    return;
  }
  if (section === "interesses") {
    const rows = await call("interesses");
    if (!rows.length) view.append(el("p", "Nenhum contato recebido.", "empty"));
    for (const r of rows) {
      const c = el("article", null, "box");
      c.append(
        el("h2", r.estabelecimento),
        el("p", `${r.nome} · ${r.email} · ${r.telefone}`),
        el("p", [r.tipo_negocio, r.cidade].filter(Boolean).join(" · ")),
        el("p", r.mensagem),
        el(
          "p",
          `${r.atendido ? "Atendido" : "Novo contato"} · ${new Date(r.criado_em).toLocaleString("pt-BR")}`,
        ),
        button(r.atendido ? "Marcar como novo" : "Marcar como atendido", () =>
          action(async () => {
            await call(
              "interesses/" + r.id,
              send("PATCH", { atendido: !r.atendido }),
            );
            await render();
          }),
        ),
      );
      view.append(c);
    }
    return;
  }
  if (section === "planos") {
    plans = await call("planos");
    view.append(button("Novo plano", () => planEditor(), "primary"));
    for (const p of plans) {
      const box = el("div", null, "box");
      box.append(
        el("h2", p.nome),
        el(
          "p",
          `${money(p.preco)}/mês · ${p.ativo ? "Disponível" : "Inativo"}`,
        ),
        el(
          "p",
          `${p.limite_produtos || "Sem limite de"} produtos · ${p.limite_pedidos_mes || "Sem limite de"} pedidos/mês · Adicionais: ${p.adicionais ? "sim" : "não"} · Personalização: ${p.personalizacao ? "sim" : "não"}`,
        ),
        button("Editar plano", () => planEditor(p)),
      );
      view.append(box);
    }
    view.append(
      el(
        "p",
        "Alterar o preço de tabela não muda o valor já contratado. Limites e recursos do plano são aplicados aos clientes vinculados.",
        "help",
      ),
    );
    return;
  }
  const p = await call("politica"),
    f = el("form", null, "box settings-form");
  field(
    f,
    "lembrete_dias",
    "Dias após vencimento para lembrete",
    "number",
    p.lembrete_dias,
  );
  field(
    f,
    "suspender_dias",
    "Dias após vencimento para suspensão",
    "number",
    p.suspender_dias,
  );
  check(
    f,
    "suspender_automaticamente",
    "Suspender automaticamente",
    p.suspender_automaticamente,
  );
  check(
    f,
    "reativar_automaticamente",
    "Reativar ao confirmar quitação (exceto suspensões manuais)",
    p.reativar_automaticamente,
  );
  const b = el("button", "Salvar política", "primary");
  f.append(b);
  f.onsubmit = (e) => {
    e.preventDefault();
    action(async () => {
      const d = formData(f);
      await call(
        "politica",
        send("PUT", {
          lembrete_dias: Number(d.lembrete_dias),
          suspender_dias: Number(d.suspender_dias),
          suspender_automaticamente:
            f.elements.suspender_automaticamente.checked,
          reativar_automaticamente: f.elements.reativar_automaticamente.checked,
        }),
      );
      notify("Política salva.");
    });
  };
  view.append(
    f,
    el(
      "p",
      "A rotina roda a cada 15 minutos com trava no banco. O acesso verifica a política em tempo real. Lembretes só são enviados quando BILLING_WEBHOOK_URL está configurado; sem provedor ficam na fila.",
      "help",
    ),
    button("Reprocessar vencimentos", () =>
      action(async () => {
        await call("cobranca/executar", send("POST", {}));
        await render();
        notify("Rotina executada.");
      }),
    ),
  );
  const logs = await call("cobranca/execucoes");
  const box = el("div", null, "box");
  box.append(el("h2", "Execuções e lembretes"));
  for (const r of logs.execucoes)
    box.append(
      el(
        "p",
        `#${r.id} · ${new Date(r.iniciado_em).toLocaleString("pt-BR")} · ${r.alteradas} alterações · ${r.erro || (r.concluido_em ? "Concluída" : "Em execução/interrompida")}`,
      ),
    );
  for (const r of logs.lembretes)
    box.append(
      el(
        "p",
        `Lembrete #${r.id} · Loja ${r.estabelecimento_id} · ${r.enviado_em ? "Entregue ao provedor" : "Pendente"} · ${r.tentativas} tentativas ${r.ultimo_erro || ""}`,
      ),
    );
  view.append(box);
}
async function storeCatalog(view) {
  const endpoint = `superadmin/lojas/${catalogStore.id}/cardapio`;
  $("#page-title").textContent = "Cardápio da loja";
  const header = el("section", null, "box");
  const nav = el("nav", null, "record-actions");
  nav.setAttribute("aria-label", "Seções do cardápio da loja");
  header.append(
    button("Voltar aos estabelecimentos", () =>
      action(async () => {
        catalogStore = null;
        await render();
      }),
    ),
    el("h2", catalogStore.nome),
    nav,
  );
  for (const [section, title] of [
    ["categorias", "Categorias"],
    ["produtos", "Produtos"],
    ["adicionais", "Adicionais"],
  ]) {
    const tab = button(
      title,
      () =>
        action(async () => {
          catalogSection = section;
          await render();
        }),
      section === catalogSection ? "primary" : "",
    );
    tab.setAttribute("aria-pressed", String(section === catalogSection));
    nav.append(tab);
  }
  view.append(header);
  const catalog = await api(endpoint + "/catalogo");
  renderCatalog(view, catalogSection, {
    catalog,
    endpoint,
    action,
    notify,
    refresh: render,
    editor,
  });
}
function storeEditor(l) {
  editor(
    l ? "Editar estabelecimento" : "Cadastrar estabelecimento",
    (f) => {
      field(f, "nome", "Nome comercial", "text", l?.nome || "");
      field(f, "responsavel", "Responsável", "text", l?.responsavel || "");
      field(f, "email", "E-mail de contato", "email", l?.email || "");
      field(f, "telefone", "Telefone com DDD", "tel", l?.telefone || "");
      field(
        f,
        "slug",
        "Endereço do cardápio (vazio gera automaticamente)",
        "text",
        l?.slug || "",
        false,
      );
      pick(
        f,
        "plano_id",
        "Plano",
        plans
          .filter((p) => p.ativo || p.id === l?.plano_id)
          .map((p) => [p.id, `${p.nome} · ${money(p.preco)}`]),
        l?.plano_id,
      );
      const val = field(
        f,
        "valor",
        "Mensalidade contratada (R$)",
        "text",
        l
          ? (l.valor / 100).toFixed(2)
          : (plans.find((p) => p.ativo)?.preco / 100 || 0).toFixed(2),
      );
      f.elements.plano_id.onchange = () => {
        val.value = (
          plans.find((p) => String(p.id) === f.elements.plano_id.value).preco /
          100
        ).toFixed(2);
      };
      field(
        f,
        "vencimento",
        "Próximo vencimento",
        "date",
        l ? date(l.vencimento) : "",
      );
      field(
        f,
        "admin_email",
        "E-mail de acesso do proprietário",
        "email",
        l?.admin_email || "",
      );
      const pwd = field(
        f,
        "senha",
        l
          ? "Nova senha (vazio mantém a atual)"
          : "Senha inicial (mínimo 12 caracteres)",
        "password",
        "",
        !l,
      );
      pwd.minLength = 12;
      pwd.maxLength = 72;
      if (!l)
        pick(f, "status", "Situação inicial", [
          ["active", "Contrato ativo"],
          ["trialing", "Período de avaliação"],
        ]);
      f.append(
        el(
          "p",
          "A loja começa fechada e sem produtos. O proprietário configura o cardápio em /admin e abre quando estiver pronto. Nenhum pagamento é gerado pelo cadastro.",
          "help",
        ),
      );
    },
    async (f) => {
      const d = formData(f);
      d.valor = decimalToCents(d.valor);
      if (!d.slug) delete d.slug;
      if (!d.senha) delete d.senha;
      const r = await call(
        "lojas" + (l ? "/" + l.id : ""),
        send(l ? "PUT" : "POST", d),
      );
      if (!l) notify("Loja criada: " + location.origin + "/" + r.slug);
    },
  );
}
function stateEditor(l, acao, title) {
  editor(
    `${title}: ${l.nome}`,
    (f) => {
      f.append(
        el(
          "p",
          "Arquivamento e cancelamento preservam pedidos e registros financeiros. Reativação exige vencimento regular.",
        ),
      );
      field(f, "observacao", "Motivo da alteração");
    },
    (f) =>
      call(`lojas/${l.id}/situacao`, send("POST", { acao, ...formData(f) })),
  );
}
function payment(l) {
  editor(
    "Confirmar pagamento: " + l.nome,
    (f) => {
      f.append(
        el(
          "p",
          "Registre somente após conferir o recebimento do PIX. Esta ação registra a quitação e avança o vencimento; não cobra o cliente.",
          "help",
        ),
      );
      field(
        f,
        "valor",
        "Valor recebido (R$)",
        "text",
        (l.valor / 100).toFixed(2),
      );
      field(
        f,
        "pago_em",
        "Data do recebimento",
        "date",
        new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Sao_Paulo",
        }).format(new Date()),
      );
      field(f, "referencia", "Referência única do comprovante");
      field(f, "proximo_vencimento", "Próximo vencimento", "date", "");
      field(f, "observacao", "Observação", "text", "", false);
      const c = check(
        f,
        "confirmado",
        "Conferi e confirmo o recebimento",
        false,
      );
      c.required = true;
    },
    (f) => {
      const d = formData(f);
      d.valor = decimalToCents(d.valor);
      d.confirmado = f.elements.confirmado.checked;
      return call(`lojas/${l.id}/pagamentos`, send("POST", d));
    },
  );
}
async function history(l) {
  const d = await call(`lojas/${l.id}/historico`);
  $("#editor-title").textContent = "Histórico: " + l.nome;
  const f = $("#editor-form");
  f.replaceChildren();
  f.onsubmit = (e) => e.preventDefault();
  f.append(
    el(
      "p",
      `${states[d.assinatura.efetivo]} · ${money(d.assinatura.valor)} · Vence ${date(d.assinatura.vencimento)}`,
    ),
    el("h3", "Pagamentos confirmados"),
  );
  if (!d.pagamentos.length) f.append(el("p", "Nenhum pagamento registrado."));
  for (const p of d.pagamentos)
    f.append(
      el(
        "p",
        `${date(p.pago_em)} · ${money(p.valor)} · Ref.: ${p.referencia} · Próximo: ${date(p.proximo_vencimento)} · ${p.observacao}`,
      ),
    );
  f.append(el("h3", "Alterações na conta"));
  for (const h of d.historico)
    f.append(
      el(
        "p",
        `${new Date(h.criado_em).toLocaleString("pt-BR")} · ${h.acao} · ${JSON.stringify(h.detalhes)}`,
      ),
    );
  $("#editor").showModal();
}
function planEditor(p) {
  editor(
    p ? "Editar plano" : "Novo plano",
    (f) => {
      field(f, "nome", "Nome", "text", p?.nome || "");
      field(
        f,
        "preco",
        "Preço de tabela (R$)",
        "text",
        ((p?.preco || 0) / 100).toFixed(2),
      );
      field(
        f,
        "limite_produtos",
        "Limite de produtos ativos (vazio = ilimitado)",
        "number",
        p?.limite_produtos || "",
        false,
      );
      field(
        f,
        "limite_pedidos_mes",
        "Pedidos por mês (vazio = ilimitado)",
        "number",
        p?.limite_pedidos_mes || "",
        false,
      );
      check(f, "adicionais", "Permitir adicionais", p?.adicionais ?? true);
      check(
        f,
        "personalizacao",
        "Permitir personalização",
        p?.personalizacao ?? true,
      );
      check(f, "ativo", "Oferecer para novas contratações", p?.ativo ?? true);
    },
    async (f) => {
      const d = formData(f);
      d.preco = decimalToCents(d.preco);
      for (const k of ["limite_produtos", "limite_pedidos_mes"])
        d[k] = d[k] ? Number(d[k]) : null;
      for (const k of ["adicionais", "personalizacao", "ativo"])
        d[k] = f.elements[k].checked;
      await call("planos" + (p ? "/" + p.id : ""), send(p ? "PUT" : "POST", d));
      plans = await call("planos");
    },
  );
}
try {
  await call("me");
  await enter();
} catch (e) {
  if (e.status !== 401) $("#login-error").textContent = e.message;
}
