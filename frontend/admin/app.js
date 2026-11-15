import {
  el,
  button,
  label,
  input,
  select,
  api,
  send,
  money,
  image,
  decimalToCents,
  statuses,
} from "/assets/shared.js";
const $ = (s) => document.querySelector(s);
let catalog,
  section = "dashboard",
  busy = false;
const sections = {
  dashboard: "Visão geral",
  pedidos: "Pedidos",
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
function field(form, name, text, type = "text", value = "", required = true) {
  const n = input(name, type, value);
  n.required = required;
  form.append(label(text, n));
  return n;
}
function check(form, name, text, value) {
  const n = input(name, "checkbox");
  n.checked = value;
  const l = label(text, n);
  l.className = "extra-option";
  form.append(l);
  return n;
}
function pick(form, name, text, options, value) {
  const n = select(name, options, value);
  n.required = true;
  form.append(label(text, n));
  return n;
}
function textarea(form, name, text, value, max = 1000) {
  const n = el("textarea");
  n.name = name;
  n.value = value || "";
  n.maxLength = max;
  n.rows = 3;
  form.append(label(text, n));
  return n;
}
function uploadField(form, name, text, value) {
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
      const result = await api("admin/upload", { method: "POST", body: data });
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
  else if (section === "adicionais") {
    resourceView(
      view,
      "grupos",
      "Grupos de opções",
      "Os grupos podem atender um produto ou todos os produtos de uma categoria. Cada opção pode ser escolhida uma vez por item.",
    );
    resourceView(view, "adicionais", "Opções adicionais");
  } else resourceView(view, section, sections[section]);
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
          catalog.categorias.some((c) => c.id === p.categoria_id && c.ativo),
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
function resourceView(view, resource, title, help) {
  const box = el("section", null, "box"),
    header = el("div", null, "box-header");
  header.append(
    el("h2", title),
    button("+ Adicionar", () => edit(resource), "primary"),
  );
  box.append(header);
  if (help) box.append(el("p", help, "help"));
  const rows = catalog[resource] || [];
  if (!rows.length)
    box.append(
      el(
        "p",
        "Nenhum registro por enquanto. Use “Adicionar” para começar.",
        "empty",
      ),
    );
  for (const r of rows) {
    const row = el("div", null, "record" + (!r.ativo ? " inactive" : "")),
      info = el("div", null, "record-info"),
      copy = el("div");
    copy.append(el("strong", r.nome));
    let desc = r.ativo ? "Ativo" : "Desativado";
    if (resource === "produtos")
      desc =
        money(r.preco) +
        " · " +
        catalog.categorias.find((c) => c.id === r.categoria_id)?.nome +
        " · " +
        desc;
    if (resource === "grupos")
      desc =
        `${r.minimo} a ${r.maximo} opções · ` +
        (r.produto_id
          ? catalog.produtos.find((p) => p.id === r.produto_id)?.nome
          : catalog.categorias.find((c) => c.id === r.categoria_id)?.nome) +
        " · " +
        desc;
    if (resource === "adicionais")
      desc =
        money(r.preco) +
        " · " +
        catalog.grupos.find((g) => g.id === r.grupo_id)?.nome +
        " · " +
        desc;
    copy.append(el("p", desc));
    if (resource === "produtos") info.append(image(r.imagem_url, r.nome));
    info.append(copy);
    const actions = el("div", null, "record-actions");
    actions.append(button("Editar", () => edit(resource, r)));
    if (r.ativo)
      actions.append(
        button("Desativar", () =>
          action(async () => {
            if (
              !confirm(
                `Desativar “${r.nome}”? O histórico de pedidos será preservado.`,
              )
            )
              return;
            await api(`admin/${resource}/${r.id}`, { method: "DELETE" });
            await refreshCatalog();
            await render();
            notify("Registro desativado.");
          }),
        ),
      );
    row.append(info, actions);
    box.append(row);
  }
  view.append(box);
}
function edit(resource, record = {}) {
  const form = $("#editor-form");
  form.replaceChildren();
  $("#editor-title").textContent =
    (record.id ? "Editar" : "Adicionar") +
    " " +
    {
      categorias: "categoria",
      produtos: "produto",
      grupos: "grupo",
      adicionais: "adicional",
    }[resource];
  field(form, "nome", "Nome", "text", record.nome || "").maxLength = 120;
  if (resource === "categorias") {
    const n = field(
      form,
      "ordem",
      "Ordem de exibição",
      "number",
      record.ordem || 0,
    );
    n.min = 0;
    n.max = 9999;
  }
  if (resource === "produtos") {
    pick(
      form,
      "categoria_id",
      "Categoria",
      catalog.categorias.map((c) => [c.id, c.nome]),
      record.categoria_id,
    );
    textarea(form, "descricao", "Descrição", record.descricao);
    field(
      form,
      "preco",
      "Preço em reais (ex.: 28,90)",
      "text",
      record.preco !== undefined ? (record.preco / 100).toFixed(2) : "",
    ).inputMode = "decimal";
    uploadField(form, "imagem_url", "Foto do produto", record.imagem_url);
  }
  if (resource === "grupos") {
    const options = [
      ...catalog.categorias.map((c) => ["c:" + c.id, "Categoria: " + c.nome]),
      ...catalog.produtos.map((p) => ["p:" + p.id, "Produto: " + p.nome]),
    ];
    pick(
      form,
      "vinculo",
      "Aplicar a",
      options,
      record.produto_id
        ? "p:" + record.produto_id
        : record.categoria_id
          ? "c:" + record.categoria_id
          : undefined,
    );
    for (const [name, title, def] of [
      ["minimo", "Mínimo de opções (0 = opcional)", 0],
      ["maximo", "Máximo de opções", 5],
    ]) {
      const n = field(form, name, title, "number", record[name] ?? def);
      n.min = 0;
      n.max = 20;
    }
  }
  if (resource === "adicionais") {
    pick(
      form,
      "grupo_id",
      "Grupo",
      catalog.grupos.map((g) => [g.id, g.nome]),
      record.grupo_id,
    );
    field(
      form,
      "preco",
      "Preço em reais",
      "text",
      record.preco !== undefined ? (record.preco / 100).toFixed(2) : "",
    ).inputMode = "decimal";
  }
  check(form, "ativo", "Ativo no cardápio", record.ativo ?? true);
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
      const f = Object.fromEntries(new FormData(form)),
        data = { nome: f.nome, ativo: form.elements.ativo.checked };
      if (resource === "categorias") data.ordem = Number(f.ordem);
      if (resource === "produtos")
        Object.assign(data, {
          categoria_id: Number(f.categoria_id),
          descricao: f.descricao,
          preco: decimalToCents(f.preco),
          imagem_url: f.imagem_url,
        });
      if (resource === "grupos") {
        const [type, id] = f.vinculo.split(":");
        Object.assign(data, {
          produto_id: type === "p" ? Number(id) : null,
          categoria_id: type === "c" ? Number(id) : null,
          minimo: Number(f.minimo),
          maximo: Number(f.maximo),
        });
      }
      if (resource === "adicionais")
        Object.assign(data, {
          grupo_id: Number(f.grupo_id),
          preco: decimalToCents(f.preco),
        });
      await api(
        "admin/" + resource + (record.id ? "/" + record.id : ""),
        send(record.id ? "PUT" : "POST", data),
      );
      $("#editor").close();
      await refreshCatalog();
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
