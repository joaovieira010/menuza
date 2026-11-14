# Publicação e operação

O manifesto atual usa Render Free, PostgreSQL Neon externo e Cloudinary. Não cria banco Render, disco pago ou tarefa de migration. Nenhum serviço foi provisionado nesta execução por falta de autenticação externa. O inventário e as restaurações locais não equivalem à homologação pública.

Antes de qualquer migração, identificar todas as origens e comparar com o backup validado. O cluster do sistema na porta 5432 ainda exige acesso administrativo de leitura; a origem histórica 55432 está desligada. Não escolher uma base por suposição. Não alterar IDs, slugs, contas, hashes de senha ou contratos existentes. Nunca usar bases de QA como origem comercial.

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

Foram restaurados o backup validado de 14/11 e uma nova cópia da base local configurada: 21 tabelas, sequências, objetos grandes e 26 imagens conferidos. Registros e hashes originais dos usuários foram preservados. Isso não resolve o acesso pendente ao cluster 5432 nem comprova a origem definitiva. A exportação/restauração Cloudinary foi testada com rede simulada; a conta real continua pendente de autenticação e homologação.

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

Sem esses passos não considere a instalação pronta para vender. Não há credenciais, domínio, hospedagem ativa, storage externo ou monitoramento real contratados pelo código.

## Limitações do orçamento zero

Render Free suspende após 15 minutos sem tráfego, pode levar cerca de um minuto para retomar e tem franquias de horas, banda e builds; o provedor desaconselha produção nesse plano. Neon Free tem franquias de armazenamento, computação e transferência; esgotar computação ou transferência pode impedir inclusive exportações. Cloudinary Free usa créditos compartilhados para armazenamento, transformações e tráfego. O proxy de imagens consome banda no Render e no Cloudinary. Não contratar upgrades; acompanhar consumo e manter cópias externas antes de atingir limites. Conferir [Render Free](https://render.com/docs/free), [Neon](https://neon.com/docs/introduction/plans) e [Cloudinary](https://cloudinary.com/documentation/billing_and_plans) na ativação. Nenhuma garantia de operação comercial contínua foi estabelecida.
