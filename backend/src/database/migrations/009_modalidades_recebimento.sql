-- Apenas estrutura: preserva os registros e habilita ambas as modalidades por padrão.
ALTER TABLE estabelecimentos
 ADD COLUMN entrega_ativa boolean NOT NULL DEFAULT true,
 ADD COLUMN retirada_ativa boolean NOT NULL DEFAULT true,
 ADD CONSTRAINT estabelecimento_modalidade_ativa CHECK (entrega_ativa OR retirada_ativa);
