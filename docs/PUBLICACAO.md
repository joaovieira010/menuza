# Publicação e operação

O manifesto atual usa Render Free, PostgreSQL Neon externo e Cloudinary. Não cria banco Render, disco pago ou tarefa de migration. As 26 imagens foram importadas e verificadas byte a byte no Cloudinary. O serviço Render e o destino Neon ainda precisam ser configurados e homologados; nenhum deploy foi realizado nesta auditoria.

O usuário autorizou explicitamente o PostgreSQL recuperado na porta **55433**, base `menuza_recovered_20261114`, como fonte oficial dos dados da publicação, preservando integralmente a loja da Rayssa. Essa escolha não comprova a origem histórica dos dados. A porta 5432 não é requisito para validar a fonte autorizada; não iniciar bancos antigos para esse fim. Não alterar IDs, slugs, contas, hashes de senha ou contratos existentes. Nunca usar bases de QA como origem comercial.

Para revalidar essa fonte sem migrations, escritas no PostgreSQL, reinício de bancos, sincronização ou deploy:

```bash
PUBLICATION_SOURCE_AUTHORIZATION=recovered-55433 node scripts/publication-revalidate.cjs
```

O procedimento confere os manifestos antigos, lê os dois dumps offline, verifica que todos os registros iniciais continuam presentes e que o estado atual é idêntico ao backup de publicação de três lojas. Também compara esquema, sequências, objetos grandes e todas as imagens. Qualquer divergência interrompe a execução. A evidência de restauração vem do relatório anterior, verificado por SHA-256; não se declara uma nova restauração nesta execução.

Cada execução cria uma pasta privada nova `.local/publication-authorized-55433-*`, com `validation.json`, `SHA256SUMS` e `restored-uploads/`, compatíveis com `scripts/cloudinary-sync.cjs`. O status `VERIFIED` significa que a fonte escolhida pelo usuário foi validada contra esses backups, sem atestar uma origem histórica não verificada. Os relatórios antigos permanecem intactos. A revalidação não substitui a cópia externa privada nem a homologação dos serviços.

## Auditoria para o primeiro deploy — 14/11/2026

O `render.yaml` usa **Node nativo**, com `npm ci --omit=dev` no build e `npm start` na inicialização. O Dockerfile é uma alternativa: usa Node 24, usuário sem privilégios e inicia diretamente `backend/src/server.js`. Ambos escutam em `0.0.0.0`, respeitam `PORT`, têm health check em `/health` e deixam a cobrança automática desativada no primeiro deploy. O manifesto fixa Node 24.22.1 e `autoDeployTrigger: "off"`. Criar um serviço/Blueprint ainda inicia o primeiro deploy; essa criação deve aguardar autorização.

Não há hooks npm de instalação/inicialização, `preDeployCommand`, migration, seed ou criação de usuário automática nesses caminhos. `/health` faz somente `SELECT 1`; não confirma que o esquema ou os dados foram restaurados. A aplicação valida as configurações antes de escutar. Uma desconexão ociosa do pool agora é tratada com log fixo, sem expor detalhes da conexão; origem ausente/inválida tem diagnóstico explícito e sanitizado.

O backend é compatível com PostgreSQL do Neon via `pg`. A configuração local examinada continua apontando para PostgreSQL local. Não houve conexão ao Neon nem consulta às configurações de uma conta Render nesta auditoria. A validação de produção exige conexão direta e `sslmode=verify-full`; não fixa o fornecedor do PostgreSQL no código, preservando a opção VPS.

Variáveis a configurar **no painel do Render**, sem copiar o `.env` local inteiro:

| Variável                                                               | Valor ou providência                                                                      |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `NODE_VERSION`                                                         | `24.22.1`, já definido no manifesto para Node nativo                                      |
| `NODE_ENV`                                                             | `production`                                                                              |
| `HOST`                                                                 | `0.0.0.0`                                                                                 |
| `PORT`                                                                 | Usar a variável fornecida pelo Render                                                     |
| `APP_ORIGIN`                                                           | Origem HTTPS exata acessada pelo navegador, sem barra final nem caminho                   |
| `DATABASE_URL`                                                         | Segredo com a conexão direta do Neon restaurado, sem `-pooler`, com `sslmode=verify-full` |
| `JWT_SECRET`                                                           | Gerado pelo manifesto; manter estável entre deploys                                       |
| `IMAGE_STORAGE`                                                        | `cloudinary`                                                                              |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Mesmas credenciais da importação validada, somente no backend                             |
| `CLOUDINARY_PREFIX`                                                    | `menuza`, conferido como prefixo da importação                                            |
| `BILLING_ENABLED`                                                      | `false` durante a homologação inicial                                                     |
| `TRUST_PROXY`                                                          | Configurar os proxies reais após verificar a topologia do Render                          |

