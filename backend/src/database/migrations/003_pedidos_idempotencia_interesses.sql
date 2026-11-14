ALTER TABLE pedidos ADD COLUMN idempotencia uuid, ADD COLUMN requisicao_hash text, ADD COLUMN resposta jsonb;
CREATE UNIQUE INDEX pedidos_idempotencia ON pedidos(estabelecimento_id,idempotencia) WHERE idempotencia IS NOT NULL;
CREATE TABLE interesses_comerciais (
 id bigserial PRIMARY KEY, nome varchar(120) NOT NULL, estabelecimento varchar(120) NOT NULL,
 email varchar(254) NOT NULL, telefone varchar(30) NOT NULL, mensagem varchar(1000) NOT NULL DEFAULT '',
 atendido boolean NOT NULL DEFAULT false, criado_em timestamptz NOT NULL DEFAULT now()
);
