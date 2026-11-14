# Pedidos e WhatsApp

## Arquitetura aproveitada

Express 5, pg/PostgreSQL e frontend em JavaScript puro. O checkout existente usa transação, trava por estabelecimento, contador sequencial por loja e chave de idempotência. Catálogo, preços e taxa são lidos no servidor; os valores são inteiros em centavos. Itens e adicionais têm snapshots de nomes/preços. Autenticação, sessões, regras de assinatura e Superadmin foram preservados.

O pedido completo usa `services/orders.js`; telefone, links e textos de status usam `services/whatsapp.js`. O painel consulta os pedidos da loja autenticada, incluindo itens e histórico, em `controllers/admin.js`. Todas as consultas/mutações novas são limitadas por estabelecimento e pedido; o autor vem da sessão.

## Instalação da alteração

Usar Node 24+ já previsto pelo projeto. A migration `005_pedidos_whatsapp.sql` amplia a constraint de status e acrescenta colunas ao histórico. Não apaga linhas, não renumera pedidos, não muda status antigos nem inventa autores retroativos. A FK composta impede associar um autor de outra loja. A troca da constraint é transacional pelo migrador existente; requer um breve lock de tabela, portanto aplicar em janela apropriada.

A migration foi validada somente no banco descartável `_test`. Para instalar na base da aplicação, o operador deve aplicar as migrations pendentes com `npm run migrate` e reiniciar o servidor. Não executar seed. Backend e frontend atualizados dependem dessa migration. Para reverter o código, preservar as colunas e os históricos; a versão antiga não conhece `pronto`, portanto não fazer downgrade com pedidos nesse estado sem planejar a compatibilidade.

## Comportamento

- Mensagem de novo pedido com número de pelo menos seis dígitos, cliente, cada linha do carrinho, opções, observações por item, subtotal, taxa para entrega, total, modalidade, endereço ou instrução de retirada, pagamento, troco e observação geral.
- Numeração é única **dentro da loja**; lojas distintas podem ter o mesmo número. O ID interno identifica globalmente o pedido.
- Tamanhos, sabores e complementos aproveitam o nome do produto e os grupos de opções já existentes. Não há criação de um segundo cadastro de variações.
- Mensagem da loja é reconstituída no painel a partir dos snapshots do pedido e direcionada ao WhatsApp atualmente cadastrado naquela loja. Alterar preço/nome no catálogo não altera o pedido antigo.
- Fluxo: `pendente → confirmado → em_preparacao → pronto → saiu_para_entrega → concluido` para entrega. Retirada vai de `pronto` para `concluido`. Qualquer estado não final pode ser cancelado. Estados finais não reabrem.
- `pendente` representa pedido salvo aguardando confirmação; `confirmado` aparece como “Pedido recebido”. O título solicitado “PEDIDO CONFIRMADO” na mensagem do checkout identifica o pedido registrado, sem avançar a confirmação operacional do funcionário.
- Cada alteração grava status, data, ID e e-mail do usuário, texto e telefone de destino. Eventos antigos permanecem sem autor; o checkout inicial é identificado na tela como cliente.
- Cada status novo prepara uma mensagem personalizada. `pronto` distingue entrega de retirada. O botão do cliente se refere somente ao status atual.
- Alterações repetidas para o mesmo status são idempotentes. Trava de linha serializa requisições concorrentes. A tela envia também `status_anterior` para rejeitar ações de uma visualização desatualizada.
- A abertura do WhatsApp do cliente é solicitada uma vez por evento, mediante atualização atômica no banco. Repetir em outra aba, após recarregar ou concorrentemente recebe 409. Eventos antigos não podem ser abertos depois de uma nova mudança de status.

## Limites do WhatsApp gratuito

`wa.me` abre a conversa com telefone brasileiro normalizado com país 55 e mensagem codificada com `encodeURIComponent`. A Menuza não envia, não recebe confirmação de envio e não sabe se a mensagem foi entregue ou lida. O funcionário precisa confirmar no aplicativo. Não há API paga nem serviço externo novo.

`whatsapp_aberto_em` registra uma solicitação de abertura, não um envio. Se a rede falhar depois do commit ou o aplicativo não abrir, o evento pode aparecer como abertura já solicitada. A prévia permanece acessível para copiar a mensagem e enviar manualmente; não há reabertura automática para evitar duplicações. Um popup bloqueado antes da requisição não consome o evento. O link do pedido completo para a própria loja continua disponível.

