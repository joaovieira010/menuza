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
  const { rows: produtos } = await db.query(
    `SELECT p.* FROM produtos p JOIN categorias c ON c.id=p.categoria_id AND c.estabelecimento_id=p.estabelecimento_id WHERE p.estabelecimento_id=$1 ${admin ? "" : "AND p.ativo=true AND c.ativo=true"} ORDER BY p.id`,
    [tid],
  );
  const { rows: grupos } = await db.query(
    `SELECT * FROM grupos_adicionais WHERE estabelecimento_id=$1 ${admin ? "" : "AND ativo=true"} ORDER BY id`,
    [tid],
  );
  const { rows: adicionais } = await db.query(
    `SELECT * FROM adicionais WHERE estabelecimento_id=$1 ${admin ? "" : "AND ativo=true"} ORDER BY id`,
    [tid],
  );
  for (const g of grupos)
    g.adicionais = adicionais.filter((a) => a.grupo_id === g.id);
  for (const p of produtos)
    p.grupos = (extrasEnabled ? grupos : []).filter(
      (g) => g.produto_id === p.id || g.categoria_id === p.categoria_id,
    );
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
