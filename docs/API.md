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
  "mensagem": "🔔 PEDIDO CONFIRMADO #000125\n...",
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

Fluxo de entrega: `pendente → confirmado → em_preparacao → pronto → saiu_para_entrega → concluido`. Retirada: `pendente → confirmado → em_preparacao → pronto → concluido`. Qualquer status não final pode ir para `cancelado`. Cancelado e concluído são finais.

`GET /health` retorna `{status:"ok"}` quando o banco responde; caso contrário, 503.

## Extensão SaaS 1.0

Respostas 409 indicam conflito (slug/e-mail/referência repetida, limite de plano ou divergência de idempotência); 423 indica estabelecimento temporariamente indisponível. APIs usam `Cache-Control: no-store`. Mutações de navegador devem vir da origem configurada. Valores financeiros continuam sendo centavos inteiros.

`POST /api/:slug/pedidos` aceita também `idempotencia` UUID opcional. Mesmo UUID e corpo normalizado retornam a mesma resposta persistida; corpo diferente retorna 409. O frontend sempre envia essa chave e a mantém para repetir depois de falha de rede. Resposta WhatsApp inclui subtotal. `banner_url` foi acrescentado às configurações e à loja pública.

`GET /api/admin/assinatura` retorna a assinatura da própria loja, plano, limites e estado efetivo. `/me`, `/assinatura` e `/logout` exigem sessão, mas podem ser consultados sem operação de catálogo. Demais endpoints administrativos e o login da loja verificam bloqueio por assinatura/situação. Login de loja nunca autentica superadmin.

### Público comercial

- `GET /api/public/planos`: planos ativos e seus preços/limites/recursos.
- `POST /api/public/contato`: `{nome,estabelecimento,email,telefone,mensagem,consentimento:true}`; grava interessado, retorna 201; não envia comunicação automática.

### Superadmin

Cookie exclusivo `menuza_platform`, sessão persistida e papel SUPERADMIN obrigatório. Cookie da loja não autoriza esta API. Rotas abaixo usam prefixo `/api/superadmin`:

| Método   | Rota                      | Ação                                                                                                                          |
| -------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| POST     | `/login`                  | `{email,senha}`, limitado por tentativas                                                                                      |
| POST     | `/logout`                 | Revoga a sessão no banco e limpa cookie                                                                                       |
| GET      | `/me`                     | Identidade global sem hash                                                                                                    |
| GET      | `/dashboard`              | Total, ativos, suspensos, atrasos, MRR contratada, recebimentos do mês, novos clientes, próximos vencimentos; demos excluídos |
| GET      | `/lojas?busca=&situacao=` | Lista até 500, situação active/suspended/archived; suspended inclui bloqueio efetivo                                          |
| POST     | `/lojas`                  | Cria tenant + administrador + contrato + auditoria em transação                                                               |
| PUT      | `/lojas/:id`              | Edita informações e contrato, senha opcional                                                                                  |
| POST     | `/lojas/:id/situacao`     | `{acao,observacao}`, ação suspender/reativar/arquivar/cancelar                                                                |
| GET      | `/lojas/:id/historico`    | `{assinatura,pagamentos,historico}`; últimas 200 entradas de cada histórico                                                   |
| POST     | `/lojas/:id/pagamentos`   | Confirma quitação manual em transação                                                                                         |
| GET/POST | `/planos`                 | Lista/cria plano                                                                                                              |
| PUT      | `/planos/:id`             | Atualiza plano; não reajusta valor de contratos existentes                                                                    |
| GET/PUT  | `/politica`               | Consulta/atualiza política global                                                                                             |
| POST     | `/cobranca/executar`      | Concilia; retorna skipped se outro worker tem lock                                                                            |
| GET      | `/cobranca/execucoes`     | Últimas 30 execuções e 100 lembretes                                                                                          |
| GET      | `/interesses`             | Últimos 200 contatos comerciais                                                                                               |
| PATCH    | `/interesses/:id`         | `{atendido:boolean}`                                                                                                          |

Cadastro completo: `{nome,responsavel,email,telefone,slug?,plano_id,valor,vencimento,admin_email,senha,status?}`. Telefone com 10–13 dígitos. Senha de 12 caracteres até 72 bytes. `status` inicial active ou trialing; padrão active. Slug omitido é gerado; slug duplicado/reservado é recusado. Retorna `{id,slug}` com 201. PUT exige os mesmos campos comerciais, com senha opcional, e não recebe status inicial. Demos não podem ser renomeados.

Pagamento: `{valor,pago_em,referencia,observacao?,proximo_vencimento,confirmado:true}`. Datas ISO; pago_em não pode ser futuro; próximo vencimento deve ser posterior ao atual e a hoje; valor precisa quitar contrato. Referência única por estabelecimento. Somente esta ação registra um recebimento. Não há PUT/DELETE de pagamento.

Plano: `{nome,preco,limite_produtos:null|inteiro_positivo,limite_pedidos_mes:null|inteiro_positivo,adicionais:boolean,personalizacao:boolean,ativo:boolean}`. Limites contam produtos ativos e todos os pedidos criados no mês em America/Sao_Paulo, inclusive cancelados. Reduzir limite não exclui dados.

Política: `{lembrete_dias,suspender_dias,suspender_automaticamente,reativar_automaticamente}`; suspensão deve ocorrer no mesmo dia ou depois do lembrete. Datas usam America/Sao_Paulo. Estado efetivo é retornado como `efetivo` na assinatura; rotina persiste `status` periodicamente. Estados: trialing, active, pending, past_due, suspended, canceled.

Uploads aceitam PNG/JPEG/WebP reais, até 2 MB e 20 milhões de pixels, normalizados para WebP com até 2000×2000, sem metadados. URLs originais JPEG/PNG existentes continuam sendo servidas. DELETE de catálogo continua lógico; arquivamento não apaga informações históricas.

## WhatsApp dos pedidos

`GET /api/admin/pedidos` também retorna `mensagem`, `whatsapp_url` (pedido completo para o número atual da própria loja), `proximos_status` e `notificacao` (`null` ou `{id,mensagem,aberto_em}`). O histórico inclui `usuario_id`, `usuario_email`, `mensagem_whatsapp`, `telefone_whatsapp` e `whatsapp_aberto_em`; estes campos são nulos em eventos anteriores à implementação.

`PATCH /api/admin/pedidos/:id/status` aceita `{status,status_anterior?}`. Repetir o status atual retorna `{ok:true,repetido:true}` sem gravar outro evento. Uma transição inválida ou origem desatualizada retorna 400. Pedido de outra loja retorna 404.

`POST /api/admin/pedidos/:id/whatsapp` recebe `{historico_id}` e retorna `{whatsapp_url,mensagem}`. Exige sessão de loja e evento do pedido/status atual daquela loja. A primeira solicitação grava a data de abertura; repetição ou evento superado retorna 409. Nunca registra envio ou entrega de mensagem. A confirmação é manual no WhatsApp.

Instalação, limites e roteiro de homologação: [Pedidos e WhatsApp](PEDIDOS_WHATSAPP.md).
