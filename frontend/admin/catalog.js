import {
  api,
  button,
  el,
  image,
  input,
  money,
  send,
  decimalToCents,
} from "/assets/shared.js";
import {
  check,
  field,
  pick,
  textarea,
  uploadField,
} from "/assets/admin/fields.js";

const resources = {
  categorias: { title: "Categorias", name: "categoria" },
  produtos: { title: "Produtos", name: "produto" },
  grupos: { title: "Grupos de opções", name: "grupo de opções" },
  adicionais: { title: "Opções adicionais", name: "adicional" },
};

function choices(form, title, name, records, selected, empty) {
  const options = el("fieldset", null, "category-choices");
  options.append(el("legend", title));
  if (!records.length) options.append(el("p", empty, "help"));
  for (const record of records) {
    const row = el("label"),
      checkbox = input(name, "checkbox", record.id);
    checkbox.checked = selected.has(record.id);
    row.append(
      checkbox,
      el("span", record.nome + (record.ativo ? "" : " (inativo)")),
    );
    options.append(row);
  }
  form.append(options);
  return options;
}

const categoryResources = ["produtos", "grupos", "adicionais"];

function edit(resource, record, { catalog, endpoint, editor }) {
  const selected = record.categoria_ids ?? [];
  const linkResources =
    catalog.permissoes?.adicionais === false ? ["produtos"] : categoryResources;
  const groupNames = new Map(
    catalog.grupos.map((group) => [group.id, group.nome]),
  );
  const categoryChoices = (form, title = "Categorias") =>
    choices(
      form,
      title,
      "categoria_ids",
      catalog.categorias,
      new Set(selected),
      "Crie uma categoria para poder selecioná-la.",
    );
  const title =
    (record.id ? "Editar " : "Adicionar ") + resources[resource].name;
  editor(
    title,
    (form) => {
      field(form, "nome", "Nome", "text", record.nome || "").maxLength = 120;
      if (resource === "categorias") {
        const order = field(
          form,
          "ordem",
          "Ordem de exibição",
          "number",
          record.ordem ?? 0,
        );
        order.min = 0;
        order.max = 9999;
        if (linkResources.includes("adicionais"))
          form.append(
            el(
              "p",
              "As opções que herdam os vínculos do grupo acompanham o grupo. Selecione abaixo os adicionais que devem ter um vínculo direto com esta categoria.",
              "help",
            ),
          );
        for (const name of linkResources)
          choices(
            form,
            name === "adicionais"
              ? "Adicionais com vínculo direto"
              : resources[name].title,
            name,
            name === "adicionais"
              ? catalog[name].map((item) => ({
                  ...item,
                  nome: `${item.nome} · ${groupNames.get(item.grupo_id)}`,
                }))
              : catalog[name],
            new Set(
              catalog[name]
                .filter((item) => item.categoria_ids?.includes(record.id))
                .map((item) => item.id),
            ),
            "Nenhum item cadastrado.",
          );
      }
      if (resource === "produtos") {
        categoryChoices(form);
        textarea(form, "descricao", "Descrição", record.descricao);
      }
      if (resource === "grupos") {
        const product = pick(
          form,
          "produto_id",
          "Produto específico (opcional)",
          [
            ["", "Nenhum produto específico"],
            ...catalog.produtos.map((p) => [p.id, p.nome]),
          ],
          record.produto_id ?? "",
        );
        product.required = false;
        categoryChoices(form);
        for (const [name, title, fallback] of [
          ["minimo", "Mínimo de opções (0 = opcional)", 0],
          ["maximo", "Máximo de opções", 5],
        ]) {
          const limit = field(
            form,
            name,
            title,
            "number",
            record[name] ?? fallback,
          );
          limit.min = 0;
          limit.max = 20;
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
        const mode = pick(
          form,
          "categoria_modo",
          "Disponibilidade",
          [
            ["grupo", "Herdar os vínculos do grupo"],
            ["categorias", "Escolher categorias"],
            ["grupo_e_categorias", "Herdar e escolher outras categorias"],
          ],
          record.herda_categorias === false
            ? "categorias"
            : selected.length
              ? "grupo_e_categorias"
              : "grupo",
        );
        const options = categoryChoices(form, "Categorias com vínculo direto");
        const showCategories = () => {
          options.hidden = options.disabled = mode.value === "grupo";
        };
        mode.addEventListener("change", showCategories);
        showCategories();
      }
      if (resource === "produtos" || resource === "adicionais")
        field(
          form,
          "preco",
          "Preço em reais (ex.: 28,90)",
          "text",
          record.preco === undefined ? "" : (record.preco / 100).toFixed(2),
        ).inputMode = "decimal";
      if (resource === "produtos")
        uploadField(
          form,
          "imagem_url",
          "Foto do produto",
          record.imagem_url,
          endpoint,
        );
      check(form, "ativo", "Ativo no cardápio", record.ativo ?? true);
    },
    async (form) => {
      const values = new FormData(form);
      const f = Object.fromEntries(values);
      const data = { nome: f.nome, ativo: form.elements.ativo.checked };
      const ids = new Set(values.getAll("categoria_ids"));
      const categoryIds = [
        ...new Set([...selected.filter((id) => ids.has(id)), ...ids]),
      ];
      if (resource === "categorias") {
        data.ordem = Number(f.ordem);
        data.vinculos = Object.fromEntries(
          linkResources.map((name) => [name, values.getAll(name)]),
        );
      }
      if (resource === "produtos")
        Object.assign(data, {
          categoria_ids: categoryIds,
          descricao: f.descricao,
          preco: decimalToCents(f.preco),
          imagem_url: f.imagem_url,
        });
      if (resource === "grupos")
        Object.assign(data, {
          produto_id: f.produto_id || null,
          categoria_ids: categoryIds,
          minimo: Number(f.minimo),
          maximo: Number(f.maximo),
        });
      if (resource === "adicionais")
        Object.assign(data, {
          grupo_id: f.grupo_id,
          categoria_ids: categoryIds,
          herdar_categorias: f.categoria_modo !== "categorias",
          preco: decimalToCents(f.preco),
        });
      await api(
        endpoint + "/" + resource + (record.id ? "/" + record.id : ""),
        send(record.id ? "PUT" : "POST", data),
      );
    },
  );
}

function description(resource, record, catalog) {
  const categories = catalog.categorias
    .filter((category) => record.categoria_ids?.includes(category.id))
    .map((category) => category.nome)
    .join(", ");
  const links = categories || "Sem categorias";
  const status = record.ativo ? "Ativo" : "Desativado";
  if (resource === "produtos") return [money(record.preco), links, status];
  if (resource === "grupos") {
    const product = catalog.produtos.find((p) => p.id === record.produto_id);
    return [
      `${record.minimo} a ${record.maximo} opções`,
      product?.nome,
      product ? categories : links,
      status,
    ];
  }
  if (resource === "adicionais") {
    const group = catalog.grupos.find((g) => g.id === record.grupo_id);
    return [
      money(record.preco),
      group?.nome,
      record.herda_categorias ? "Herda os vínculos do grupo" : links,
      record.herda_categorias && categories,
      status,
    ];
  }
  return [status];
}

function resourceView(view, resource, options) {
  const { catalog, endpoint, action, refresh, notify } = options;
  const box = el("section", null, "box"),
    header = el("div", null, "box-header");
  header.append(
    el("h2", resources[resource].title),
    button("+ Adicionar", () => edit(resource, {}, options), "primary"),
  );
  box.append(header);
  if (!catalog[resource].length)
    box.append(
      el(
        "p",
        "Nenhum registro por enquanto. Use “Adicionar” para começar.",
        "empty",
      ),
    );
  for (const record of catalog[resource]) {
    const row = el("div", null, "record" + (record.ativo ? "" : " inactive")),
      info = el("div", null, "record-info"),
      copy = el("div"),
      actions = el("div", null, "record-actions");
    if (resource === "produtos")
      info.append(image(record.imagem_url, record.nome));
    copy.append(
      el("strong", record.nome),
      el(
        "p",
        description(resource, record, catalog).filter(Boolean).join(" · "),
      ),
    );
    info.append(copy);
    actions.append(button("Editar", () => edit(resource, record, options)));
    if (record.ativo)
      actions.append(
        button("Desativar", () =>
          action(async () => {
            if (
              !confirm(
                `Desativar “${record.nome}”? O histórico de pedidos será preservado.`,
              )
            )
              return;
            await api(`${endpoint}/${resource}/${record.id}`, {
              method: "DELETE",
            });
            await refresh();
            notify("Registro desativado.");
          }),
        ),
      );
    row.append(info, actions);
    box.append(row);
  }
  view.append(box);
}

export function renderCatalog(view, resource, options) {
  if (resource === "adicionais") resourceView(view, "grupos", options);
  resourceView(view, resource, options);
}
