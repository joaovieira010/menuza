function rejectCoupon(message, status = 400) {
  throw Object.assign(new Error(message), {
    status,
    publicCode: "cupom_invalido",
  });
}

const usage = `SELECT count(*)::int FROM pedidos
 WHERE estabelecimento_id=$1 AND cupom_id=$2 AND status <> 'cancelado'`;

async function listCoupons(db, storeId) {
  const { rows } = await db.query(
    `SELECT c.*, usos.quantidade AS usos,
       CASE WHEN c.fim_em <= statement_timestamp() THEN 'expirado'
            WHEN NOT c.ativo THEN 'inativo'
            WHEN c.inicio_em > statement_timestamp() THEN 'agendado'
            WHEN usos.quantidade >= c.limite_usos THEN 'esgotado'
            ELSE 'ativo' END AS status
     FROM cupons c
     CROSS JOIN LATERAL (SELECT count(*)::int AS quantidade FROM pedidos p
       WHERE p.estabelecimento_id=c.estabelecimento_id AND p.cupom_id=c.id AND p.status <> 'cancelado') usos
     WHERE c.estabelecimento_id=$1 AND c.excluido_em IS NULL ORDER BY c.id DESC`,
    [storeId],
  );
  return rows;
}

async function findCoupon(db, storeId, code, lock) {
  const {
    rows: [coupon],
  } = await db.query(
    `SELECT * FROM cupons WHERE estabelecimento_id=$1 AND codigo=$2 AND excluido_em IS NULL${lock ? " FOR UPDATE" : ""}`,
    [storeId, code],
  );
  if (!coupon) rejectCoupon("Cupom inexistente.");
  return coupon;
}

async function couponDiscount(db, coupon, subtotal, money) {
  // No checkout, a consulta ocorre após a trava do cupom e enxerga os pedidos já confirmados.
  const {
    rows: [result],
  } = await db.query(
    `SELECT statement_timestamp() AS agora, (${usage}) AS usos`,
    [coupon.estabelecimento_id, coupon.id],
  );
  if (!coupon.ativo) rejectCoupon("Este cupom está desativado.");
  if (result.agora >= coupon.fim_em) rejectCoupon("Este cupom expirou.");
  if (result.agora < coupon.inicio_em)
    rejectCoupon("Este cupom ainda não está disponível.");
  if (subtotal < coupon.pedido_minimo)
    rejectCoupon(
      `Pedido abaixo do mínimo de ${money(coupon.pedido_minimo)} em itens para este cupom.`,
    );
  if (coupon.limite_usos !== null && result.usos >= coupon.limite_usos)
    rejectCoupon("Limite de utilizações deste cupom atingido.", 409);
  const discount =
    coupon.tipo === "percentual"
      ? Math.round((subtotal * coupon.valor) / 10000)
      : coupon.valor;
  return Math.min(discount, subtotal);
}

module.exports = { listCoupons, findCoupon, couponDiscount };
