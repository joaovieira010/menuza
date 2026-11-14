# Revisão da Menuza para o teste piloto

Revisão de 14/11/2026. As correções foram implementadas no repositório e verificadas em PostgreSQL descartável e Chrome. **PENDENTE**: homologação da instalação real, cujo PostgreSQL recusou conexão (`ECONNREFUSED`). Nenhum dado real, conta, senha, pedido ou catálogo da Frutella foi alterado. Não houve deploy, DNS, migração da base real ou conexão de novo serviço externo.

## 1 Problemas encontrados

| Estado    | Problema e evidência                                                                                                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CONCLUÍDO | Cadastro do Superadmin exigia telefone somente numérico por regex, enquanto outros fluxos aceitavam formatação. A mensagem de validação não identificava o campo.                                                                                                  |
| CONCLUÍDO | E-mails não removiam espaços externos antes de validar. Endereço opcional vazio era omitido pelo frontend, mas um corpo com string vazia era rejeitado pela API.                                                                                                   |
| CONCLUÍDO | Troca de plano no formulário comparava ID numérico com string do select. Isso podia interromper a atualização da mensalidade sugerida.                                                                                                                             |
| CONCLUÍDO | A revogação de sessão após editar uma loja comparava o e-mail do administrador com o contato comercial, em vez de comparar com o acesso anterior.                                                                                                                  |
| CONCLUÍDO | Telefone legado inválido do cliente impedia a transação de atualização de status inteira.                                                                                                                                                                          |
| CONCLUÍDO | Mensagem inicial chamava de confirmado um pedido ainda pendente de confirmação da loja.                                                                                                                                                                            |
| CONCLUÍDO | Contato comercial apenas registrava interesse no banco, sem abrir a conversa solicitada.                                                                                                                                                                           |
| CONCLUÍDO | Uma cópia local `.env.save` aparecia entre arquivos não rastreados. Agora padrões de cópia são ignorados; seu conteúdo não foi lido, publicado ou alterado.                                                                                                        |
| PENDENTE  | As migrations existentes criam os três planos com os mesmos recursos e sem limites; o estado real pode ter sido personalizado no banco indisponível. Não há diferencial exclusivo comprovado do terceiro plano.                                                    |
| PENDENTE  | A causa exata de “Tente novamente” na instalação real não pôde ser comprovada sem conexão e logs dessa instalação. A migration 005 já existente habilita `pronto` e colunas do histórico; ausência dela é uma hipótese a verificar, não um diagnóstico confirmado. |

## 2 Problemas corrigidos

**CONCLUÍDO**: telefone do cadastro usa o normalizador brasileiro já empregado no checkout, preservando DDD e acrescentando o país quando necessário. Telefones formatados são aceitos; texto estranho, número incompleto e formatos inválidos continuam rejeitados. E-mail é normalizado sem modificar senha; senha continua com mínimo de 12 caracteres no provisionamento e limite bcrypt de 72 bytes. Endereço vazio é opcional; endereço preenchido continua validado e sujeito a unicidade e nomes reservados. Erros indicam o campo.

**CONCLUÍDO**: seleção de plano, comparação de e-mail para revogação de sessão e proteção explícita contra mudança do endereço `/frutellagourmet-d9b505e6`. A proteção não consulta nem altera a loja real nesta revisão.

**CONCLUÍDO**: atualização de status não fica bloqueada por telefone legado inválido. O histórico recebe autor e horário, sem inventar telefone ou mensagem. O painel mostra aviso para conferir o contato. Telefones de novos pedidos continuam validados no checkout.

## 3 Funcionalidades implementadas e preservadas

