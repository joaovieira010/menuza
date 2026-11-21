import {
  el,
  button,
  input,
  api,
  send,
  money,
  decimalToCents,
  statuses,
} from "/assets/shared.js";
import { renderCatalog } from "/assets/admin/catalog.js";
import {
  check,
  field,
  pick,
  textarea,
  uploadField,
} from "/assets/admin/fields.js";
const $ = (s) => document.querySelector(s);
let catalog,
  section = "dashboard",
  busy = false;
const sections = {
  dashboard: "Visão geral",
  pedidos: "Pedidos",
  cupons: "Cupons de desconto",
  categorias: "Categorias",
  produtos: "Produtos",
  adicionais: "Adicionais",
  configuracoes: "Minha loja",
  assinatura: "Minha assinatura",
};
const notify = (text, error = false) => {
  $("#feedback").textContent = text;
  $("#feedback").classList.toggle("error", error);
};
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
async function refreshCatalog() {
  catalog = await api("admin/catalogo");
  $("#shop-name").textContent = catalog.loja.nome;
  $("#menu-link").href = "/" + catalog.loja.slug;
  $("#open-status").textContent = catalog.loja.aberto
    ? "● Loja aberta"
    : "● Loja fechada";
  $("#open-status").className =
    "badge " + (catalog.loja.aberto ? "open" : "closed");
}
async function enter() {
  await refreshCatalog();
  $("#login-screen").hidden = true;
  $("#panel").hidden = false;
  $("#today").textContent = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full",
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  await navigate(section);
}
$("#login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const b = e.target.querySelector("button");
  b.disabled = true;
  $("#login-error").textContent = "";
  try {
    const f = new FormData(e.target);
    await api(
      "admin/login",
      send("POST", { email: f.get("email"), senha: f.get("senha") }),
    );
    e.target.reset();
    await enter();
  } catch (err) {
    $("#login-error").textContent = err.message;
  } finally {
    b.disabled = false;
  }
});
$("#logout").addEventListener("click", () =>
  action(async () => {
    await api("admin/logout", send("POST", {}));
    location.reload();
  }),
);
$("#close-editor").addEventListener("click", () => $("#editor").close());
for (const [key, name] of Object.entries(sections))
  $("#navigation").append(button(name, () => action(() => navigate(key))));