`APP_ORIGIN` é obrigatório: valor ausente ou inválido impede a inicialização; um domínio diferente do acessado causa HTTP 403 nas APIs que recebem `Origin`. Se a primeira homologação usar o endereço `onrender.com`, usar essa origem e atualizar ao adotar domínio próprio. Os frontends acessam `/api` e `/uploads` na mesma origem; não precisam de URL Neon ou Cloudinary. As imagens são servidas pelo backend a partir do Cloudinary, compatíveis com a CSP que permite imagens da própria origem. Os cookies de ambos os painéis usam `HttpOnly`, `Secure` e `SameSite=Strict` em produção.

Procedimento para publicar **após autorização**:

1. Preparar um repositório de publicação sanitizado, com `package-lock.json`, `render.yaml`, backend, frontend e scripts necessários. Excluir segredos, `.local`, backups, uploads e histórico privado. Revisar os arquivos e o histórico antes de enviar. Esta auditoria não fez commit nem push.
2. Provisionar Neon Free e preparar um banco de destino vazio. Guardar suas credenciais em configuração privada de serviço libpq chamada `menuza_neon`, com `sslmode=verify-full`, fora do repositório. Conferir que o serviço aponta para o destino novo. A restauração é uma etapa separada que escreve no destino e precisa de autorização; não foi executada nesta auditoria.
3. Reconferir os hashes do backup autorizado e, na máquina autorizada com cliente PostgreSQL compatível, restaurar o dump preservando registros, IDs e hashes existentes:

   ```bash
   (cd .local/publication-Be8grd && sha256sum --check SHA256SUMS)
   pg_restore --dbname='service=menuza_neon' --no-owner --no-acl --exit-on-error --single-transaction .local/publication-Be8grd/database.dump
   ```

   A configuração privada libpq deve fornecer também a autenticação do destino; não passar credenciais literais no comando. Antes de avançar, comparar esquema, seis migrations aplicadas, 21 tabelas, sequências, objetos grandes, todos os registros e hashes de senha com a evidência autorizada. Preservar as três lojas e a loja da Rayssa. Conferir referências às 26 imagens já importadas. Uma divergência bloqueia a publicação até investigação. Não há motivo identificado nesta auditoria para aplicar migrations adicionais.

4. No Render, escolher **New → Web Service**, conectar o repositório sanitizado, selecionar runtime **Node**, raiz do projeto, plano **Free**, build `npm ci --omit=dev`, start `npm start` e health check `/health`. Deixar Pre-Deploy Command vazio e Auto-Deploy desativado. Alternativamente, usar o Blueprint `render.yaml`, que declara esses comandos e variáveis. O manifesto não utiliza o Dockerfile.
5. Antes de confirmar a criação, preencher as variáveis da tabela e definir a origem HTTPS de homologação. Após a criação, conferir o endereço atribuído pelo Render e ajustar `APP_ORIGIN` se necessário, antes de testar login ou liberar tráfego. Manter webhooks de cobrança ausentes. Configurar `TRUST_PROXY` conforme os proxies efetivos e verificar cabeçalhos forjados na homologação.
6. Confirmar a criação/deploy somente quando o destino Neon estiver validado. Acompanhar o build e o processo; `/health` deve responder 200. Verificar pelo navegador `/`, `/superadmin`, `/admin`, cada slug real e logo/banner/produtos. Testar login real com o proprietário somente em uma homologação autorizada: o login cria sessão no banco. Nesta auditoria, autenticação e imagens foram testadas com serviços simulados.
7. Verificar imagens após reiniciar/reimplantar, cookies HTTPS, isolamento das lojas, origem e rate limit. Testes de escrita devem usar ambiente separado e lojas sintéticas. Concluir backups externos e monitoramento antes de liberar tráfego comercial. Planejar o corte para haver um único ambiente aceitando novas gravações.

