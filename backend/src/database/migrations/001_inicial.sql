CREATE TABLE estabelecimentos (
 id bigserial PRIMARY KEY, nome varchar(120) NOT NULL, slug varchar(80) NOT NULL UNIQUE,
 logo_url varchar(500) NOT NULL DEFAULT '', descricao varchar(1000) NOT NULL DEFAULT '',
 whatsapp varchar(13) NOT NULL, taxa_entrega integer NOT NULL DEFAULT 0 CHECK(taxa_entrega >= 0),
 aberto boolean NOT NULL DEFAULT true, horarios varchar(1000) NOT NULL DEFAULT '',
 cor_principal varchar(7) NOT NULL DEFAULT '#C2410C', proximo_numero bigint NOT NULL DEFAULT 1,
 criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE usuarios (
 id bigserial PRIMARY KEY, estabelecimento_id bigint NOT NULL REFERENCES estabelecimentos(id),
 email varchar(254) NOT NULL UNIQUE, senha_hash text NOT NULL,
 UNIQUE(estabelecimento_id,id)
);
CREATE TABLE categorias (
 id bigserial PRIMARY KEY, estabelecimento_id bigint NOT NULL REFERENCES estabelecimentos(id),
 nome varchar(120) NOT NULL, ordem integer NOT NULL DEFAULT 0, ativo boolean NOT NULL DEFAULT true,
 UNIQUE(estabelecimento_id,id)
);
CREATE TABLE produtos (
 id bigserial PRIMARY KEY, estabelecimento_id bigint NOT NULL REFERENCES estabelecimentos(id), categoria_id bigint NOT NULL,
 nome varchar(120) NOT NULL, descricao varchar(1000) NOT NULL DEFAULT '', preco integer NOT NULL CHECK(preco >= 0),
 ativo boolean NOT NULL DEFAULT true, imagem_url varchar(500) NOT NULL DEFAULT '',
 UNIQUE(estabelecimento_id,id), FOREIGN KEY(estabelecimento_id,categoria_id) REFERENCES categorias(estabelecimento_id,id)
);
CREATE TABLE grupos_adicionais (
 id bigserial PRIMARY KEY, estabelecimento_id bigint NOT NULL REFERENCES estabelecimentos(id),
 produto_id bigint, categoria_id bigint, nome varchar(120) NOT NULL,
 minimo integer NOT NULL DEFAULT 0 CHECK(minimo >= 0), maximo integer NOT NULL DEFAULT 5 CHECK(maximo >= minimo AND maximo <= 20),
 ativo boolean NOT NULL DEFAULT true, CHECK(num_nonnulls(produto_id,categoria_id)=1),
 UNIQUE(estabelecimento_id,id),
 FOREIGN KEY(estabelecimento_id,produto_id) REFERENCES produtos(estabelecimento_id,id),
 FOREIGN KEY(estabelecimento_id,categoria_id) REFERENCES categorias(estabelecimento_id,id)
);
CREATE TABLE adicionais (
 id bigserial PRIMARY KEY, estabelecimento_id bigint NOT NULL REFERENCES estabelecimentos(id), grupo_id bigint NOT NULL,
 nome varchar(120) NOT NULL, preco integer NOT NULL CHECK(preco >= 0), ativo boolean NOT NULL DEFAULT true,
 UNIQUE(estabelecimento_id,id), FOREIGN KEY(estabelecimento_id,grupo_id) REFERENCES grupos_adicionais(estabelecimento_id,id)
);
CREATE TABLE clientes (
 id bigserial PRIMARY KEY, estabelecimento_id bigint NOT NULL REFERENCES estabelecimentos(id),
 nome varchar(120) NOT NULL, telefone varchar(13) NOT NULL, UNIQUE(estabelecimento_id,telefone), UNIQUE(estabelecimento_id,id)
);
CREATE TABLE pedidos (
 id bigserial PRIMARY KEY, estabelecimento_id bigint NOT NULL REFERENCES estabelecimentos(id), cliente_id bigint NOT NULL,
 numero bigint NOT NULL, status varchar(30) NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','confirmado','em_preparacao','saiu_para_entrega','concluido','cancelado')),
 modalidade varchar(10) NOT NULL CHECK(modalidade IN ('entrega','retirada')),
 forma_pagamento varchar(15) NOT NULL CHECK(forma_pagamento IN ('dinheiro','pix','cartao')),
 troco_para integer CHECK(troco_para >= 0), subtotal integer NOT NULL CHECK(subtotal >= 0),
 taxa_entrega integer NOT NULL CHECK(taxa_entrega >= 0), total integer NOT NULL CHECK(total = subtotal + taxa_entrega),
 cliente_nome varchar(120) NOT NULL, cliente_telefone varchar(13) NOT NULL,
 observacoes varchar(1000) NOT NULL DEFAULT '', rua varchar(150) NOT NULL DEFAULT '', numero_endereco varchar(20) NOT NULL DEFAULT '',
 bairro varchar(100) NOT NULL DEFAULT '', complemento varchar(150) NOT NULL DEFAULT '', referencia varchar(150) NOT NULL DEFAULT '',
 criado_em timestamptz NOT NULL DEFAULT now(), atualizado_em timestamptz NOT NULL DEFAULT now(),
 UNIQUE(estabelecimento_id,id), UNIQUE(estabelecimento_id,numero),
 FOREIGN KEY(estabelecimento_id,cliente_id) REFERENCES clientes(estabelecimento_id,id)
);
CREATE TABLE itens_pedido (
 id bigserial PRIMARY KEY, estabelecimento_id bigint NOT NULL REFERENCES estabelecimentos(id), pedido_id bigint NOT NULL,
 produto_id bigint NOT NULL, nome varchar(120) NOT NULL, preco integer NOT NULL CHECK(preco >= 0),
 quantidade integer NOT NULL CHECK(quantidade BETWEEN 1 AND 99), observacao varchar(500) NOT NULL DEFAULT '',
 UNIQUE(estabelecimento_id,id), FOREIGN KEY(estabelecimento_id,pedido_id) REFERENCES pedidos(estabelecimento_id,id),
 FOREIGN KEY(estabelecimento_id,produto_id) REFERENCES produtos(estabelecimento_id,id)
);
CREATE TABLE itens_pedido_adicionais (
 id bigserial PRIMARY KEY, estabelecimento_id bigint NOT NULL REFERENCES estabelecimentos(id), item_pedido_id bigint NOT NULL,
 adicional_id bigint NOT NULL, nome varchar(120) NOT NULL, preco integer NOT NULL CHECK(preco >= 0),
 FOREIGN KEY(estabelecimento_id,item_pedido_id) REFERENCES itens_pedido(estabelecimento_id,id),
 FOREIGN KEY(estabelecimento_id,adicional_id) REFERENCES adicionais(estabelecimento_id,id)
);
CREATE TABLE historico_pedidos (
 id bigserial PRIMARY KEY, estabelecimento_id bigint NOT NULL REFERENCES estabelecimentos(id), pedido_id bigint NOT NULL,
 status varchar(30) NOT NULL, criado_em timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(estabelecimento_id,pedido_id) REFERENCES pedidos(estabelecimento_id,id)
);
CREATE INDEX categorias_loja ON categorias(estabelecimento_id,ordem);
CREATE INDEX produtos_loja_categoria ON produtos(estabelecimento_id,categoria_id);
CREATE INDEX grupos_loja ON grupos_adicionais(estabelecimento_id,produto_id,categoria_id);
CREATE INDEX adicionais_loja_grupo ON adicionais(estabelecimento_id,grupo_id);
CREATE INDEX pedidos_loja_data ON pedidos(estabelecimento_id,criado_em DESC);
CREATE INDEX pedidos_loja_status ON pedidos(estabelecimento_id,status);
CREATE INDEX itens_loja_pedido ON itens_pedido(estabelecimento_id,pedido_id);
CREATE INDEX extras_loja_item ON itens_pedido_adicionais(estabelecimento_id,item_pedido_id);
CREATE INDEX historico_loja_pedido ON historico_pedidos(estabelecimento_id,pedido_id);
