# Menuza SaaS 1.0

Cardápios digitais e pedidos para pequenos estabelecimentos, com administração comercial centralizada. Evolução do projeto existente em Node.js, Express 5, PostgreSQL/pg, HTML/CSS/JavaScript puro, JWT/bcrypt e cookies httpOnly.

**Estado:** implementação e validação local. A instalação comercial depende de hospedagem/banco persistentes, domínio HTTPS, backups externos e homologação no provedor. A base local em `/tmp` não é produção. Veja [publicação](docs/PUBLICACAO.md) e [validação](docs/VALIDACAO.md).

## O que está implementado

- Tenants independentes, slugs únicos automáticos/editáveis, FKs compostas e autorização pelo tenant autenticado.
- Superadmin em `/superadmin`: dashboard, busca/filtro de lojas, cadastro/edição, contas de acesso, contrato/plano, histórico, suspensão, reativação e arquivamento com preservação dos registros.
- Planos configuráveis (Básico R$ 49,90, Profissional R$ 79,90, Completo R$ 119,90), preço contratado independente, limites de produtos/pedidos e recursos de adicionais/personalização.
- PIX manual com confirmação explícita, referência única e histórico; vencimentos, estados de assinatura, rotina auditada e bloqueio no backend. Lembretes em outbox com webhook opcional.
- Cardápio, busca, categorias, produtos/adicionais, carrinho por loja, entrega/retirada, taxa, checkout e cálculo definitivo no servidor.
- Pedidos transacionais, numeração por loja, snapshots, idempotência no checkout, mensagem/link para WhatsApp e gestão/histórico de status.
- Painel da loja com catálogo, configurações, logo, banner, cores, WhatsApp, horários informativos, abertura manual e consulta da assinatura.
- Sessões persistidas revogáveis, cookies separados por papel, validação de origem/entradas, rate limit, SQL parametrizado e upload normalizado em WebP.
- Site comercial responsivo, planos reais do banco, demos e formulário de interessados consultável pelo superadmin.
- Migrations controladas, health, Render Blueprint, Dockerfile, modelos VPS/systemd/Caddy e scripts de backup/restauração.

Não há cobrança automática de cartão/PIX, envio automático pelo WhatsApp, envio de lembrete sem provedor configurado, recuperação de senha por e-mail, PDV ou impressão. O consumidor paga diretamente à loja. Nenhum pagamento real foi simulado na produção.

## Instalação local

Requer Node 24+ (QA com Node 26), PostgreSQL e cliente pg_dump compatível para backups.

```bash
nvm install
nvm use
npm ci
cp backend/.env.example backend/.env
```

No PostgreSQL, crie usuário com senha e bancos distintos para desenvolvimento e testes:

```sql
CREATE ROLE menuza_app LOGIN;
\password menuza_app
CREATE DATABASE menuza OWNER menuza_app;
CREATE DATABASE menuza_test OWNER menuza_app;
```

