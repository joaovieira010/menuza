# Validação SaaS 1.0

Execução em 13/11/2026, no checkout existente, com Node 26.13.0, PostgreSQL 12.22 real, Jest/Supertest e Chrome headless via Playwright Core. Produção recomenda versão PostgreSQL com suporte vigente; a versão local serve à compatibilidade/testes.

## Ambiente e preservação

Instância local isolada já existente em `/tmp/menuza-pg`, porta 55432. Foram utilizados:

- Banco local de desenvolvimento: recebeu migrations aditivas 002–004, sem apagar pedidos, produtos, personalização ou credenciais.
- Banco `_test` definido em `TEST_DATABASE_URL`: descartável, limpo pela suíte de integração e usado pelo teste SaaS. Pagamentos QA ficam somente aqui.
- `menuza_legacy_test`: criado separado para rodar as fixtures originais de navegador sem alterar a loja personalizada do usuário.
- `menuza_restore_test`: criado vazio exclusivamente para a restauração do backup da base descartável.

Nenhum deles representa banco comercial persistente. A base original da porta 5432 não foi acessada. Não houve publicação, pagamento bancário, mensagem real ou alteração de DNS.

## Resultados

| Verificação                      | Resultado                                                                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Jest/Supertest                   | 4 suítes, 56 testes aprovados, PostgreSQL real                                                                                                  |
| Chrome SaaS                      | Cadastro pela UI, configuração da loja, produto, pedido mobile, painel, suspensão sem cron, pagamento manual QA e reativação aprovados          |
| Chrome regressão isolada         | Carrinho persistido, adicionais, entrega, troco, WhatsApp interceptado, gestão de status, upload, CRUD, configuração e logout aprovados         |
| Migrations do zero               | 001, 002, 003 e 004 aplicadas em schema vazio; seed criou duas assinaturas                                                                      |
| Upgrade da base existente        | 002, 003 e 004 aplicadas sem apagar dados                                                                                                       |
| Backup/restauração               | Dump e upload de fixture restaurados em outro banco; contagens de lojas, assinaturas, pedidos, itens, pagamentos, auditoria e migrations iguais |
| Recusa de sobrescrita            | Segunda restauração em banco populado recusada                                                                                                  |
| `npm audit --omit=dev`           | Zero vulnerabilidades                                                                                                                           |
| Auditoria completa na instalação | 19 avisos de ferramentas de desenvolvimento, 3 baixos e 16 moderados; sem downgrade forçado                                                     |
| Formatação e `git diff --check`  | Verificados na versão final                                                                                                                     |

Os testes de integração e navegador não foram substituídos por mocks de PostgreSQL. O link WhatsApp foi interceptado no Chrome; não houve mensagem externa.

## Cobertura comprovada

- Duas empresas cadastradas pela API, slugs independentes e geração automática.
- Validação de slug reservado/inválido/duplicado e rollback de cadastro quando o e-mail já existe.
- Separação de cookies/papéis; loja não acessa superadmin e superadmin não entra implicitamente no tenant.
- Alteração de tenant no JSON ignorada; edição, remoção, vínculo e pedidos de outra loja recusados.
- Catálogo público sem contatos comerciais, contador e dados da assinatura.
- Preços adulterados ignorados; adicionais/taxa/troco calculados pelo banco/servidor; transações e sequência concorrente por loja.
- Idempotência concorrente do checkout grava uma vez; alteração de corpo na mesma chave retorna 409.
- Pendência no vencimento, atraso aos três dias, suspensão aos sete, fila sem duplicação e reprocessamento.
- Bloqueio público e administrativo online antes da rotina, com preservação de pedidos e funcionamento da outra loja.
- Pagamento sem confirmação, insuficiente ou com datas inválidas recusado; recebimento confirmado avança vencimento e reativa bloqueio automático; referência não duplica recebimento.
- Política de reativação manual, suspensão manual com revogação, cancelamento preservado após quitação e arquivamento sem apagar histórico.
- Planos/política editáveis pela API; preço de tabela não altera mensalidade contratada; plano fora da venda mantém contrato antigo editável.
- Limite de produtos com concorrência e de pedidos mensais; adicionais desabilitados no backend.
- Upload real decodificado/normalizado para WebP, arquivo truncado/disfarçado/tamanho excessivo recusados.
- Sessão expirada no banco e token copiado após logout recusados; senhas preservam espaços e respeitam limite bcrypt de bytes.
- Configuração de produção recusa HTTP, localhost, origem não exata, banco `_test` e secret de exemplo.
- Formulário comercial persiste interessado; somente superadmin consulta.
- CSS mobile sem rolagem horizontal nos fluxos testados; screenshots de institucional, superadmin, catálogo e suspensão inspecionadas.

## Problemas encontrados durante validação