O cadastro atual não possui endereço físico da loja; a retirada informa o nome do estabelecimento, sem inventar endereço. Telefones seguem a validação brasileira já adotada pelo produto. O histórico anterior à migration não tem autor ou mensagem de status retroativa. Filtros/lista continuam limitados aos 200 pedidos mais recentes.

## Como testar manualmente

Usar lojas de homologação e números sob seu controle; confirmar o envio no WhatsApp somente se desejado.

1. Conferir o WhatsApp cadastrado em “Minha loja” de duas lojas diferentes.
2. Na loja A, adicionar duas linhas do mesmo produto com tamanhos/sabores/complementos distintos. Finalizar com entrega, endereço, observação e pagamento em dinheiro com troco. Conferir subtotal, taxa, total, opções e destino no link do checkout.
3. Abrir “Pedidos” no painel A, atualizar e conferir número, horário, produtos, total, pagamento, modalidade e status. Abrir o link do pedido para a loja e verificar o destinatário.
4. Confirmar recebimento, iniciar preparação e marcar “Pedido pronto”. Abrir a prévia e o WhatsApp do cliente: conferir primeiro nome, número e texto. Confirmar envio manualmente se desejado. Repetir clique e atualizar a lista: a mesma abertura fica desabilitada.
5. Marcar “Saiu para entrega”, conferir a nova mensagem e concluir. Verificar o histórico com horário e funcionário em cada evento. Não deve haver ação de reabertura do pedido concluído.
6. Fazer outro pedido com retirada: não deve haver taxa nem endereço de entrega. Em “Pedido pronto”, conferir “pronto para retirada”; deve ser possível concluir, sem ação de saída para entrega.
7. Cancelar um terceiro pedido e conferir a mensagem de cancelamento e o estado final.
8. No painel B, conferir ausência dos pedidos/clientes/históricos da A. Fazer um pedido na B e conferir seu número sequencial independente e seu próprio WhatsApp.
9. Em duas abas da A, tentar a mesma alteração e abertura simultaneamente: o histórico deve registrar uma alteração e permitir uma solicitação de abertura por evento. Uma aba desatualizada deve exigir atualização quando tentar uma transição incompatível.

## Validação automatizada

`npm test` cobre cálculos, checkout real no PostgreSQL, mensagens, opções, entrega/retirada, normalização, codificação, autor/histórico, isolamento, permissões, idempotência e concorrência de status/abertura. As fixtures de API são exclusivas do banco descartável; a suíte não chama o seed da aplicação. A limpeza continua restrita ao banco `_test` explicitamente configurado.

`npm run test:browser:saas` exercita o checkout e o painel no Chrome, passa por recebido/preparação/pronto/concluído, abre o link do cliente interceptando `wa.me` e verifica que atualizar a lista mantém o botão desabilitado. Nenhuma mensagem real é enviada.

Resultado desta implementação: `npm test` passou com 7 suítes e 102 testes no Node 24.22.3/PostgreSQL de testes. `npm run test:browser:saas` passou no Chrome, incluindo a notificação de retirada e a persistência do bloqueio de abertura repetida. A primeira tentativa no sandbox foi bloqueada por EPERM de rede local; as execuções aprovadas fora do sandbox passaram. Seeds, testes de backup/restauração e o script de regressão legado que chama seed não foram executados. Nenhuma migration foi aplicada à base da aplicação.

Arquivos desta alteração: `backend/src/services/orders.js`, `backend/src/services/whatsapp.js`, `backend/src/controllers/admin.js`, `backend/src/middlewares/validation.js`, `backend/src/routes/admin.js`, `backend/src/database/migrations/005_pedidos_whatsapp.sql`, `frontend/shared.js`, `frontend/admin/app.js`, `frontend/admin/style.css`, `backend/tests/order.test.js`, `backend/tests/api.test.js`, `backend/tests/helpers/order-fixtures.js`, `backend/tests/saas.test.js`, `backend/tests/browser-saas.cjs`, `backend/tests/browser.cjs`, `docs/API.md`, `docs/PEDIDOS_WHATSAPP.md` e `README.md`. As alterações que já existiam no workspace foram preservadas.
