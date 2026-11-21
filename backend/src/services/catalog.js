const linkedCategories = (table) => `ARRAY(
  SELECT categoria_id FROM ${table} WHERE estabelecimento_id=r.estabelecimento_id
    AND registro_id=r.id ORDER BY categoria_id
)`;

function categoryIds(record, links = []) {
  if (record.herda_categorias && !links.length) return null;
  return [...new Set([record.categoria_id, ...links].filter(Boolean))];
}

function groupsForCategory(groups, product, categoryId) {
  const applicable = [];
  for (const group of groups) {
    const groupApplies =
      group.produto_id === product.id ||
      group.categoria_ids.includes(categoryId);
    const options = group.adicionais.filter(
      (extra) =>
        (extra.herda_categorias && groupApplies) ||
        extra.categoria_ids?.includes(categoryId),
    );
    if (groupApplies || options.length)
      applicable.push({
        ...group,
        minimo: groupApplies ? group.minimo : 0,
        adicionais: options,
      });
  }
  return applicable;
}

async function catalog(db, loja, admin = false) {
  const tid = loja.id;
  let extrasEnabled = true;
  if (!admin) {
    const {
      rows: [plan],
    } = await db.query(
      "SELECT p.adicionais FROM assinaturas a JOIN planos p ON p.id=a.plano_id WHERE a.estabelecimento_id=$1",
      [tid],
    );
    extrasEnabled = plan?.adicionais ?? false;
  }
  const { rows: categorias } = await db.query(
    `SELECT * FROM categorias WHERE estabelecimento_id=$1 ${admin ? "" : "AND ativo=true"} ORDER BY ordem,id`,
    [tid],
  );
  const { rows: productRows } = await db.query(
    `SELECT r.*, ${linkedCategories("produtos_categorias")} AS categoria_ids
     FROM produtos r WHERE estabelecimento_id=$1 ${admin ? "" : "AND ativo=true"} ORDER BY id`,
    [tid],
  );
  const { rows: grupos } = await db.query(
    `SELECT r.*, ${linkedCategories("grupos_categorias")} AS categoria_ids
     FROM grupos_adicionais r WHERE estabelecimento_id=$1 ${admin ? "" : "AND ativo=true"} ORDER BY id`,
    [tid],
  );
  const { rows: adicionais } = await db.query(
    `SELECT r.*, ${linkedCategories("adicionais_categorias")} AS categoria_ids
     FROM adicionais r WHERE estabelecimento_id=$1 ${admin ? "" : "AND ativo=true"} ORDER BY id`,
    [tid],
  );
  for (const extra of adicionais)
    extra.categoria_ids = categoryIds(extra, extra.categoria_ids);
  for (const g of grupos) {
    g.categoria_ids = categoryIds(g, g.categoria_ids);
    g.adicionais = adicionais.filter((a) => a.grupo_id === g.id);
  }
  const visibleCategories = new Set(categorias.map((c) => c.id));
  const availableGroups = extrasEnabled ? grupos : [];
  const produtos = productRows.filter((p) => {
    p.categoria_ids = categoryIds(p, p.categoria_ids).filter((categoryId) =>
      visibleCategories.has(categoryId),
    );
    p.categoria_id = p.categoria_ids[0] ?? null;
    if (!admin && !p.categoria_id) return false;
    p.grupos = p.categoria_id
      ? groupsForCategory(availableGroups, p, p.categoria_id)
      : [];
    if (!admin && p.categoria_ids.length > 1)
      p.grupos_por_categoria = Object.fromEntries(
        p.categoria_ids
          .slice(1)
          .map((categoryId) => [
            categoryId,
            groupsForCategory(availableGroups, p, categoryId),
          ]),
      );
    return true;
  });
  // O contador é interno e nunca deve ser enviado ao cliente.
  const fields = [
    "id",
    "nome",
    "slug",
    "logo_url",
    "banner_url",
    "descricao",
    "whatsapp",
    "taxa_entrega",
    "aberto",
    "horarios",
    "cor_principal",
  ];
  const publicLoja = Object.fromEntries(fields.map((k) => [k, loja[k]]));
  return {
    loja: {
      ...publicLoja,
      entrega_ativa: loja.entrega_ativa ?? true,
      retirada_ativa: loja.retirada_ativa ?? true,
    },
    categorias,
    produtos,
    ...(admin ? { grupos, adicionais } : {}),
  };
}
module.exports = catalog;
module.exports.categoryIds = categoryIds;
