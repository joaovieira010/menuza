# Arquitetura Menuza SaaS 1.0

Um servidor Express 5 entrega API e HTML/CSS/JavaScript puro. PostgreSQL guarda tenants, catálogo, pedidos, sessões e financeiro. Não houve substituição de stack, ORM ou reescrita da aplicação.

## Contextos e autorização

- **SUPERADMIN**: usuário global, sem `estabelecimento_id`, cookie `menuza_platform`, API `/api/superadmin`. Cria empresas e contas administrativas; não é um administrador de loja.
- **STORE_ADMIN**: usuário com tenant obrigatório, cookie `menuza`, API `/api/admin`. O identificador vem do usuário consultado no banco, nunca do corpo enviado pelo navegador.
- **CUSTOMER**: acesso público sem conta/senha; resolve tenant pelo slug e pode criar pedidos. Não há consulta pública de dados pessoais de pedidos.

As constraints impedem superadmin vinculado a loja e store admin sem loja. IDs de usuários são globais; e-mails são únicos globalmente. O JWT HS256 de oito horas identifica uma sessão UUID persistida. Cada chamada verifica assinatura, emissor, sessão não expirada, usuário ativo, papel e vínculo. Logout remove a sessão; suspensão administrativa e troca de senha removem sessões da loja. Cookies das duas áreas são separados, httpOnly, SameSite Strict e Secure em produção.

Categorias, produtos, grupos, adicionais, clientes e pedidos têm `estabelecimento_id` e consultas com filtro obrigatório. FKs compostas impedem vínculos cruzados. O catálogo tem whitelist de campos públicos da loja, sem contato comercial, contador ou dados financeiros.

## Cadastro e contratos

Migrations aditivas introduzem `planos`, `assinaturas`, `pagamentos`, `politica_cobranca`, `auditoria_plataforma`, `execucoes_cobranca`, `lembretes_cobranca`, `sessoes` e `interesses_comerciais`. Lojas antigas recebem avaliação de 14 dias; não são fabricados recebimentos. Seed cria assinatura apenas junto com cada demo novo e nunca sobrescreve credenciais existentes.

Cadastro comercial é uma transação: loja, administrador bcrypt, assinatura e auditoria confirmam juntos ou fazem rollback. Slug explícito é validado; geração automática normaliza o nome e acrescenta sufixo aleatório. A constraint UNIQUE é a garantia final. Demos têm marca própria e slugs preservados. Alterar slug mantém o mesmo tenant e seus pedidos; links antigos de clientes comuns deixam de funcionar (não há aliases).

Valor contratado em centavos é um snapshot, separado do preço atual de tabela do plano. Limites/funcionalidades são consultados do plano atual. Produtos ativos têm trigger com trava da loja para limite concorrente; pedidos/mês são contados dentro da transação serializada da loja. Grupos/adicionais e personalização têm autorização no backend. Reduzir um limite não apaga registros existentes.

## Acesso e cobrança

`services/billing.js` centraliza a expressão SQL do estado efetivo usando a data em America/Sao_Paulo. A mesma expressão é usada na leitura online e na conciliação. Ordem de precedência: cancelamento, suspensão manual, suspensão automática por atraso, atraso, pendência, avaliação/ativo. Situação administrativa `suspended` ou `archived` também bloqueia.

A rotina obtém advisory lock de sessão no PostgreSQL, registra início, bloqueia/atualiza assinaturas em transação e grava transições de auditoria. Sobreposição retorna `skipped`; eventos e lembretes por tenant/vencimento não são duplicados. Falha de processo libera o lock; execução incompleta permanece identificável e pode ser reprocessada. Logs não contêm tokens, senha ou payload de pedidos.

Servidor executa no início e a cada 15 minutos; CLI `billing:run`, painel e timer systemd permitem reprocessamento. Reinicializações não anulam o bloqueio, porque o acesso consulta a política em tempo real.

Pagamento manual exige confirmação explícita, data não futura, valor de quitação, referência única por tenant e próximo vencimento posterior ao atual e a hoje. Transação bloqueia loja e assinatura, grava recebimento, avança vencimento e audita. Suspensões manuais não são retiradas implicitamente. Não há cobrança automática, parcelas, estorno ou cartão armazenado. Nenhum gateway foi simulado; a tabela de recebimentos e o serviço são a fronteira para um futuro adaptador que só confirme eventos verificados.

Lembretes são uma outbox com chave única `(estabelecimento_id,vencimento)`. Sem webhook ficam pendentes. Com webhook HTTPS, o worker envia JSON com chave `Idempotency-Key`, timeout e retentativa após uma hora; o receptor precisa deduplicar. Falha entre entrega e confirmação no banco pode repetir a entrega: garantia de pelo menos uma vez. Status "entregue ao provedor" não comprova envio/leitura no WhatsApp ou e-mail. Lembretes de vencimentos já quitados não são enviados.

## Pedido

1. O slug resolve a loja; o backend bloqueia assinatura inválida e loja fechada.
2. Uma transação trava a linha do estabelecimento. Lojas diferentes continuam concorrentes.
3. UUID de idempotência, quando fornecido, identifica a tentativa. Uma repetição com mesmo corpo retorna a resposta persistida; corpo divergente retorna 409. A tela conserva a chave após falha de rede. Clientes antigos sem chave ainda podem criar pedidos, sem essa garantia.
4. Catálogo ativo, grupos, limites e adicionais são validados; preços, taxa, troco e total são calculados em centavos no servidor. Retirada tem taxa zero.
5. Cliente, pedido, itens, adicionais, primeiro status e contador são gravados juntos. Nomes, contatos e preços são snapshots históricos.
6. A resposta e o hash da requisição ficam na mesma transação. Só depois do commit a tela abre `wa.me` com a mensagem completa, incluindo subtotal.
7. Fechar o navegador não remove o pedido. O painel consulta o banco e mantém o fluxo de status existente.

Não há integração oficial do WhatsApp, confirmação bancária do consumidor ou processamento de cartão.

## Interface e persistência

`frontend/superadmin` contém a administração comercial; `frontend/admin` mantém o painel da loja; `frontend/cardapio` mantém compra e checkout; a home apresenta recursos, demos, planos reais do banco e formulário de interesse. Conteúdo variável usa `textContent`.

Uploads usam UUID. sharp decodifica PNG/JPEG/WebP, limita pixels e dimensões e recodifica WebP sem metadados. Não aceita SVG/HTML. Desenvolvimento usa `UPLOAD_DIR`; produção exige `IMAGE_STORAGE=cloudinary`. O backend armazena bytes como assets raw sem sobrescrita e verifica a leitura antes de confirmar sucesso. A rota `/uploads/:name` entrega o conteúdo pela mesma origem, preservando referências, validação e CSP. Não há fallback para disco em produção. Backup exporta todos os assets do prefixo Cloudinary, inclusive os ainda sem referência; restauração exige destinos vazios e hashes válidos.

A topologia inicial é uma instância Node, PostgreSQL persistente com conexão direta e Cloudinary. Rate limits ficam em memória. Migrations têm transação e advisory lock; a cobrança também usa trava de sessão, incompatível com PgBouncer transacional. Migrations não são executadas pelo deploy. Configuração de domínio, TLS, proxy e alertas é descrita em [PUBLICACAO.md](PUBLICACAO.md).
