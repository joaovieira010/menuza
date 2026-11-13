# API REST

Todas as respostas de erro têm `{ "erro": "mensagem" }`. Entradas inválidas retornam 400; credenciais/sessão inválidas, 401; origem recusada, 403; recurso ausente, 404; limite de tentativas, 429. Erros inesperados retornam mensagem genérica e 500. Campos desconhecidos do JSON são descartados.

## Público

`GET /api/:slug/cardapio` retorna `{loja,categorias,produtos}`. Cada produto inclui `grupos`, cada grupo inclui `adicionais`. Somente itens ativos e de categorias ativas aparecem. IDs são strings no JSON; preços são centavos inteiros.

`POST /api/:slug/pedidos` recebe:

```json
{
  "cliente": { "nome": "Maria", "telefone": "11999999999" },
  "modalidade": "entrega",
  "forma_pagamento": "dinheiro",
  "troco_para": 10000,
  "endereco": {
    "rua": "Rua Exemplo",
    "numero": "10",
    "bairro": "Centro",
    "complemento": "Casa",
    "referencia": "Portão azul"
  },
  "observacoes": "Tocar a campainha",
  "itens": [
    {
      "produto_id": 1,
      "quantidade": 2,
      "adicionais": [1],
      "observacao": "Sem cebola"
    }
  ]
}
```

Use IDs reais do cardápio daquela loja; os números do exemplo são ilustrativos. `troco_para` é centavos ou `null`, só para dinheiro. Em retirada, endereço pode ser omitido. Formas: `dinheiro`, `pix`, `cartao`. A API não cobra o pagamento. Telefones aceitam DDD com número fixo ou móvel brasileiro, com ou sem `55`, espaços, parênteses ou hífen; são normalizados para dígitos com país.

Limites: 50 linhas de itens, quantidade de 1 a 99 em cada linha, até 40 IDs de adicionais por item, sem repetição. Observação por item até 500 caracteres; geral até 1000; nome até 120. O backend ignora `preco`, `total`, taxa e qualquer valor de produto que o cliente envie.

Sucesso 201:

```json
{
  "id": "42",
  "numero": "125",
  "total": 7080,
  "mensagem": "NOVO PEDIDO — ...",
  "whatsapp_url": "https://wa.me/55...?text=..."
}
```

Não há rota pública para consultar pedidos ou dados de clientes.

## Painel

Exceto login, todas as rotas abaixo exigem cookie `menuza`. Nunca é necessário enviar `estabelecimento_id`: o servidor determina a loja.

| Método | Rota                            | Conteúdo                                                            |
| ------ | ------------------------------- | ------------------------------------------------------------------- |
| POST   | `/api/admin/login`              | `{email,senha}`; retorna cookie                                     |
| POST   | `/api/admin/logout`             | Remove cookie                                                       |
| GET    | `/api/admin/me`                 | Usuário autenticado, sem hash                                       |
| GET    | `/api/admin/catalogo`           | Loja, categorias, produtos, grupos e adicionais, incluindo inativos |
| GET    | `/api/admin/dashboard`          | `pedidos`, `faturamento` e `mais_vendidos` do dia                   |
| GET    | `/api/admin/pedidos`            | Até 200 pedidos, itens, adicionais e histórico                      |
| PATCH  | `/api/admin/pedidos/:id/status` | `{status}`                                                          |
| PUT    | `/api/admin/configuracoes`      | Configurações completas da loja                                     |
| POST   | `/api/admin/upload`             | Multipart com arquivo `imagem`; retorna `{url}`                     |
| POST   | `/api/admin/:recurso`           | Cria cadastro                                                       |
| PUT    | `/api/admin/:recurso/:id`       | Atualiza cadastro completo                                          |
| DELETE | `/api/admin/:recurso/:id`       | Desativa cadastro                                                   |

Recursos aceitos: `categorias`, `produtos`, `grupos`, `adicionais`.

| Recurso       | Campos                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------- |
| categorias    | `nome`, `ordem` inteiro, `ativo` booleano                                                          |
| produtos      | `nome`, `categoria_id`, `descricao`, `preco` em centavos, `ativo`, `imagem_url`                    |
| grupos        | `nome`, `produto_id` ou `categoria_id` (outro `null`), `minimo`, `maximo`, `ativo`                 |
| adicionais    | `nome`, `grupo_id`, `preco` em centavos, `ativo`                                                   |
| configurações | `nome`, `descricao`, `logo_url`, `whatsapp`, `taxa_entrega`, `aberto`, `horarios`, `cor_principal` |

Imagens são URLs locais retornadas pelo upload (ou string vazia). Não aceitamos URLs arbitrárias em configurações/produtos. `cor_principal` deve ser `#RRGGBB`.

### Filtros e status

Pedidos aceitam `inicio=YYYY-MM-DD`, `fim=YYYY-MM-DD` e `status`. Datas incluem o dia inteiro no horário de Brasília. A ordenação é da criação mais recente para a mais antiga.

Fluxo de entrega: `pendente → confirmado → em_preparacao → saiu_para_entrega → concluido`. Retirada: `pendente → confirmado → em_preparacao → concluido`. Qualquer status não final pode ir para `cancelado`. Cancelado e concluído são finais.

`GET /health` retorna `{status:"ok"}` quando o banco responde; caso contrário, 503.