Preencha `DATABASE_URL`, `TEST_DATABASE_URL` e `JWT_SECRET` em `backend/.env`. Gere o secret com `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Não versione o arquivo. Senhas na URL devem usar percent-encoding.

```bash
npm run migrate
# Opcional, apenas demonstrações; configure SEED_ADMIN_PASSWORD antes:
npm run seed
# Configure SUPERADMIN_EMAIL e SUPERADMIN_PASSWORD fortes para o primeiro acesso:
npm run superadmin:create
npm start
```

Remova `SUPERADMIN_PASSWORD` do ambiente depois de criar a conta. O provisionamento não sobrescreve e-mail existente. Seed não apaga pedidos nem redefine senhas. Novos demos recebem avaliação de 14 dias, sem recebimentos fictícios. Lojas antigas também recebem avaliação na migração: revise seus contratos antes de publicar.

| Área                     | Endereço local                                        |
| ------------------------ | ----------------------------------------------------- |
| Institucional            | http://localhost:3000/                                |
| Proprietário da Menuza   | http://localhost:3000/superadmin                      |
| Administrador de loja    | http://localhost:3000/admin                           |
| Demos, se seed executado | http://localhost:3000/hamburgueria-demo e /doces-demo |
| Saúde do banco           | http://localhost:3000/health                          |

Demos usam `admin@hamburguer.demo` e `admin@doces.demo` com `SEED_ADMIN_PASSWORD` definido no momento da criação. Contas de clientes são criadas pelo superadmin. Não há senha padrão de superadmin. `localhost` é somente ambiente de desenvolvimento.

Para iniciar uma instalação já configurada (sem seed ou recriação de contas):

```bash
nvm use
npm start
```

Ao atualizar o backend, encerre a instância anterior com Ctrl+C no terminal dela antes de iniciar novamente. `npm start` mantém o código carregado em memória; para desenvolvimento com recarga automática use `npm run dev`. A inicialização informa PID e URLs dos dois painéis. Se a porta estiver ocupada, a nova instância falha com diagnóstico e não executa a rotina de cobrança.

Se `/superadmin` mostrar um cardápio, confira o processo na porta 3000 com `ss -ltnp 'sport = :3000'`: uma instância anterior à adição da rota interpreta `superadmin` como slug de loja. Reinicie essa instância a partir deste diretório. O login da plataforma usa `/api/superadmin` e cookie `menuza_platform`; o painel da loja usa `/api/admin` e cookie `menuza`, sem compartilhar autenticação.

Para investigar credenciais sem redefinir senhas nem alterar dados, execute com Node 24 ou superior:

```bash
npm run auth:check -- cortesbrsail67@gmail.com
# Administrador de loja:
npm run auth:check -- email-da-loja@example.com STORE_ADMIN
```

A senha é solicitada com entrada oculta no terminal; não a passe por argumento, pipe ou mensagem. O comando usa a mesma configuração, validação, consulta de usuário e comparação bcrypt do login. Exibe somente banco/servidor/porta e resultados booleanos, sem hashes, senhas ou URL de conexão. Usa uma transação somente de leitura e não cria sessões. `senha_confere: true` confirma a comparação local, mas não testa o servidor HTTP em outro processo ou ambiente. Variáveis já exportadas no processo prevalecem sobre `backend/.env`; o caminho desse arquivo é independente do diretório de execução.

O teste `npx jest --runInBand backend/tests/sessions.test.js` verifica as duas rotas HTTP com PostgreSQL e bcrypt reais, cookies, autenticação de sessão, logout, isolamento de papéis e bloqueios. Exige `TEST_DATABASE_URL` separado terminado em `_test` e usa apenas tabelas temporárias com rollback, sem seeds ou migrations.

## Variáveis

| Variável                                                                                    | Finalidade                                                                        |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                              | PostgreSQL persistente da aplicação                                               |
| `JWT_SECRET`                                                                                | Secret aleatório, pelo menos 32 caracteres                                        |
| `APP_ORIGIN`                                                                                | Origem exata, sem barra final; HTTPS público obrigatório em produção              |
| `NODE_ENV`                                                                                  | `development`, `test` ou `production`                                             |
| `HOST`, `PORT`                                                                              | Bind; padrões 127.0.0.1 e 3000; containers usam HOST=0.0.0.0                      |
| `TRUST_PROXY`                                                                               | IPs/redes de proxies confiáveis ou quantidade de saltos explicitamente homologada |
| `UPLOAD_DIR`                                                                                | Pasta de desenvolvimento; padrão backend/uploads                                  |
| `IMAGE_STORAGE`                                                                             | `local` no desenvolvimento; `cloudinary` obrigatório em produção                  |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_PREFIX` | Storage permanente; credenciais somente no backend                                |
| `BILLING_ENABLED`                                                                           | Manter `false` durante a homologação                                              |
| `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`                                                   | Somente provisionamento inicial                                                   |
| `SEED_ADMIN_PASSWORD`                                                                       | Criação dos demos, mínimo 12 caracteres e até 72 bytes                            |
| `TEST_DATABASE_URL`                                                                         | Banco separado e descartável terminado em `_test`                                 |
| `CHROME_PATH`                                                                               | Chrome para QA; padrão /usr/bin/google-chrome                                     |
| `BILLING_WEBHOOK_URL`, `BILLING_WEBHOOK_TOKEN`                                              | Integração HTTPS opcional de lembretes                                            |
| `BACKUP_DIR`, `PG_DUMP_BIN`, `PG_RESTORE_BIN`                                               | Backup/restauração; binaries padrão pg_dump/pg_restore                            |
| `RESTORE_FROM`, `RESTORE_DATABASE_URL`, `RESTORE_UPLOAD_DIR`, `RESTORE_CONFIRM`             | Restauração em destinos vazios, confirmação pelo nome do banco                    |

