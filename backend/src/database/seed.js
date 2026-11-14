const bcrypt = require("bcrypt");
const pool = require("./pool");
async function seed(db = pool, password = process.env.SEED_ADMIN_PASSWORD) {
  if (
    !password ||
    password.length < 12 ||
    Buffer.byteLength(password, "utf8") > 72
  )
    throw new Error(
      "Defina SEED_ADMIN_PASSWORD com pelo menos 12 caracteres e até 72 bytes.",
    );
  const hash = await bcrypt.hash(password, 12);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (const loja of [
      {
        nome: "Hamburguer Demo",
        slug: "hamburgueria-demo",
        email: "admin@hamburguer.demo",
        descricao:
          "Feito na chapa, com carinho. Escolha seu favorito e peça pelo WhatsApp.",
        taxa: 500,
        categorias: [
          [
            "Lanches",
            [
              [
                "Burger da casa",
                "Pão brioche, hambúrguer de 160g, queijo e molho da casa.",
                2890,
              ],
              [
                "Duplo queijo",
                "Dois hambúrgueres e uma generosa camada de queijo.",
                3690,
              ],
            ],
          ],
          [
            "Porções",
            [
              [
                "Batata crocante",
                "Batatas douradas e sequinhas, porção para compartilhar.",
                1800,
              ],
            ],
          ],
          [
            "Bebidas",
            [
              [
                "Suco natural",
                "Suco de laranja preparado na hora, 300 ml.",
                900,
              ],
              ["Refrigerante", "Lata gelada, 350 ml.", 650],
            ],
          ],
        ],
      },
      {
        nome: "Doces Demo",
        slug: "doces-demo",
        email: "admin@doces.demo",
        descricao: "Pequenas doçuras para deixar o seu dia mais leve.",
        taxa: 400,
        categorias: [
          [
            "Doces",
            [
              [
                "Brownie de chocolate",
                "Chocolate intenso, casquinha delicada e interior macio.",
                1200,
              ],
              [
                "Brigadeiro artesanal",
                "Brigadeiro cremoso com chocolate e granulado.",
                450,
              ],
            ],
          ],
          [
            "Saladas de fruta",
            [
              [
                "Salada de frutas",
                "Frutas frescas da estação, pote de 400 ml.",
                1600,
              ],
            ],
          ],
        ],
      },
    ]) {
      const exists = await client.query(
        "SELECT id FROM estabelecimentos WHERE slug=$1",
        [loja.slug],
      );
      if (exists.rowCount) continue; // O seed nunca apaga pedidos ou altera a senha de uma loja existente.
      const {
        rows: [s],
      } = await client.query(
        "INSERT INTO estabelecimentos(nome,slug,descricao,whatsapp,taxa_entrega,horarios) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
        [
          loja.nome,
          loja.slug,
          loja.descricao,
          "5511999999999",
          loja.taxa,
          "Todos os dias, das 18h às 23h (horário de Brasília)",
        ],
      );
      await client.query(
        "UPDATE estabelecimentos SET demonstracao=true,cor_principal='#7f3aed' WHERE id=$1",
        [s.id],
      );
      await client.query(
        "INSERT INTO assinaturas(estabelecimento_id,plano_id,valor,vencimento,status) SELECT $1,id,preco,(now() AT TIME ZONE 'America/Sao_Paulo')::date+14,'trialing' FROM planos WHERE nome='Básico'",
        [s.id],
      );
      await client.query(
        "INSERT INTO usuarios(estabelecimento_id,email,senha_hash) VALUES($1,$2,$3)",
        [s.id, loja.email, hash],
      );
      for (const [ordem, [nome, produtos]] of loja.categorias.entries()) {
        const {
          rows: [cat],
        } = await client.query(
          "INSERT INTO categorias(estabelecimento_id,nome,ordem) VALUES($1,$2,$3) RETURNING id",
          [s.id, nome, ordem],
        );
        for (const [pn, descricao, preco] of produtos)
          await client.query(
            "INSERT INTO produtos(estabelecimento_id,categoria_id,nome,descricao,preco) VALUES($1,$2,$3,$4,$5)",
            [s.id, cat.id, pn, descricao, preco],
          );
        if (ordem === 0) {
          const {
            rows: [g],
          } = await client.query(
            "INSERT INTO grupos_adicionais(estabelecimento_id,categoria_id,nome,maximo) VALUES($1,$2,$3,$4) RETURNING id",
            [s.id, cat.id, "Deixe do seu jeito", 2],
          );
          for (const [nome, preco] of loja.slug === "doces-demo"
            ? [
                ["Calda de chocolate", 300],
                ["Leite em pó", 200],
              ]
            : [
                ["Queijo extra", 400],
                ["Bacon", 600],
              ])
            await client.query(
              "INSERT INTO adicionais(estabelecimento_id,grupo_id,nome,preco) VALUES($1,$2,$3,$4)",
              [s.id, g.id, nome, preco],
            );
        }
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
if (require.main === module)
  seed()
    .then(() =>
      console.log("Seed concluído. A senha é SEED_ADMIN_PASSWORD do seu .env."),
    )
    .catch((e) => {
      console.error(
        e.message.includes("SEED_")
          ? e.message
          : "Falha no seed. Verifique a conexão e execute migrate primeiro.",
      );
      process.exitCode = 1;
    })
    .finally(() => pool.end());
module.exports = seed;
