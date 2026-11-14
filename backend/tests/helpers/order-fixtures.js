// Fixtures exclusivas do banco descartável da suíte, sem chamar seeds da aplicação.
module.exports = async function orderFixtures(db, password) {
  const bcrypt = require("bcrypt");
  const hash = await bcrypt.hash(password, 12);
  for (const [nome, slug, email, phone, price] of [
    [
      "Hamburguer Demo",
      "hamburgueria-demo",
      "admin@hamburguer.demo",
      "5511999999999",
      2890,
    ],
    ["Doces Demo", "doces-demo", "admin@doces.demo", "5521988887777", 1200],
  ]) {
    const {
      rows: [store],
    } = await db.query(
      "INSERT INTO estabelecimentos(nome,slug,whatsapp,taxa_entrega,aberto) VALUES($1,$2,$3,500,true) RETURNING id",
      [nome, slug, phone],
    );
    await db.query(
      "INSERT INTO usuarios(estabelecimento_id,email,senha_hash) VALUES($1,$2,$3)",
      [store.id, email, hash],
    );
    await db.query(
      "INSERT INTO assinaturas(estabelecimento_id,plano_id,valor,vencimento,status) SELECT $1,id,preco,current_date+30,'active' FROM planos WHERE nome='Básico'",
      [store.id],
    );
    const {
      rows: [category],
    } = await db.query(
      "INSERT INTO categorias(estabelecimento_id,nome) VALUES($1,'Categoria QA') RETURNING id",
      [store.id],
    );
    await db.query(
      "INSERT INTO produtos(estabelecimento_id,categoria_id,nome,preco) VALUES($1,$2,'Aprox: 250 ml', $3)",
      [store.id, category.id, price],
    );
    const {
      rows: [group],
    } = await db.query(
      "INSERT INTO grupos_adicionais(estabelecimento_id,categoria_id,nome,maximo) VALUES($1,$2,'Sabores e complementos',2) RETURNING id",
      [store.id, category.id],
    );
    await db.query(
      "INSERT INTO adicionais(estabelecimento_id,grupo_id,nome,preco) VALUES($1,$2,'Creme de Maracujá',400),($1,$2,'Laranja',0)",
      [store.id, group.id],
    );
  }
};
