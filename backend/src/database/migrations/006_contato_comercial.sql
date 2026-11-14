-- Campos opcionais; mantém integralmente os contatos e observações existentes.
ALTER TABLE interesses_comerciais
 ADD COLUMN tipo_negocio varchar(120) NOT NULL DEFAULT '',
 ADD COLUMN cidade varchar(120) NOT NULL DEFAULT '';