O `.env.example` contém exemplos sem credenciais válidas. Use conexão direta do Neon com `sslmode=verify-full` em produção; PgBouncer transacional é incompatível com as travas de sessão da cobrança. Não use `_test` em produção. Configure a origem e o proxy conforme o domínio real. Comece com uma instância por causa dos rate limits em memória. A integração Cloudinary exige homologação real antes da publicação; testes simulados não comprovam acesso à conta.

## Operação

O proprietário cadastra um estabelecimento, informa acesso, plano, valor e vencimento e compartilha o link gerado. A loja nasce fechada; o administrador cadastra categorias/produtos e configura atendimento antes de abrir. Não é preciso informar tenant em nenhuma chamada administrativa.

PIX só é registrado após conferir o crédito. O pagamento confirmado exige referência única e próximo vencimento explícito. A política padrão é pendência no vencimento, lembrete/atraso em três dias e suspensão em sete. Suspensão manual tem precedência e requer reativação explícita. Arquivar preserva pedidos e financeiro.

```bash
npm run billing:run
npm run backup
# Só com destinos vazios e variáveis RESTORE_* configuradas:
npm run restore
```

A rotina também roda no servidor ao iniciar e a cada 15 minutos. Bloqueio é verificado online independentemente do cron. Lembretes não são enviados sem o webhook configurado.

Leia o [guia do proprietário](docs/GUIA_PROPRIETARIO.md) para o passo a passo completo.

## Testes

```bash
npm test
npm run test:browser:saas
```

`npm test` aplica migrations e **limpa o banco descartável de testes** antes de criar fixtures. Nunca execute contra base comercial. A suíte testa PostgreSQL real, não mocks de persistência. O teste SaaS abre seu próprio servidor/Chrome no banco `_test` e cria dados identificados de QA. Não registra recebimentos em desenvolvimento/produção nem envia WhatsApp real.

Para regressão das fixtures originais e backup, o administrador do banco deve criar destinos adicionais:

```sql
CREATE DATABASE menuza_legacy_test OWNER menuza_app;
CREATE DATABASE menuza_restore_test OWNER menuza_app;
```

```bash
npm run test:browser:regression
npm run test:backup
```

O banco de restauração deve estar vazio; uma nova execução sobre destino populado é recusada. O teste de regressão usa `menuza_legacy_test`, renova apenas a senha das fixtures desse banco e mantém os asserts do teste original. `npm run test:browser` continua disponível contra a base de desenvolvimento e pressupõe os produtos/preços originais do seed: não rode em lojas personalizadas ou produção.

Há screenshots em `/tmp/menuza-*.png`. Não execute testes que escrevem no mesmo banco simultaneamente. Resultados e limites: [docs/VALIDACAO.md](docs/VALIDACAO.md).

## Documentação

- [Auditoria e etapas](docs/AUDITORIA.md)
- [Arquitetura](docs/ARQUITETURA.md)
- [Decisões e limitações](docs/decisoes.md)
- [API](docs/API.md)
- [Guia do proprietário](docs/GUIA_PROPRIETARIO.md)
- [Publicação, custos, backups e operação](docs/PUBLICACAO.md)
- [Validação](docs/VALIDACAO.md)

As mensagens padronizadas, status “Pedido pronto”, histórico com funcionário e abertura manual de notificações estão descritos em [Pedidos e WhatsApp](docs/PEDIDOS_WHATSAPP.md), incluindo a migration 005 e o roteiro de homologação.
