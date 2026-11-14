-- Amplia a lista de estados sem renomear ou modificar pedidos existentes.
ALTER TABLE pedidos DROP CONSTRAINT pedidos_status_check;
ALTER TABLE pedidos ADD CONSTRAINT pedidos_status_check
 CHECK(status IN ('pendente','confirmado','em_preparacao','pronto','saiu_para_entrega','concluido','cancelado'));
-- NULL identifica eventos antigos/checkout: não inventamos autores retroativamente.
ALTER TABLE historico_pedidos
 ADD COLUMN usuario_id bigint,
 ADD COLUMN usuario_email varchar(254),
 ADD COLUMN mensagem_whatsapp text,
 ADD COLUMN telefone_whatsapp varchar(13),
 ADD COLUMN whatsapp_aberto_em timestamptz,
 ADD CONSTRAINT historico_usuario_loja FOREIGN KEY(estabelecimento_id,usuario_id)
 REFERENCES usuarios(estabelecimento_id,id);
-- Mensagem, destinatário e solicitação de abertura são snapshots do evento.
-- whatsapp_aberto_em NÃO comprova envio nem entrega de mensagem.