| Estado                  | Resultado                                                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CONCLUÍDO               | Inicial sem botão de experimentar e sem vitrine de demonstrações. Rotas e dados de demonstrações não foram apagados.                                                                                                                                                     |
| CONCLUÍDO               | “Quero a Menuza” coleta nome, estabelecimento, tipo, telefone, cidade, e-mail e observações. Após registrar o interesse, abre `wa.me/5548988780394` com texto codificado e disponibiliza link alternativo. O visitante confirma o envio no WhatsApp.                     |
| CONCLUÍDO               | Cidade e tipo ficam separados das observações no contato comercial e aparecem no Superadmin. Campos opcionais mantêm compatibilidade com clientes da API anteriores.                                                                                                     |
| CONCLUÍDO               | Mensagem da loja passa a dizer “NOVO PEDIDO”. Foram preservados número, nome/telefone, quantidade, produtos, opções/adicionais, observação por item, subtotal, taxa quando houver entrega, total, modalidade, endereço informado, pagamento, troco e observações gerais. |
| CONCLUÍDO               | Histórico, transições, autor e horário, bloqueio de transições incompatíveis com retirada/entrega e uma solicitação de abertura por evento já existentes foram preservados e testados. Confirmação, pronto, saída e cancelamento geram mensagens com número do pedido.   |
| CONCLUÍDO               | Preços, permissões, limites e recursos dos planos não foram alterados. A apresentação lê as regras efetivas da API, detalha recursos reais e informa quando há planos equivalentes.                                                                                      |
| CONCLUÍDO               | Novo `npm run pilot:check`: consulta somente leitura de migrations, suporte a `pronto`, colunas de histórico, presença do link da Frutella e existência de Superadmin ativo; não revela credenciais ou dados de clientes.                                                |
| PENDENTE                | Diferencial comercial exclusivo dos planos superiores: requer conhecer a configuração real e definir benefício implementado. Não foram inventados suporte prioritário, relatórios exclusivos, integrações ou envio automático.                                           |
| PRECISA DE TESTE MANUAL | Abertura e envio no aplicativo WhatsApp/WhatsApp Business real. Um link oficial não garante qual aplicativo o aparelho escolherá, nem permite comprovar envio ou recebimento.                                                                                            |

O controle de duplicação registra solicitação de abertura, não envio. Se o funcionário fechar a conversa sem enviar, a mensagem continua visível no painel para conferência e cópia; o botão permanece consumido para aquele evento. Não existe integração paga ou API automática de WhatsApp adicionada.

## 4 Arquivos modificados nesta revisão

O diretório já continha muitas alterações ao iniciar. Elas foram preservadas. A lista abaixo identifica os arquivos editados ou criados nesta rodada; o diff total em relação ao Git também contém trabalho anterior.

| Arquivo                                                                         | Alteração desta revisão                                                                            |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `.gitignore`                                                                    | Ignorar cópias de env, preservando exemplos.                                                       |
| `package.json`                                                                  | Comando `pilot:check`.                                                                             |
| `backend/src/middlewares/validation.js`                                         | Telefone reutilizável, e-mail normalizado, mensagens com campo e slug legível.                     |
| `backend/src/routes/superadmin.js`                                              | Cadastro, slug opcional, sessão e proteção do endereço da Frutella.                                |
| `backend/src/controllers/admin.js`                                              | Status independente de telefone legado inválido e aviso.                                           |
| `backend/src/services/orders.js`                                                | Título da mensagem do pedido pendente.                                                             |
| `backend/src/services/whatsapp.js`                                              | Mensagem de interesse comercial.                                                                   |
| `backend/src/app.js`                                                            | Validação, persistência e link do contato comercial.                                               |
| `backend/src/database/migrations/006_contato_comercial.sql`                     | Duas colunas opcionais de contatos.                                                                |
| `frontend/index.html`                                                           | Remoção das chamadas de demonstração e formulário de contato.                                      |
| `frontend/home.js`                                                              | WhatsApp comercial, alternativa ao popup e benefícios reais dos planos.                            |
| `frontend/superadmin/app.js`                                                    | Telefone, troca de plano e exibição de cidade/tipo.                                                |
| `frontend/admin/app.js`                                                         | Aviso após status sem destinatário válido.                                                         |
| `backend/tests/api.test.js`                                                     | Expectativa de mensagem e teste de telefone legado.                                                |
| `backend/tests/order.test.js`                                                   | Expectativa de novo pedido.                                                                        |
| `backend/tests/saas.test.js`                                                    | Cadastro, validações, contato e cenário de três lojas simultâneas.                                 |
| `backend/tests/sessions.test.js`                                                | Preparação de migrations antes das tabelas temporárias, evitando dependência da ordem de execução. |
| `backend/tests/browser-saas.cjs`                                                | Contato completo, telefone formatado e troca de plano no navegador.                                |
| `backend/tests/backup.cjs`                                                      | Contagem de migrations obtida dos arquivos, incluindo as migrations já existentes 005 e nova 006.  |
| `scripts/pilot-check.cjs`                                                       | Diagnóstico somente leitura.                                                                       |
| `docs/REVISAO_PILOTO.md`, `docs/PILOTO_INFRAESTRUTURA.md`, `docs/PUBLICACAO.md` | Resultado, limitações, planejamento gratuito e referência atualizada.                              |

