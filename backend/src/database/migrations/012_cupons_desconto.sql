CREATE TABLE cupons (
 id bigserial PRIMARY KEY,
 estabelecimento_id bigint NOT NULL REFERENCES estabelecimentos(id),
 codigo varchar(40) NOT NULL CHECK(codigo ~ '^[A-Z0-9_-]{1,40}$'),
 tipo text NOT NULL CHECK(tipo IN ('percentual','fixo')),
 -- Valor fixo em centavos, percentual em centésimos de ponto percentual.
 valor integer NOT NULL CHECK(valor BETWEEN 1 AND 10000000 AND (tipo <> 'percentual' OR valor <= 10000)),
 pedido_minimo integer NOT NULL CHECK(pedido_minimo BETWEEN 0 AND 10000000),
 inicio_em timestamptz NOT NULL,
 fim_em timestamptz NOT NULL CHECK(fim_em > inicio_em),
 limite_usos integer CHECK(limite_usos > 0),
 ativo boolean NOT NULL DEFAULT true,
 excluido_em timestamptz,
 UNIQUE(estabelecimento_id,id)
);

CREATE UNIQUE INDEX cupons_loja_codigo ON cupons(estabelecimento_id,codigo) WHERE excluido_em IS NULL;

ALTER TABLE pedidos DROP CONSTRAINT pedidos_check;
ALTER TABLE pedidos
 ADD COLUMN cupom_id bigint,
 ADD COLUMN cupom_codigo varchar(40),
 ADD COLUMN total_original integer,
 ADD COLUMN desconto integer NOT NULL DEFAULT 0 CHECK(desconto BETWEEN 0 AND subtotal),
 ADD CONSTRAINT pedidos_cupom_loja FOREIGN KEY(estabelecimento_id,cupom_id) REFERENCES cupons(estabelecimento_id,id),
 ADD CONSTRAINT pedidos_cupom_snapshot_check CHECK(
  (cupom_id IS NULL AND cupom_codigo IS NULL AND total_original IS NULL AND desconto = 0)
  OR
  (cupom_id IS NOT NULL AND cupom_codigo IS NOT NULL AND cupom_codigo ~ '^[A-Z0-9_-]{1,40}$'
   AND total_original IS NOT NULL AND total_original = subtotal + taxa_entrega)
 ),
 ADD CONSTRAINT pedidos_total_check CHECK(total = subtotal + taxa_entrega - desconto);

CREATE INDEX pedidos_cupom_utilizacoes ON pedidos(estabelecimento_id,cupom_id)
 WHERE cupom_id IS NOT NULL AND status <> 'cancelado';
