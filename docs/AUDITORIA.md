# Auditoria e escopo da evolução SaaS

Auditoria do checkout em 13/11/2026. Foram lidos README, arquitetura, decisões, contrato da API e validação; migrations, conexão, seed, configuração, servidor, middlewares, rotas, controllers, cálculo/gravação de pedidos, telas e testes foram confrontados com esses textos.

## Base encontrada

A aplicação já possuía duas lojas demo, slug único, CRUD por tenant, FKs compostas, catálogo, adicionais, checkout, transação com contador por estabelecimento, snapshots de nomes/preços, histórico de status, cálculo em centavos, painel de loja, JWT, bcrypt, proteção de origem e testes PostgreSQL/Chrome. Essas funcionalidades foram preservadas.

Não existiam superadmin, papel global, cadastro comercial, planos, assinaturas, pagamentos, rotina de inadimplência, auditoria comercial, revogação individual de sessões nem infraestrutura versionada para publicação. A home apenas abria um slug.

## Problemas corrigidos

- Logout apagava o cookie sem revogar o token: sessões persistidas, verificadas e revogadas no banco.
- Catálogo removia apenas o contador de `SELECT *`: lista explícita de campos públicos evita vazar contatos comerciais adicionados posteriormente.
- Cadastro de tenant pelo seed não criava assinatura: seed agora inclui avaliação explícita, sem pagamentos.
- Possibilidade de duplicar checkout ao repetir após falha de rede: chave UUID por tentativa, hash do conteúdo e resposta persistida na transação.
- Upload checava somente assinatura binária: decodificação com sharp, limite de pixels, recodificação WebP e remoção de metadados.
- Falta de bloqueio por assinatura: decisão online no backend e rotina periódica com trava, auditoria e reprocessamento.
- Demonstrações poderiam inflar MRR: identificação explícita e exclusão dos indicadores comerciais e recebimentos.
- Limite de produtos concorrentes: trigger que serializa o cadastro por estabelecimento.
- Persistência dependia de diretório fixo: `UPLOAD_DIR` configurável, volume no blueprint e guias de backup/restauração.

## Etapas entregues

1. Auditoria e comparação com o código.
2. Migrations aditivas e preservação dos vínculos existentes.
3. Superadmin, lojas, usuários e contatos comerciais.
4. Planos, contratos, pagamentos manuais, bloqueio e rotina de cobrança.
5. Slugs automáticos/editáveis, demos preservados, idempotência e banner.
6. Sessões revogáveis, upload normalizado, UX responsiva e identidade violeta.
7. Integração com PostgreSQL, navegador e restauração real.
8. Configuração Render/Docker/VPS e documentação operacional.

## Limites para a decisão de lançamento

A validação local não é implantação comercial. O PostgreSQL local de desenvolvimento está em `/tmp/menuza-pg`, porta 55432: não é persistência de produção. Hospedagem, DNS, HTTPS, backup externo e alertas precisam ser configurados e homologados antes de vender. Não foram fornecidas contas de serviços externos; não houve publicação nem movimentação de dinheiro real.

Uma instância é o limite operacional desta entrega: rate limit em memória e uploads em volume local. Mais instâncias exigem contadores compartilhados e objetos/arquivos compartilhados. Rotinas de cobrança e sessões já usam PostgreSQL compartilhado. A lista de lojas tem limite de 500, pedidos e históricos de 200; não há paginação nesta versão. Há limite técnico de R$ 100 mil por pedido/valor de mensalidade, preços sempre em centavos.