## 5 Alterações realizadas no banco

**CONCLUÍDO em bases descartáveis**: migrations 001 a 006, criação de fixtures e operações exigidas pelos testes. A migration nova 006 acrescenta `tipo_negocio` e `cidade` a `interesses_comerciais`, ambos `varchar(120) NOT NULL DEFAULT ''`. Não altera contatos anteriores, observações, pedidos, contas, lojas ou planos. O executor usa transação e trava de migration.

**PENDENTE na instalação real**: conferir migrations aplicadas, realizar backup e aplicar apenas as necessárias em janela controlada. A migration 005 é anterior a esta rodada e já estava no diretório. Não foi reescrita. Não foram feitas exclusões, mudanças de credenciais ou migrations no banco real. Testes que limpam fixtures executaram apenas em base explicitamente descartável dentro de um cluster novo em `/tmp`.

## 6 Testes executados e resultados

| Estado                  | Verificação                        | Resultado                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CONCLUÍDO               | Jest sobre PostgreSQL separado     | **105 testes aprovados em 7 suítes (15,921 s)**. Inclui login dos dois papéis, cadastro transacional, rejeição/rollback, categorias, produtos, preços adulterados, valores, adicionais, entrega/retirada, histórico, permissões, bloqueio/desbloqueio e três lojas com pedidos simultâneos e destinatários independentes. |
| CONCLUÍDO               | API de status e WhatsApp           | Retirada pronta, saída na entrega, cancelamento, autores, snapshots, transições inválidas, chamadas concorrentes, abertura repetida e tentativas entre lojas. Links e textos verificados, sem enviar mensagens.                                                                                                           |
| CONCLUÍDO               | Chrome SaaS                        | Home a 390 px, contato e popup interceptado, telefone formatado, troca de plano, criação de loja e responsável, login, categoria/produto, abertura, pedido móvel, pronto, histórico, popup do cliente, deduplicação, suspensão/quitação/reativação e logout. Sem erros JavaScript detectados.                             |
| CONCLUÍDO               | Chrome regressão original          | Carrinho persistente, adicionais, quantidades, entrega, checkout, WhatsApp interceptado, painel, status, upload, criação/edição de produtos, configurações e logout. Sem rolagem lateral no cardápio móvel verificado.                                                                                                    |
| CONCLUÍDO               | Backup e restauração               | Migrations em schema vazio, dump, hashes, arquivo de upload, contagens de tabelas, restauração em destino vazio e recusa de segunda restauração sobre banco populado.                                                                                                                                                     |
| CONCLUÍDO               | Formatação e integridade do diff   | Prettier nos arquivos desta revisão e `git diff --check` sem erros após os ajustes.                                                                                                                                                                                                                                       |
| CONCLUÍDO               | `pilot:check` no banco descartável | Sem migrations pendentes, `pronto` permitido e histórico completo; saída 1 esperada porque a Frutella real não existe na base de testes. Nenhuma Frutella fictícia foi criada.                                                                                                                                            |
| PENDENTE                | Consulta ao PostgreSQL configurado | Sandbox inicialmente recusou acesso; repetição autorizada fora dele retornou `ECONNREFUSED`. Estrutura efetivamente aplicada e contas reais não puderam ser conferidas.                                                                                                                                                   |
| PRECISA DE TESTE MANUAL | Logins existentes e catálogo real  | Não foi usada ou alterada a senha do Superadmin ou da Frutella; seus acessos reais ainda precisam ser homologados.                                                                                                                                                                                                        |
| PRECISA DE TESTE MANUAL | WhatsApp real e celulares          | Conferir envio, recebimento, aplicativo instalado e comportamento em Android/iPhone reais.                                                                                                                                                                                                                                |