Passaram 49 testes isolados em sete suítes, cobrindo configuração, inicialização sem banco, health check, rotas, autenticação, imagens e home. Os testes desta auditoria não acessam PostgreSQL ou Cloudinary reais. O build Docker/Node 24 e a validação remota do Blueprint na conta Render continuam pendentes; a execução local dos testes usa Node 26.13.0. Referências consultadas: [Blueprint](https://render.com/docs/blueprint-spec), [versão do Node](https://render.com/docs/node-version), [Web Services](https://render.com/docs/web-services), [Node com Neon](https://neon.com/docs/guides/node) e [pool PostgreSQL](https://node-postgres.com/features/pooling).

## Render: caminho inicial

1. Autentique as contas Render, Neon e Cloudinary nos planos Free. Não contratar upgrades nem recursos pagos. Prepare uma versão sanitizada do código, excluindo `.env`, cópias de configuração, backups, uploads, `.local` e histórico privado. O repositório remoto existente é público; nenhum dado ou segredo deve ser enviado a ele.
2. Identifique a origem sem ambiguidade, crie backup completo e uma cópia adicional privada fora do projeto e de `/tmp`. Restaure em instância nova e confira dados, sequências, esquema, hashes de senha e imagens. O manifesto declara apenas **um Web Service Free**, com frontend e API na mesma origem. Configure Neon Free e Cloudinary Free separadamente.
3. Configure `APP_ORIGIN=https://SEU_DOMINIO` sem barra final. Cadastre o domínio personalizado no serviço e aplique os registros DNS indicados pelo Render. Espere o certificado HTTPS ficar válido. Para homologação inicial, pode usar a origem HTTPS fornecida pelo provedor; atualize a origem ao mudar de domínio.
4. Configure `DATABASE_URL` do Neon **direto**, sem `-pooler`, com `sslmode=verify-full`; `JWT_SECRET` exclusivo gerado no host; `NODE_ENV=production`; `HOST=0.0.0.0`; `IMAGE_STORAGE=cloudinary`; as três credenciais `CLOUDINARY_*` somente no backend; `CLOUDINARY_PREFIX=menuza`; `BILLING_ENABLED=false`. Deixe os webhooks ausentes. Use a porta injetada pelo provedor. A aplicação recusa produção com storage local ou TLS incompleto.
5. Restaure o dump no banco novo vazio. Confira as seis migrations e compare o esquema; execute somente pendências necessárias no destino. Nunca migrar a origem local. Importe todas as imagens preservando nomes e bytes, sem sobrescrita; verifique cada leitura por SHA-256. `scripts/cloudinary-sync.cjs` exige relatório restaurado com `source_selection_status=VERIFIED`; relatórios bloqueados não liberam importação. `npm ci --omit=dev` instala o runtime; `npm start` não executa migrations.
6. Configure **somente os proxies reais** em `TRUST_PROXY`, que fica sem valor predefinido no manifesto. Homologue o IP resolvido no ambiente e teste cabeçalhos `X-Forwarded-For` forjados antes de abrir tráfego. Se a topologia exigir contagem de saltos, `TRUST_PROXY=1` é aceito somente após verificar que não existe caminho mais curto. Não use `true` indiscriminadamente. Veja a [orientação do Express](https://expressjs.com/en/guide/behind-proxies/).
7. Preserve os usuários e hashes restaurados. Não recrie superadmin ou administradores existentes, nem redefina senhas. Render Free não oferece shell administrativo; importações e tarefas controladas devem ocorrer em uma máquina autorizada antes de liberar tráfego.
8. Não execute seeds de demonstração na base real. Não reutilize slugs, marque lojas reais como demonstração ou altere contratos para fazer um teste passar. Testes de escrita e de vencimento devem usar lojas sintéticas em banco separado.
9. Acesse `/superadmin`, configure planos/política, crie uma loja de homologação, configure-a em `/admin`, abra o cardápio e conclua um pedido identificado. Confira o banco, o painel, o cálculo, o link WhatsApp e a preservação depois de suspender/reativar.
10. Configure backups externos privados de PostgreSQL e Cloudinary, retenção e alertas. Valide HTTPS, cookies, login real com o proprietário, imagens após reinício e novo deploy. Só faça o corte após resolver qualquer incerteza de origem e completar a homologação. Não aceitar novas gravações em dois ambientes simultaneamente.

O [formato Blueprint](https://render.com/docs/blueprint-spec) foi consultado, mas o manifesto não foi aplicado/validado em uma conta Render nesta entrega. Disponibilidade de planos/região e topologia do proxy precisam ser conferidas na contratação.

## VPS compatível

Use Linux, Node 24+ (a validação local foi com Node 26), PostgreSQL persistente em versão suportada pelo fornecedor e cliente `pg_dump` de versão igual ou maior que o servidor. O código mantém compatibilidade SQL com o PostgreSQL 12 local, mas não use uma versão sem suporte de segurança em nova produção.

Instale o checkout em `/opt/menuza`, crie usuário de sistema sem privilégios `menuza` e diretório privado de backups. Use `npm ci --omit=dev`. Guarde variáveis em `/etc/menuza.env`, com permissão restrita. Configure `HOST=127.0.0.1`, `TRUST_PROXY=loopback`, origem HTTPS, Cloudinary e conexão direta do banco com TLS validado. A versão atual exige Cloudinary em produção, inclusive em VPS.

Os arquivos em `deploy/` são modelos: ajuste caminhos do Node e usuário ao host, instale o serviço systemd, habilite os timers de backup/cobrança e revise logs com `journalctl`. O servidor já concilia assinaturas a cada 15 minutos; o timer é redundância segura pelo lock no PostgreSQL.

`deploy/Caddyfile` usa o domínio em `MENUZA_DOMAIN`, proxy local e HTTPS automático. Aponte DNS ao host e libere somente HTTP/HTTPS e o acesso administrativo necessário. Não exponha PostgreSQL ou a porta Node à internet. Banco/usuário devem ter senha forte e conexão interna/privada.

## Docker

`Dockerfile` instala runtime em Node 24 e executa como usuário sem privilégios. Passe as variáveis por secrets/env do provedor, incluindo Cloudinary; não depender de volume de uploads. Migrations somente se estritamente necessárias no destino novo, como tarefa controlada; o CMD inicia apenas o servidor. Coloque HTTPS/proxy na frente.

O container não inclui pg_dump, tar de backup agendado ou PostgreSQL. Use ferramentas do host/job com cliente compatível e acesso ao volume. Build e implantação Docker não foram executados neste ambiente; valide-os no seu CI antes de usar essa alternativa.

## Backup e restauração

`npm run backup` exige `BACKUP_DIR`, `DATABASE_URL`, `pg_dump` e `tar`. Com `IMAGE_STORAGE=cloudinary`, exporta todos os assets do prefixo por paginação da API administrativa e preserva os bytes em `uploads.tar.gz`; o manifesto inclui hashes individuais. Credenciais ficam somente no ambiente do executor. Sem Cloudinary, usa `UPLOAD_DIR` no desenvolvimento. Cria pasta privada com `database.dump`, `uploads.tar.gz` e `manifest.json` contendo SHA-256. Backups interrompidos recebem `FAILED` e não devem ser usados. Não inclui senhas/env no manifesto. Para libpq com `sslmode=verify-full`, configure `PGSSLROOTCERT` com um bundle CA confiável; o script também respeita `sslrootcert` da URL. Render Free não é destino de backup: seu disco é efêmero.

No VPS, `menuza-backup.timer` agenda diariamente às 03h (timezone do host), com recuperação de execução perdida. Confirme `systemctl list-timers` e o resultado do serviço. **Instalar um modelo no Git não ativa agendamento.** Defina retenção (por exemplo, 7 diários e 4 semanais), capacidade e alertas. Copie para armazenamento externo criptografado e com acesso restrito; o script local não faz essa cópia. Não apague backups antigos antes de verificar o novo e sua cópia externa.

No Render pago, a documentação prevê PITR do PostgreSQL (janela depende do plano) e exportações lógicas. Isso não inclui as imagens da aplicação: mantenha snapshots/exportação do disco e cópia fora do serviço. Consulte [recuperação PostgreSQL](https://render.com/docs/postgresql-backups) e [discos persistentes](https://render.com/docs/disks). O timer systemd não roda no Render.

Para restaurar, crie banco e pasta de uploads vazios. Em ambiente controlado configure:

```dotenv
RESTORE_FROM=/caminho/backup/verificado
RESTORE_DATABASE_URL=conexao_do_novo_banco_vazio
RESTORE_UPLOAD_DIR=/caminho/novo/volume/uploads
RESTORE_CONFIRM=nome_exato_do_novo_banco
```

Execute `npm run restore`. O script valida hashes e recusa banco ou pasta populados; não executa DROP/clean. Após restaurar, confira contagens, health, pedidos históricos e imagens, execute migrations pendentes e só então altere conexão/volume do serviço durante manutenção. Em caso de falha de restauração, prepare outro destino vazio e investigue; não reexecute cegamente sobre resultado parcial.

Foram restaurados o backup validado de 14/11 e uma nova cópia da base local configurada: 21 tabelas, sequências, objetos grandes e 26 imagens conferidos. Registros e hashes originais dos usuários foram preservados. O usuário posteriormente autorizou a fonte recuperada na porta 55433, conforme descrito no início deste documento. A exportação/restauração Cloudinary foi testada com rede simulada; a importação real das 26 imagens também foi concluída e verificada byte a byte. A homologação pública da aplicação continua pendente.

## Cobrança e comunicação

A rotina no servidor roda ao iniciar e a cada 15 minutos; também há `npm run billing:run`, botão no superadmin e timers para VPS. Monitore `execucoes_cobranca`, logs `billing.completed`/`billing.failed` e execuções sem conclusão.

Para lembretes reais, configure seu endpoint **HTTPS** em `BILLING_WEBHOOK_URL` e o secret opcional em `BILLING_WEBHOOK_TOKEN`. O receptor recebe JSON `{id,estabelecimento_id,vencimento,email,telefone,valor}` e cabeçalho `Idempotency-Key: menuza-reminder-ID`; deve autenticar a chamada, deduplicar pela chave, encaminhar pelo seu provedor e retornar 2xx somente após aceitar a entrega. Falhas têm timeout e retry após uma hora. Não configure URL de consumidor/tenant. Endpoint é configuração exclusiva do operador.

Sem webhook não existe envio de lembrete; os eventos permanecem pendentes. Não há WhatsApp Business oficial nem gateway PIX/cartão. A confirmação de mensalidade é manual após conferir a conta bancária. Não armazene dados de cartão em observações.

## Monitoramento e homologação obrigatória

- Monitor externo acessando `GET /health` por HTTPS e alertando falha/503 ao responsável.
- Alertas para erros da aplicação, falha de banco, espaço em disco, backups não concluídos e rotina atrasada. O código emite logs, mas nenhum destinatário de alerta foi configurado.
- Em navegador no domínio final: cookies httpOnly/Secure/SameSite; login nos dois papéis; lojas independentes; troca de IDs recusada; checkout com entrega e retirada; adicionais; total do banco; histórico; upload e imagem após reiniciar/reimplantar; links e layout em celulares.
- Em base de homologação: simular vencimento, três/sete dias, bloquear público e operações no backend, confirmar PIX de teste claramente identificado, validar reativação e persistência dos pedidos. Não simular recebimentos reais na base comercial.
- Reiniciar o processo e testar rotina; confirmar SSL/hostname/CORS e IP do rate limiter; restaurar backup em destino separado; documentar responsável, horário e evidências.
- Definir contrato, suporte, política de privacidade/retenção e dados reais do operador na comunicação comercial antes de coletar clientes.

Sem esses passos não considere a instalação pronta para vender. O Cloudinary já recebeu as 26 imagens; domínio, hospedagem, Neon e monitoramento ainda precisam de configuração e homologação.

## Limitações do orçamento zero

Render Free suspende após 15 minutos sem tráfego, pode levar cerca de um minuto para retomar e tem franquias de horas, banda e builds; o provedor desaconselha produção nesse plano. Neon Free tem franquias de armazenamento, computação e transferência; esgotar computação ou transferência pode impedir inclusive exportações. Cloudinary Free usa créditos compartilhados para armazenamento, transformações e tráfego. O proxy de imagens consome banda no Render e no Cloudinary. Não contratar upgrades; acompanhar consumo e manter cópias externas antes de atingir limites. Conferir [Render Free](https://render.com/docs/free), [Neon](https://neon.com/docs/introduction/plans) e [Cloudinary](https://cloudinary.com/documentation/billing_and_plans) na ativação. Nenhuma garantia de operação comercial contínua foi estabelecida.