1. Subprocesso inicial encontrou Node 16 e não carregou o runner do Jest. Corrigida a execução explícita com Node 26; `.nvmrc`/engines documentam versão exigida.
2. Seed antigo criava tenant sem assinatura após a migração. Corrigido o seed, mantendo o bloqueio conservador para tenants sem contrato.
3. Teste SaaS usava nome acessível exato inadequado para select de modalidade. Corrigido o seletor; o fluxo permaneceu sendo executado pela UI.
4. O endereço demo da base de desenvolvimento foi personalizado pelo usuário (nome, catálogo, fotos e preços). A regressão original pressupunha fixtures iniciais. Foi criada base exclusiva e a personalização foi preservada.
5. PNG embutido no teste antigo tinha assinatura binária, mas não decodificava integralmente. Foi substituído por um PNG real gerado com sharp, mantendo os asserts do teste. Não foi afrouxada a validação do upload.
6. Na revisão foram corrigidos preservação de cancelamento após pagamento, edição de contrato com plano inativo e espaços em senhas, com testes adicionais.

## Artefatos e comandos

```bash
npm test
npm run test:browser:saas
npm run test:browser:regression
npm run test:backup
npm run format:check
npm audit --omit=dev
git diff --check
```

`test:backup` exige destino `menuza_restore_test` vazio e não apaga um destino já restaurado. Não rode suítes que escrevem no mesmo banco em paralelo. A suíte de integração limpa exclusivamente o banco `_test` validado. Confira o README antes de executar.

Backups QA em `/tmp/menuza-backup-qa-*`; screenshots `/tmp/menuza-institucional-mobile.png`, `/tmp/menuza-superadmin-mobile.png`, `/tmp/menuza-superadmin-desktop.png`, `/tmp/menuza-suspensao-mobile.png`, `/tmp/menuza-saas-pedido.png` e imagens da regressão `/tmp/menuza-cardapio-mobile.png`, `/tmp/menuza-dashboard.png`, `/tmp/menuza-pedidos.png`. São artefatos temporários, não arquivos de produção.

## Correção do acesso ao Superadmin em 13/11/2026

A porta 3000 era atendida pelo PID 25607, iniciado às 14:58:48, enquanto `app.js` e `server.js` haviam sido atualizados às 15:59:55. A instância antiga respondia `200` com o título `Cardápio • Menuza` em `/superadmin`; uma instância isolada do código atual respondia `Superadmin • Menuza`. A causa era código antigo em memória, anterior à rota da plataforma, fazendo `superadmin` cair na rota genérica `/:slug`.

A instância antiga foi encerrada com SIGTERM e substituída pelo servidor atualizado. A inicialização agora informa PID e URLs, trata porta ocupada com saída 1 e somente inicia a cobrança após bind bem-sucedido. O teste de porta ocupada também comprovou que Express 5 chama o callback de `listen` com erro: esse caminho agora retorna antes de anunciar sucesso ou iniciar cobrança. O HTML de `/superadmin` recebe `Cache-Control: no-store`.

Validação desta correção:

- Jest: 6 suítes e 73 testes aprovados, incluindo rotas, arquivos estáticos, autenticação e falha de inicialização. Fixtures e limpezas das suítes existentes ficaram no banco descartável `TEST_DATABASE_URL`.
- Chrome SaaS no banco de testes: login, dashboard, restauração da sessão em `/superadmin/`, operação da loja, logout da plataforma e preservação da sessão independente da loja aprovados. A conta real de Superadmin não foi recriada nem teve sua senha alterada; o login completo usou uma conta QA exclusivamente no banco de testes.
- Chrome no servidor real `http://localhost:3000`: `/superadmin`, `/superadmin/`, login da loja em `/admin`, os dois cardápios demo e `/health` aprovados, sem erros JavaScript.
- Contagens e hashes de todas as linhas de `usuarios`, `estabelecimentos`, `categorias`, `produtos`, `pedidos`, `itens_pedido`, `assinaturas` e `pagamentos` idênticos antes e depois do reinício. Nenhum seed ou migration foi executado na base de desenvolvimento. A rotina normal de cobrança registrou sua execução de inicialização e informou `changed: 0`.
- Formatação dos arquivos JavaScript alterados e `git diff --check` aprovados.

Screenshot do login real corrigido: `/tmp/menuza-superadmin-login-corrigido.png`. Para iniciar a instalação existente, use `nvm use` e `npm start`; durante alterações no backend, `npm run dev` recarrega automaticamente. Encerre a instância anterior antes de iniciar outra na mesma porta.

## O que falta validar externamente

- Deploy real, domínio, DNS, certificado, proxy/IP do rate limiter, TLS da conexão externa do banco e cookies em HTTPS.
- Persistência de uploads e banco após reiniciar/reimplantar no provedor contratado.
- Agendamento de backup no host definitivo, cópia externa, retenção, alertas e restauração de backup desse ambiente.
- Webhook e provedor reais de comunicação, aceitação/deduplicação e entrega ao destinatário. O código e a outbox estão preparados; nenhum provedor foi configurado/testado.
- Docker build e aplicação do Blueprint numa conta Render, Safari/iOS/Firefox, dispositivo físico, carga/capacidade e auditoria independente de acessibilidade/segurança.
- Dados do operador, canal de suporte, contratos e política comercial/privacidade de produção.

**Conclusão de validação:** os fluxos locais implementados passaram. Não é uma declaração de produção pronta. A operação com clientes reais depende de concluir a homologação de [PUBLICACAO.md](PUBLICACAO.md).
