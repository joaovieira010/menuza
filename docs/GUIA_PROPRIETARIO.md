# Guia do proprietário da Menuza

## Primeiro acesso

O responsável pela infraestrutura deve executar migrations e `npm run superadmin:create` com `SUPERADMIN_EMAIL` e `SUPERADMIN_PASSWORD` definidos apenas para o provisionamento. Não há senha padrão. Remova a senha do ambiente depois. Acesse `/superadmin` no domínio publicado. Contas de lojas usam `/admin`; os dois cookies e papéis são separados.

## Cadastrar um cliente

1. Abra **Estabelecimentos → Cadastrar estabelecimento**.
2. Preencha nome comercial, responsável, contato e telefone com DDD, somente dígitos.
3. Escolha o plano. Confira o **valor contratado** e o **próximo vencimento**. O valor pode ser negociado independentemente do preço de tabela.
4. Informe e-mail de acesso e senha inicial forte, com no mínimo 12 caracteres e até 72 bytes. Entregue a credencial por canal privado.
5. Deixe o endereço vazio para gerar um slug único ou informe um endereço com letras minúsculas, números e hífens. Rotas reservadas e duplicidades são recusadas.
6. Escolha contrato ativo ou período de avaliação. Cadastrar ou ativar um contrato não registra pagamento.
7. Salve. O link aparece no cartão do estabelecimento. Após a publicação será `https://SEU_DOMINIO/slug-da-loja`.

A loja nasce fechada e sem produtos. Cada loja tem seu próprio identificador permanente; mudar o slug não altera a empresa nem os pedidos.

## Preparar o cardápio

O proprietário entra em `/admin`, cria categorias, produtos e, se o plano permitir, grupos e adicionais. Em **Minha loja**, configura WhatsApp real, logo, banner, cores, taxa de entrega e horários. Horários são informativos: o controle de abertura é manual. Envia uma imagem PNG/JPEG/WebP de até 2 MB; o servidor normaliza para WebP. Ao terminar, marca **Loja aberta para receber pedidos** e salva.

Abra o link em um celular e faça um pedido de homologação identificado. Confira o mesmo pedido no painel e o total. O pedido já está salvo mesmo que o consumidor não envie a mensagem no WhatsApp. A loja atualiza a lista de pedidos e avança os status. A plataforma não confirma recebimento dos pagamentos dos consumidores.

## Confirmar uma mensalidade por PIX

1. Confira o crédito na conta bancária. A Menuza não faz essa consulta.
2. No cartão da loja, escolha **Registrar pagamento**.
3. Informe valor recebido, data, referência única do comprovante e observação.
4. Informe o próximo vencimento, posterior ao atual e ao dia de hoje.
5. Marque **Conferi e confirmo o recebimento** e salve.

O valor deve quitar pelo menos a mensalidade contratada. Se houver desconto negociado, ajuste primeiro o contrato e registre a observação. Esta versão não concilia parcelas ou pagamentos parciais. Referências repetidas na mesma empresa são recusadas. Não existe endpoint de exclusão/edição de pagamento; registros são preservados. Corrija um lançamento incorreto por procedimento administrativo auditado antes de continuar: não lance estornos fictícios nem altere o banco diretamente sem backup.

O registro avança o vencimento uma vez e atualiza o último pagamento. Se a política permitir, uma suspensão automática é retirada. Uma suspensão manual, um cancelamento ou arquivamento exige ação explícita do proprietário. Sem reativação automática, use **Reativar** após a quitação. O histórico mostra os recebimentos e as alterações.

## Atrasos, suspensão e reativação

Em **Cobrança e rotina**, ajuste os dias de lembrete/suspensão e a reativação automática. Padrão: no vencimento, `pending`; três dias depois, `past_due` e lembrete em fila; sete dias depois, `suspended`. Antes do vencimento, `active` ou `trialing`. `canceled` representa encerramento.

A rotina roda ao iniciar o servidor e a cada 15 minutos. **Reprocessar vencimentos** executa manualmente com trava no PostgreSQL. Veja execuções e lembretes nessa mesma tela. O backend verifica a regra a cada acesso, mesmo sem a rotina. Lembretes só chegam ao destinatário se o operador configurar um webhook HTTPS que encaminhe ao seu provedor.

**Suspender** exige motivo, bloqueia o cardápio para pedidos e operações da loja e revoga sessões. **Reativar** exige vencimento futuro: confirme o pagamento ou ajuste formalmente o contrato antes. Não haverá apagamento de pedidos, produtos ou financeiro.

**Arquivar** encerra a assinatura e mantém a empresa e o histórico. Para um cliente que retorna, reative o cadastro após regularizar vencimento e contrato. Não há exclusão física pelo painel. **Cancelar assinatura** encerra o contrato e bloqueia o acesso, mantendo os registros.

## Planos e mudança de contrato

Em **Planos**, edite preço de tabela, quantidade de produtos ativos, pedidos por mês, adicionais e personalização; vazio significa sem limite contratado. Esses recursos já são verificados no backend. Os três planos iniciais têm os mesmos recursos habilitados, sem limites: diferencie-os comercialmente conforme sua oferta.

Mudar o preço de tabela não reajusta contratos existentes. Altere o plano, valor e vencimento em **Editar** no cartão da loja. Os recursos e limites novos passam a valer para lojas vinculadas. Não há rateio/prorrata automática. Revise o impacto antes de reduzir limites ou desabilitar recursos de um plano usado.

## Contatos e indicadores

A página institucional recebe interessados pelo formulário. Em **Contatos comerciais**, consulte os dados e marque o atendimento. Não existe e-mail de confirmação ou aviso automático desse formulário; consulte a fila.

A visão geral separa receita mensal contratada de pagamentos confirmados no mês. Contratos não cancelados, inclusive suspensos, compõem a receita contratada. Demonstrações não entram nos indicadores comerciais. Arquivados ficam no total histórico de clientes; pagamentos históricos reais continuam no mês em que foram recebidos.

## Operação diária

Confira pedidos com a loja, novas solicitações, vencimentos e erros de rotina. Confira diariamente o resultado dos backups e alertas de disponibilidade. Nunca use a base temporária local como produção. Antes do primeiro cliente, siga [PUBLICACAO.md](PUBLICACAO.md) e registre a homologação no domínio real.