async function navigate(name) {
  section = name;
  $("#page-title").textContent = sections[name];
  [...$("#navigation").children].forEach((n, i) =>
    n.classList.toggle("ativa", Object.keys(sections)[i] === name),
  );
  notify("");
  await render();
}
async function render() {
  const view = $("#view");
  view.replaceChildren();
  if (section === "dashboard") await dashboard(view);
  else if (section === "pedidos") await orderView(view);
  else if (section === "cupons") await couponView(view);
  else if (section === "assinatura") {
    const s = await api("admin/assinatura"),
      box = el("section", null, "box");
    const names = {
      trialing: "Em avaliação",
      active: "Ativa",
      pending: "Aguardando pagamento",
      past_due: "Em atraso",
      suspended: "Suspensa",
      canceled: "Cancelada",
    };
    box.append(
      el("h2", s.plano),
      el("p", money(s.valor) + " por mês"),
      el("p", "Próximo vencimento: " + String(s.vencimento).slice(0, 10)),
      el("p", "Situação: " + names[s.efetivo]),
      el(
        "p",
        "Último pagamento: " +
          (s.ultimo_pagamento
            ? String(s.ultimo_pagamento).slice(0, 10)
            : "Nenhum pagamento registrado"),
      ),
      el(
        "p",
        "Para registrar o comprovante, mudar de plano ou negociar o contrato, entre em contato com o responsável pela Menuza.",
        "help",
      ),
    );
    view.append(box);
  } else if (section === "configuracoes") settings(view);
  else
    renderCatalog(view, section, {
      catalog,
      endpoint: "admin",
      action,
      notify,
      refresh: async () => {
        await refreshCatalog();
        await render();
      },
      editor: (title, build, save) => {
        const form = $("#editor-form");
        form.replaceChildren();
        $("#editor-title").textContent = title;
        build(form);
        openEditor(form, () => save(form), refreshCatalog);
      },
    });
}
async function dashboard(view) {
  const data = await api("admin/dashboard"),
    stats = el("div", null, "stat-grid");
  for (const [name, value, hint] of [
    ["Pedidos de hoje", data.pedidos, "Todos os status"],
    [
      "Valor dos pedidos",
      money(data.faturamento),
      "Hoje · sem cancelados · pagamento externo",
    ],
    [
      "Cardápio ativo",
      catalog.produtos.filter(
        (p) =>
          p.ativo &&
          catalog.categorias.some(
            (c) => p.categoria_ids.includes(c.id) && c.ativo,
          ),
      ).length,
      "Produtos disponíveis",
    ],
  ]) {
    const card = el("div", null, "stat");
    card.append(el("span", name), el("strong", value), el("small", hint));
    stats.append(card);
  }
  view.append(stats);
  const box = el("section", null, "box");
  box.append(
    el("h2", "Os favoritos de hoje"),
    el("p", "Produtos mais pedidos, sem considerar cancelamentos.", "muted"),
  );
  if (!data.mais_vendidos.length)
    box.append(el("p", "As primeiras vendas vão aparecer por aqui.", "empty"));
  for (const p of data.mais_vendidos) {
    const row = el("div", null, "best-row");
    row.append(el("span", p.nome), el("strong", p.quantidade + " vendidos"));
    box.append(row);
  }
  view.append(
    box,
    button("Ver pedidos →", () => action(() => navigate("pedidos")), "primary"),
  );
}
const couponDateFormat = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});
function localDateInput(value) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 23);
}
async function couponView(view) {
  const coupons = await api("admin/cupons");
  const box = el("section", null, "box"),
    header = el("div", null, "box-header");
  header.append(
    el("h2", "Cupons cadastrados"),
    button("+ Novo cupom", () => editCoupon(), "primary"),
  );
  box.append(
    header,
    el(
      "p",
      "O desconto e o pedido mínimo consideram os itens e adicionais. Pedidos cancelados liberam uma utilização.",
      "help",
    ),
  );
  if (!coupons.length) box.append(el("p", "Nenhum cupom cadastrado.", "empty"));
  const status = {
    ativo: "Ativo",
    inativo: "Inativo",
    expirado: "Expirado",
    agendado: "Agendado",
    esgotado: "Esgotado",
  };
  for (const coupon of coupons) {
    const row = el("div", null, "record"),
      info = el("div", null, "coupon-info"),
      actions = el("div", null, "record-actions"),
      path = "admin/cupons/" + coupon.id;
    const discount =
      coupon.tipo === "percentual"
        ? (coupon.valor / 100).toLocaleString("pt-BR") + "% de desconto"
        : money(coupon.valor) + " de desconto fixo";
    info.append(
      el("strong", coupon.codigo),
      el("p", status[coupon.status] + " · " + discount),
      el(
        "p",
        "Validade de " +
          couponDateFormat.format(new Date(coupon.inicio_em)) +
          " a " +
          couponDateFormat.format(new Date(coupon.fim_em)),
      ),
      el(
        "p",
        `Utilizações: ${coupon.usos} / ${coupon.limite_usos ?? "sem limite"} · Pedido mínimo: ${money(coupon.pedido_minimo)}`,
      ),
    );
    actions.append(
      button("Editar", () => editCoupon(coupon)),
      button(coupon.ativo ? "Desativar" : "Ativar", () =>
        action(async () => {
          await api(path, send("PATCH", { ativo: !coupon.ativo }));
          await render();
          notify(coupon.ativo ? "Cupom desativado." : "Cupom ativado.");
        }),
      ),
      button("Excluir", () =>
        action(async () => {
          if (
            !confirm(
              `Excluir o cupom “${coupon.codigo}”? O histórico dos pedidos será preservado.`,
            )
          )
            return;
          await api(path, { method: "DELETE" });
          await render();
          notify("Cupom excluído.");
        }),
      ),
    );
    row.append(info, actions);
    box.append(row);
  }
  view.append(box);
}
function editCoupon(coupon = {}) {
  const form = $("#editor-form");
  form.replaceChildren();
  $("#editor-title").textContent = coupon.id ? "Editar cupom" : "Novo cupom";
  const code = field(form, "codigo", "Código do cupom", "text", coupon.codigo);
  code.maxLength = 40;
  code.autocapitalize = "characters";
  code.spellcheck = false;
  const type = pick(
    form,
    "tipo",
    "Tipo de desconto",
    [
      ["percentual", "Porcentagem"],
      ["fixo", "Valor fixo"],
    ],
    coupon.tipo,
  );
  const valueLabel = el("span");
  const value = input(
    "valor",
    "text",
    coupon.valor ? (coupon.valor / 100).toFixed(2) : "",
  );
  const labeledValue = el("label");
  labeledValue.append(valueLabel, value);
  form.append(labeledValue);
  const updateValueLabel = () => {
    valueLabel.textContent =
      type.value === "percentual" ? "Desconto (%)" : "Desconto (R$)";
  };
  type.addEventListener("change", updateValueLabel);
  updateValueLabel();
  value.required = true;
  const minimum = field(
    form,
    "pedido_minimo",
    "Pedido mínimo (R$)",
    "text",
    ((coupon.pedido_minimo ?? 0) / 100).toFixed(2),
  );
  for (const amount of [value, minimum]) {
    amount.inputMode = "decimal";
    amount.pattern = "[0-9]+([.,][0-9]{1,2})?";
    amount.title = "Digite um valor com até duas casas decimais.";
  }
  const start = field(
    form,
    "inicio_em",
    "Início",
    "datetime-local",
    localDateInput(coupon.inicio_em ?? new Date()).slice(
      0,
      coupon.id ? 23 : 16,
    ),
  );
  const end = field(
    form,
    "fim_em",
    "Encerramento",
    "datetime-local",
    coupon.fim_em ? localDateInput(coupon.fim_em) : "",
  );
  start.step = end.step = "any";
  const originalStart = start.value;
  const originalEnd = end.value;
  form.append(
    el(
      "p",
      `Horários em ${couponDateFormat.resolvedOptions().timeZone}.`,
      "help",
    ),
  );
  const limit = field(
    form,
    "limite_usos",
    "Limite de utilizações (vazio para ilimitado)",
    "number",
    coupon.limite_usos ?? "",
    false,
  );
  limit.min = 1;
  limit.max = 2147483647;
  check(form, "ativo", "Cupom ativo", coupon.ativo ?? true);
  openEditor(form, async (f) => {
    await api(
      "admin/cupons" + (coupon.id ? "/" + coupon.id : ""),
      send(coupon.id ? "PUT" : "POST", {
        codigo: f.codigo,
        tipo: f.tipo,
        valor: decimalToCents(f.valor),
        pedido_minimo: decimalToCents(f.pedido_minimo),
        inicio_em:
          coupon.inicio_em && f.inicio_em === originalStart
            ? coupon.inicio_em
            : new Date(f.inicio_em).toISOString(),
        fim_em:
          coupon.fim_em && f.fim_em === originalEnd
            ? coupon.fim_em
            : new Date(f.fim_em).toISOString(),
        limite_usos: f.limite_usos ? Number(f.limite_usos) : null,
        ativo: form.elements.ativo.checked,
      }),
    );
  });
}
function openEditor(form, save, refresh) {
  const error = el("p", null, "error");
  error.setAttribute("role", "alert");
  const submit = el("button", "Salvar", "primary wide");
  submit.type = "submit";
  form.append(error, submit);
  form.onsubmit = async (e) => {
    e.preventDefault();
    submit.disabled = true;
    error.textContent = "";
    try {
      await save(Object.fromEntries(new FormData(form)));
      $("#editor").close();
      await refresh?.();
      await render();
      notify("Alterações salvas.");
    } catch (e) {
      error.textContent = e.message;
    } finally {
      submit.disabled = false;
    }
  };
  $("#editor").showModal();
}
function settings(view) {
  const s = catalog.loja,
    form = el("form", null, "settings-form"),
    box = el("div", null, "box");
  box.append(
    el("h2", "Informações da loja"),
    el(
      "p",
      "O botão aberto/fechado controla o recebimento de pedidos. Os horários são informativos.",
      "help",
    ),
  );
  field(box, "nome", "Nome da loja", "text", s.nome).maxLength = 120;
  textarea(box, "descricao", "Descrição", s.descricao);
  uploadField(box, "logo_url", "Logo", s.logo_url);
  uploadField(box, "banner_url", "Banner", s.banner_url);
  field(box, "whatsapp", "WhatsApp com DDD e país", "tel", s.whatsapp);
  field(
    box,
    "taxa_entrega",
    "Taxa de entrega em reais",
    "text",
    (s.taxa_entrega / 100).toFixed(2),
  ).inputMode = "decimal";
  textarea(box, "horarios", "Horários de atendimento", s.horarios);
  field(box, "cor_principal", "Cor principal", "color", s.cor_principal);
  check(box, "aberto", "Loja aberta para receber pedidos", s.aberto);
  check(
    box,
    "entrega_ativa",
    "Receber pedidos de entrega",
    s.entrega_ativa ?? true,
  );
  check(
    box,
    "retirada_ativa",
    "Receber pedidos de retirada",
    s.retirada_ativa ?? true,
  );
  box.append(
    el("p", "Mantenha ao menos uma modalidade de recebimento ativa.", "help"),
  );
  box.append(el("p", "Endereço do cardápio: /" + s.slug, "help"));
  form.append(box);
  const submit = el("button", "Salvar configurações", "primary");
  submit.type = "submit";
  form.append(submit);
  view.append(form);
  // O upload procura o botão no formulário; a caixa já está conectada quando o usuário seleciona o arquivo.
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      if (
        !form.elements.entrega_ativa.checked &&
        !form.elements.retirada_ativa.checked
      )
        throw new Error(
          "Mantenha ao menos uma modalidade de recebimento ativa.",
        );
      const f = Object.fromEntries(new FormData(form));
      await api(
        "admin/configuracoes",
        send("PUT", {
          nome: f.nome,
          descricao: f.descricao,
          logo_url: f.logo_url,
          banner_url: f.banner_url,
          whatsapp: f.whatsapp,
          taxa_entrega: decimalToCents(f.taxa_entrega),
          horarios: f.horarios,
          cor_principal: f.cor_principal,
          aberto: form.elements.aberto.checked,
          entrega_ativa: form.elements.entrega_ativa.checked,
          retirada_ativa: form.elements.retirada_ativa.checked,
        }),
      );
      await refreshCatalog();
      notify("Configurações salvas.");
    } catch (err) {
      notify(err.message, true);
    } finally {
      submit.disabled = false;
    }
  });
}
let filters = {
  inicio: new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()),
  fim: "",
  status: "",
};
async function orderView(view) {
  const filter = el("form", null, "filters");
  for (const [name, title] of [
    ["inicio", "De"],
    ["fim", "Até"],
  ])
    field(filter, name, title, "date", filters[name], false);
  pick(
    filter,
    "status",
    "Status",
    [["", "Todos"], ...Object.entries(statuses)],
    filters.status,
  ).required = false;
  const go = el("button", "Filtrar", "primary");
  go.type = "submit";
  filter.append(
    go,
    button("Limpar", () => {
      filters = { inicio: "", fim: "", status: "" };
      action(render);
    }),
  );
  filter.addEventListener("submit", (e) => {
    e.preventDefault();
    filters = Object.fromEntries(new FormData(filter));
    action(render);
  });
  view.append(
    filter,
    el(
      "p",
      "Mostrando até 200 pedidos, mais recentes primeiro. Atualize para buscar novos pedidos.",
      "help",
    ),
    button("↻ Atualizar pedidos", () => action(render)),
  );
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v),
  );
  const rows = await api("admin/pedidos?" + query),
    grid = el("div", null, "orders-grid");
  if (!rows.length)
    view.append(el("p", "Nenhum pedido neste período.", "empty"));
  for (const p of rows) {
    const card = el("article", null, "order-card");
    card.dataset.status = p.status;
    const head = el("div", null, "order-title");
    head.append(
      el("h2", "#" + String(p.numero).padStart(6, "0")),
      el("span", statuses[p.status], "badge"),
    );
    card.append(
      head,
      el(
        "p",
        new Date(p.criado_em).toLocaleString("pt-BR", {
          timeZone: "America/Sao_Paulo",
        }),
        "muted",
      ),
      el("strong", p.cliente_nome),
      el("p", p.cliente_telefone),
    );
    const addr =
      p.modalidade === "retirada"
        ? "Retirada no estabelecimento"
        : [p.rua, p.numero_endereco, p.bairro, p.complemento, p.referencia]
            .filter(Boolean)
            .join(", ");
    card.append(el("p", addr));
    const lines = el("div", null, "order-lines");
    for (const i of p.itens) {
      lines.append(
        el(
          "p",
          `${i.quantidade}× ${i.nome} · ${money((i.preco + i.adicionais.reduce((n, a) => n + a.preco, 0)) * i.quantidade)}`,
        ),
      );
      if (i.adicionais.length)
        lines.append(
          el("p", "+ " + i.adicionais.map((a) => a.nome).join(", "), "muted"),
        );
      if (i.observacao) lines.append(el("p", "Obs.: " + i.observacao, "muted"));
    }
    card.append(
      lines,
      el(
        "p",
        `Pagamento: ${p.forma_pagamento}${p.troco_para !== null ? " · Troco para " + money(p.troco_para) : ""}`,
      ),
      el(
        "p",
        "Tipo de entrega: " +
          (p.modalidade === "entrega"
            ? "Entrega em domicílio · Taxa: " + money(p.taxa_entrega)
            : "Retirada no estabelecimento"),
      ),
      ...(p.cupom_codigo
        ? [
            el("p", "Valor original: " + money(p.total_original)),
            el(
              "p",
              `Cupom ${p.cupom_codigo} · Desconto de ${money(p.desconto)}`,
            ),
          ]
        : []),
      el("div", money(p.total), "order-total"),
    );
    if (p.observacoes) card.append(el("p", "Observações: " + p.observacoes));
    const actions = el("div", null, "record-actions");
    const change = (status) =>
      action(async () => {
        for (const b of actions.querySelectorAll("button")) b.disabled = true;
        try {
          const result = await api(
            `admin/pedidos/${p.id}/status`,
            send("PATCH", { status, status_anterior: p.status }),
          );
          await render();
          notify(
            result.aviso ||
              "Status atualizado. Abra o WhatsApp e confirme o envio ao cliente.",
          );
        } finally {
          for (const b of actions.querySelectorAll("button"))
            b.disabled = false;
        }
      });
    const labels = {
      confirmado: "Confirmar recebimento",
      em_preparacao: "Iniciar preparação",
      pronto: "Pedido pronto",
      saiu_para_entrega: "Saiu para entrega",
      concluido: "Concluir pedido",
      cancelado: "Cancelar pedido",
    };
    for (const next of p.proximos_status)
      actions.append(
        button(
          labels[next],
          () => {
            if (next !== "cancelado" || confirm("Cancelar este pedido?"))
              change(next);
          },
          next === "cancelado" ? "" : "primary",
        ),
      );
    const storeLink = el(
      "a",
      "Abrir pedido no WhatsApp da loja ↗",
      "whatsapp-link",
    );
    storeLink.href = p.whatsapp_url;
    storeLink.target = "_blank";
    storeLink.rel = "noopener noreferrer";
    card.append(storeLink);
    if (p.notificacao) {
      const preview = el("details");
      preview.append(
        el("summary", "Mensagem para o cliente"),
        el("pre", p.notificacao.mensagem),
      );
      card.append(preview);
      const open = button(
        p.notificacao.aberto_em
          ? "Abertura já solicitada"
          : "Abrir WhatsApp do cliente ↗",
        async () => {
          if (open.disabled) return;
          open.disabled = true;
          // Abre durante o clique para evitar bloqueio de popup após a chamada HTTP.
          const popup = window.open("about:blank", "_blank");
          if (!popup) {
            open.disabled = false;
            notify(
              "Permita a abertura de uma nova janela para acessar o WhatsApp.",
              true,
            );
            return;
          }
          popup.opener = null;
          try {
            const result = await api(
              `admin/pedidos/${p.id}/whatsapp`,
              send("POST", { historico_id: p.notificacao.id }),
            );
            popup.location.href = result.whatsapp_url;
            open.textContent = "Abertura já solicitada";
            notify(
              "Abertura do WhatsApp solicitada. Confirme o envio no WhatsApp; a Menuza não verifica o envio.",
            );
          } catch (e) {
            popup.close();
            open.disabled = e.status === 409;
            notify(e.message, true);
          }
        },
      );
      open.disabled = Boolean(p.notificacao.aberto_em);
      actions.append(open);
    }
    card.append(
      el(
        "p",
        "O link abre o WhatsApp com a mensagem preenchida. O envio exige confirmação manual.",
        "help",
      ),
    );
    card.append(actions);
    const history = el("details"),
      list = el("ol");
    history.append(el("summary", "Histórico do pedido"));
    for (const h of p.historico)
      list.append(
        el(
          "li",
          statuses[h.status] +
            " · " +
            (h.usuario_email ||
              (h.status === "pendente"
                ? "Cliente no checkout"
                : "Autor não registrado (histórico anterior)")) +
            " · " +
            new Date(h.criado_em).toLocaleString("pt-BR", {
              timeZone: "America/Sao_Paulo",
            }),
        ),
      );
    history.append(list);
    card.append(history);
    grid.append(card);
  }
  view.append(grid);
}
try {
  await api("admin/me");
  await enter();
} catch (e) {
  if (e.status !== 401) $("#login-error").textContent = e.message;
}
