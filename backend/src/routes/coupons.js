const router = require("express").Router();
const pool = require("../database/pool");
const { parse, schemas, id } = require("../middlewares/validation");
const { fail } = require("../services/orders");
const { listCoupons } = require("../services/coupons");

router.get("/", async (req, res) => {
  res.json(await listCoupons(pool, req.user.estabelecimento_id));
});

async function save(req, res) {
  const storeId = req.user.estabelecimento_id;
  const data = parse(schemas.coupon, req.body);
  const values = [
    storeId,
    data.codigo,
    data.tipo,
    data.valor,
    data.pedido_minimo,
    data.inicio_em,
    data.fim_em,
    data.limite_usos,
    data.ativo,
  ];
  const editing = req.params.id !== undefined;
  try {
    const {
      rows: [coupon],
    } = editing
      ? await pool.query(
          `UPDATE cupons SET (codigo,tipo,valor,pedido_minimo,inicio_em,fim_em,limite_usos,ativo)=($2,$3,$4,$5,$6,$7,$8,$9)
         WHERE estabelecimento_id=$1 AND id=$10 AND excluido_em IS NULL RETURNING *`,
          [...values, parse(id, req.params.id)],
        )
      : await pool.query(
          `INSERT INTO cupons(estabelecimento_id,codigo,tipo,valor,pedido_minimo,inicio_em,fim_em,limite_usos,ativo)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          values,
        );
    if (!coupon) fail("Cupom não encontrado.", 404);
    res.status(editing ? 200 : 201).json(coupon);
  } catch (error) {
    if (error.code === "23505" && error.constraint === "cupons_loja_codigo")
      fail("Já existe um cupom com este código nesta loja.", 409);
    throw error;
  }
}

router.post("/", save);
router.put("/:id", save);
router.patch("/:id", async (req, res) => {
  const { ativo } = parse(schemas.activeCoupon, req.body);
  const { rowCount } = await pool.query(
    "UPDATE cupons SET ativo=$3 WHERE estabelecimento_id=$1 AND id=$2 AND excluido_em IS NULL",
    [req.user.estabelecimento_id, parse(id, req.params.id), ativo],
  );
  if (!rowCount) fail("Cupom não encontrado.", 404);
  res.json({ ok: true });
});
router.delete("/:id", async (req, res) => {
  const { rowCount } = await pool.query(
    "UPDATE cupons SET ativo=false,excluido_em=clock_timestamp() WHERE estabelecimento_id=$1 AND id=$2 AND excluido_em IS NULL",
    [req.user.estabelecimento_id, parse(id, req.params.id)],
  );
  if (!rowCount) fail("Cupom não encontrado.", 404);
  res.json({ ok: true });
});
module.exports = router;
