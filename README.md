# Menuza

Cardápio digital e gestão de pedidos para pequenos negócios. O cliente monta o pedido pelo celular; a loja recebe um registro no painel e uma mensagem pronta para WhatsApp.

## Funcionalidades

- Cardápios independentes por estabelecimento, busca, categorias e personalização com adicionais.
- Carrinho por loja salvo no navegador, entrega ou retirada e checkout com aviso de privacidade.
- Preços calculados no servidor, numeração sequencial por loja e gravação transacional.
- Painel com login, indicadores do dia, pedidos, histórico e filtros por data/status.
- Cadastro, edição e desativação de categorias, produtos, grupos e adicionais.
- Upload de fotos e logo, configuração de cores, WhatsApp, taxa, horários e abertura manual.
- Isolamento de dados na API e nas chaves estrangeiras do PostgreSQL.

## Stack

Node.js 26 (24+), Express 5, PostgreSQL 12+, driver `pg`, SQL parametrizado, bcrypt e JWT em cookie httpOnly. Interfaces em HTML, CSS e JavaScript puro, sem etapa de build. Jest, Supertest e Chrome/Playwright Core para verificação.

## Instalar e rodar do zero

```bash
git clone https://github.com/joaovieira010/menuza.git
cd menuza
nvm install
nvm use
npm ci
cp backend/.env.example backend/.env
```

Crie o usuário e os bancos no PostgreSQL, se ainda não existirem. O comando `\password` solicita a senha sem colocá-la no histórico do terminal:

```bash
sudo -u postgres psql
```

```sql
CREATE ROLE menuza_app LOGIN;
\password menuza_app
CREATE DATABASE menuza OWNER menuza_app;
CREATE DATABASE menuza_test OWNER menuza_app;
\q
```

Edite `backend/.env`: preencha `DATABASE_URL` com a senha do banco, gere `JWT_SECRET` com `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` e escolha `SEED_ADMIN_PASSWORD` (12 caracteres ou mais; até 72 bytes). Caracteres especiais na senha dentro da URL precisam ser codificados com percent-encoding. Nunca adicione esse arquivo ao Git.

```bash
npm run migrate
npm run seed
npm start
# Durante desenvolvimento, use npm run dev no lugar de npm start.
```

Acesse:

| Destino                  | Endereço local                          |
| ------------------------ | --------------------------------------- |
| Cardápio de lanches      | http://localhost:3000/hamburgueria-demo |
| Cardápio de doces        | http://localhost:3000/doces-demo        |
| Painel                   | http://localhost:3000/admin             |
| Verificação de banco/API | http://localhost:3000/health            |

Use o host exato de `APP_ORIGIN` no navegador. `localhost` e `127.0.0.1` representam origens diferentes.

### Credenciais do seed

| Loja            | E-mail                  | Senha                                        |
| --------------- | ----------------------- | -------------------------------------------- |
| Hamburguer Demo | `admin@hamburguer.demo` | Valor de `SEED_ADMIN_PASSWORD` no seu `.env` |
| Doces Demo      | `admin@doces.demo`      | Valor de `SEED_ADMIN_PASSWORD` no seu `.env` |

Nenhuma senha padrão fica no código. O seed pode ser executado novamente: pula lojas existentes e preserva pedidos e credenciais. Alterar `SEED_ADMIN_PASSWORD` depois não muda usuários já criados. As imagens iniciais são ilustrações de espaço reservado; envie fotos reais pelo painel. O WhatsApp do seed é fictício: substitua-o em **Minha loja** antes de usar com clientes.

### Variáveis de ambiente

| Variável              | Uso                                                              |
| --------------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`        | Conexão PostgreSQL da aplicação; obrigatória                     |
| `JWT_SECRET`          | Chave aleatória com pelo menos 32 caracteres; obrigatória        |
| `PORT`                | Porta HTTP; padrão `3000`                                        |
| `APP_ORIGIN`          | Origem exata permitida; padrão `http://localhost:3000`           |
| `NODE_ENV`            | `development` local; `production` habilita cookie Secure e HSTS  |
| `SEED_ADMIN_PASSWORD` | Senha usada apenas ao criar os admins demo                       |
| `TEST_DATABASE_URL`   | Banco exclusivo e descartável, com nome terminado em `_test`     |
| `CHROME_PATH`         | Executável para QA de navegador; padrão `/usr/bin/google-chrome` |

O servidor escuta em `127.0.0.1`. Em produção, coloque-o atrás de proxy reverso com HTTPS e configure `APP_ORIGIN` com o domínio público. Mantenha `backend/uploads` em volume persistente e faça backup dele junto com o banco. O limitador usa memória do processo: múltiplas instâncias exigirão armazenamento compartilhado e configuração explícita de proxy confiável.

## Testar

No `.env`, configure, por exemplo:

```dotenv
TEST_DATABASE_URL=postgresql://menuza_app:SUA_SENHA@localhost:5432/menuza_test
```

```bash
npm test
```

**A suíte de integração limpa o banco de testes.** Há proteções para exigir nome terminado em `_test` e uma URL diferente da aplicação. Use exclusivamente um banco descartável. Os testes usam PostgreSQL real, aplicam migrations, recriam os demos e geram uma senha efêmera própria. Não dependem de mocks para provar o isolamento e a concorrência.

Com a aplicação rodando e o Chrome instalado:

```bash
npm run test:browser
```

O teste de navegador usa os demos e a senha de seed do `.env`, cria um pedido fictício, conclui esse pedido e cadastra/desativa um produto de QA. Use uma base de desenvolvimento. Intercepta `wa.me`, sem enviar mensagens; screenshots ficam em `/tmp/menuza-*.png`. O teste assume os preços originais do seed e a loja aberta. Os pedidos fictícios permanecem identificados no painel.

O relatório da execução desta entrega está em [docs/VALIDACAO.md](docs/VALIDACAO.md).

## Como usar o painel

1. Entre com o usuário da sua loja. Abra **Minha loja** para cadastrar WhatsApp, logo, informações e taxa.
2. Cadastre categorias e produtos. Preços na tela são em reais; o banco usa centavos.
3. Em **Adicionais**, crie um grupo vinculado a produto ou categoria e depois suas opções. Mínimo `0` torna o grupo opcional; para grupos obrigatórios, cadastre opções ativas suficientes.
4. Compartilhe o link **Abrir meu cardápio**. A chave do carrinho é separada por loja.
5. Em **Pedidos**, avance os status. Retirada pula “Saiu para entrega”. Cancelamentos e conclusões são finais. O histórico preserva nome, telefone, preços e observações do momento da compra.
6. Atualize a lista para receber novos pedidos; filtre datas e status para consultar o histórico. São exibidos os 200 pedidos mais recentes do filtro.

Desativar preserva o histórico. Para reativar, edite o registro e marque **Ativo no cardápio**. Categorias desativadas também ocultam seus produtos.

## API e documentação

- [Arquitetura e fluxo do pedido](docs/ARQUITETURA.md)
- [Decisões técnicas e limites](docs/decisoes.md)
- [Contrato da API](docs/API.md)
- [Verificações executadas](docs/VALIDACAO.md)

## Roadmap

PDV, comandas, impressão, painel de cozinha, relatórios detalhados, cupons, fidelidade, domínio próprio e mensalidade. Pagamento online e WhatsApp Business oficial são integrações futuras. Nesta versão, a cobrança é externa e o WhatsApp recebe um link de conversa; não existe envio automático pela API oficial.
