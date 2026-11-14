-- Extensão aditiva: não apaga pedidos, usuários nem catálogos existentes.
ALTER TABLE estabelecimentos ADD COLUMN responsavel varchar(120) NOT NULL DEFAULT '',
 ADD COLUMN email varchar(254) NOT NULL DEFAULT '', ADD COLUMN telefone varchar(13) NOT NULL DEFAULT '',
 ADD COLUMN situacao text NOT NULL DEFAULT 'active' CHECK(situacao IN ('active','suspended','archived')),
 ADD COLUMN banner_url varchar(500) NOT NULL DEFAULT '';
ALTER TABLE estabelecimentos ADD CONSTRAINT slug_formato CHECK(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND slug NOT IN ('api','admin','superadmin','assets','uploads','health','favicon','robots','contratar'));
ALTER TABLE usuarios ALTER COLUMN estabelecimento_id DROP NOT NULL;
ALTER TABLE usuarios ADD COLUMN papel text NOT NULL DEFAULT 'STORE_ADMIN' CHECK(papel IN ('SUPERADMIN','STORE_ADMIN')),
 ADD COLUMN ativo boolean NOT NULL DEFAULT true;
ALTER TABLE usuarios ADD CONSTRAINT usuario_papel_loja CHECK ((papel='SUPERADMIN' AND estabelecimento_id IS NULL) OR (papel='STORE_ADMIN' AND estabelecimento_id IS NOT NULL));
CREATE TABLE sessoes (
 id uuid PRIMARY KEY, usuario_id bigint NOT NULL REFERENCES usuarios(id), expira_em timestamptz NOT NULL,
 criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessoes_usuario ON sessoes(usuario_id);
CREATE TABLE planos (
 id bigserial PRIMARY KEY, nome varchar(120) NOT NULL UNIQUE, preco integer NOT NULL CHECK(preco>=0),
 limite_produtos integer CHECK(limite_produtos>0), limite_pedidos_mes integer CHECK(limite_pedidos_mes>0),
 adicionais boolean NOT NULL DEFAULT true, personalizacao boolean NOT NULL DEFAULT true, ativo boolean NOT NULL DEFAULT true
);
INSERT INTO planos(nome,preco) VALUES ('Básico',4990),('Profissional',7990),('Completo',11990);
CREATE TABLE politica_cobranca (
 id integer PRIMARY KEY CHECK(id=1), lembrete_dias integer NOT NULL DEFAULT 3 CHECK(lembrete_dias>=0),
 suspender_dias integer NOT NULL DEFAULT 7 CHECK(suspender_dias>=lembrete_dias),
 suspender_automaticamente boolean NOT NULL DEFAULT true, reativar_automaticamente boolean NOT NULL DEFAULT true
);
INSERT INTO politica_cobranca(id) VALUES(1);
CREATE TABLE assinaturas (
 estabelecimento_id bigint PRIMARY KEY REFERENCES estabelecimentos(id), plano_id bigint NOT NULL REFERENCES planos(id),
 valor integer NOT NULL CHECK(valor>=0), vencimento date NOT NULL,
 status text NOT NULL CHECK(status IN ('trialing','active','pending','past_due','suspended','canceled')),
 contratado_em timestamptz NOT NULL DEFAULT now(), ultimo_pagamento date, suspensao_manual boolean NOT NULL DEFAULT false
);
-- Migração dos clientes já existentes: período de avaliação explícito de 14 dias, sem pagamentos inventados.
INSERT INTO assinaturas(estabelecimento_id,plano_id,valor,vencimento,status)
 SELECT id,(SELECT id FROM planos WHERE nome='Básico'),4990,(now() AT TIME ZONE 'America/Sao_Paulo')::date+14,'trialing' FROM estabelecimentos;
CREATE TABLE pagamentos (
 id bigserial PRIMARY KEY, estabelecimento_id bigint NOT NULL REFERENCES assinaturas(estabelecimento_id),
 valor integer NOT NULL CHECK(valor>0), pago_em date NOT NULL, referencia varchar(120) NOT NULL,
 observacao varchar(1000) NOT NULL DEFAULT '', registrado_por bigint NOT NULL REFERENCES usuarios(id),
 proximo_vencimento date NOT NULL, criado_em timestamptz NOT NULL DEFAULT now(),
 UNIQUE(estabelecimento_id,referencia)
);
CREATE INDEX pagamentos_data ON pagamentos(pago_em);
CREATE TABLE auditoria_plataforma (
 id bigserial PRIMARY KEY, estabelecimento_id bigint REFERENCES estabelecimentos(id), usuario_id bigint REFERENCES usuarios(id),
 acao text NOT NULL, detalhes jsonb NOT NULL DEFAULT '{}', criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auditoria_loja ON auditoria_plataforma(estabelecimento_id,criado_em DESC);
CREATE TABLE execucoes_cobranca (
 id bigserial PRIMARY KEY, iniciado_em timestamptz NOT NULL DEFAULT now(), concluido_em timestamptz,
 alteradas integer NOT NULL DEFAULT 0, erro text
);
CREATE TABLE lembretes_cobranca (
 id bigserial PRIMARY KEY, estabelecimento_id bigint NOT NULL REFERENCES assinaturas(estabelecimento_id), vencimento date NOT NULL,
 criado_em timestamptz NOT NULL DEFAULT now(), enviado_em timestamptz, tentativas integer NOT NULL DEFAULT 0,
 proxima_tentativa timestamptz NOT NULL DEFAULT now(), ultimo_erro text,
 UNIQUE(estabelecimento_id,vencimento)
);
CREATE INDEX assinaturas_vencimento ON assinaturas(vencimento);
-- Serializa cadastros concorrentes para que o limite contratado não possa ser ultrapassado.
CREATE FUNCTION verificar_limite_produtos() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE limite integer; quantidade integer;
BEGIN
 IF NEW.ativo THEN
  PERFORM id FROM estabelecimentos WHERE id=NEW.estabelecimento_id FOR UPDATE;
  SELECT p.limite_produtos INTO limite FROM assinaturas a JOIN planos p ON p.id=a.plano_id WHERE a.estabelecimento_id=NEW.estabelecimento_id;
  IF limite IS NOT NULL THEN
   SELECT count(*) INTO quantidade FROM produtos WHERE estabelecimento_id=NEW.estabelecimento_id AND ativo AND id<>NEW.id;
   IF quantidade>=limite THEN RAISE EXCEPTION 'Limite de produtos atingido' USING ERRCODE='P0001'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER produtos_limite BEFORE INSERT OR UPDATE ON produtos FOR EACH ROW EXECUTE PROCEDURE verificar_limite_produtos();
