-- A categoria principal continua válida para cadastros e integrações existentes.
ALTER TABLE produtos ALTER COLUMN categoria_id DROP NOT NULL;
-- O vínculo com um produto específico pode coexistir com os das categorias.
ALTER TABLE grupos_adicionais DROP CONSTRAINT grupos_adicionais_check1;

CREATE TABLE produtos_categorias (
 estabelecimento_id bigint NOT NULL,
 registro_id bigint NOT NULL,
 categoria_id bigint NOT NULL,
 PRIMARY KEY(estabelecimento_id,registro_id,categoria_id),
 FOREIGN KEY(estabelecimento_id,registro_id) REFERENCES produtos(estabelecimento_id,id) ON DELETE CASCADE,
 FOREIGN KEY(estabelecimento_id,categoria_id) REFERENCES categorias(estabelecimento_id,id)
);
CREATE TABLE grupos_categorias (
 estabelecimento_id bigint NOT NULL,
 registro_id bigint NOT NULL,
 categoria_id bigint NOT NULL,
 PRIMARY KEY(estabelecimento_id,registro_id,categoria_id),
 FOREIGN KEY(estabelecimento_id,registro_id) REFERENCES grupos_adicionais(estabelecimento_id,id) ON DELETE CASCADE,
 FOREIGN KEY(estabelecimento_id,categoria_id) REFERENCES categorias(estabelecimento_id,id)
);
CREATE TABLE adicionais_categorias (
 estabelecimento_id bigint NOT NULL,
 registro_id bigint NOT NULL,
 categoria_id bigint NOT NULL,
 PRIMARY KEY(estabelecimento_id,registro_id,categoria_id),
 FOREIGN KEY(estabelecimento_id,registro_id) REFERENCES adicionais(estabelecimento_id,id) ON DELETE CASCADE,
 FOREIGN KEY(estabelecimento_id,categoria_id) REFERENCES categorias(estabelecimento_id,id)
);
ALTER TABLE adicionais ADD COLUMN herda_categorias boolean NOT NULL DEFAULT true;