As primeiras execuções também revelaram preparação incompleta da suíte de sessões em banco vazio e um erro de composição Zod introduzido durante a edição. Ambos foram corrigidos. O seletor do teste de plano no Chrome foi ajustado para selecionar pelo ID; a execução seguinte passou. Execuções interrompidas ou com falha não foram contadas como sucesso.

## 7 Problemas que permanecem

- **PENDENTE**: conectar ao PostgreSQL real e confirmar a origem exata do erro de status nessa instalação; o fluxo corrigido funciona nos testes isolados.
- **PENDENTE**: verificar preços e regras atuais do banco real antes de diferenciar comercialmente os três planos.
- **PENDENTE**: definir o benefício exclusivo do terceiro plano sem retirar direitos de contratos existentes.
- **PENDENTE**: armazenamento persistente de imagens, agendamento e cópia externa de backups, monitoramento com destinatário e homologação de HTTPS.
- **PRECISA DE TESTE MANUAL**: experiência em aparelhos reais e envio de mensagens.
- **PENDENTE**: teste de capacidade prolongado; concorrência funcional entre três lojas não mede capacidade de produção nem garante SLA.

## 8 Tarefas que dependem do proprietário

- **PENDENTE**: disponibilizar/iniciar a instância correta do PostgreSQL, sem enviar senhas pelo chat, e confirmar o ambiente a homologar.
- **PENDENTE**: definir os outros dois estabelecimentos e as condições comerciais dos planos. Nenhuma loja fictícia foi criada no ambiente real.
- **PRECISA DE TESTE MANUAL**: responsável entrar nas contas existentes, conferir catálogo, endereço e WhatsApp da Frutella e participar do primeiro pedido controlado.
- **DEPENDE DE AUTORIZAÇÃO**: contratar/provisionar host, banco, storage, backup externo ou monitor; fazer deploy, DNS ou migração. Ver planejamento em `PILOTO_INFRAESTRUTURA.md`.

## 9 Situação atual da Menuza

**CONCLUÍDO**: correções locais e verificações em ambiente isolado. Autenticação, isolamento por loja, preços e recursos existentes foram mantidos. Histórico e notificações manuais já implementados foram exercitados pelos testes.

**PENDENTE**: aprovação técnica da instalação real. Não classificar como pronta para operação comercial com base apenas nos testes locais. O banco configurado está inacessível nesta sessão e não foi realizada publicação.

## 10 O que falta para iniciar com a Frutella Gourmet

1. **PENDENTE**: PostgreSQL real acessível; executar `npm run pilot:check` e conferir `/frutellagourmet-d9b505e6` sem mudar seus dados.
2. **PENDENTE**: backup do banco e das imagens reais, com restauração verificada em destino separado; revisar migrations antes de aplicá-las.
3. **PRECISA DE TESTE MANUAL**: login existente do Superadmin e responsável, catálogo/valores/adicionais, loja aberta e WhatsApp correto.
4. **PRECISA DE TESTE MANUAL**: pedido autorizado de retirada e entrega, conferindo painel, cálculo, histórico, pronto/saída/cancelamento e mensagens reais. Não testar cancelando pedidos antigos.
5. **DEPENDE DE AUTORIZAÇÃO**: publicar em infraestrutura escolhida com HTTPS, fotos persistentes, backup externo e monitoramento.
6. **PENDENTE**: combinar responsável e horário de acompanhamento do piloto; cadastrar as outras duas lojas somente quando forem definidas.
