# Decisões técnicas

## Stack e distribuição

Foi mantida a stack solicitada: Express, PostgreSQL com `pg`, HTML/CSS/JavaScript puro e bcrypt. Não há ORM, framework de interface, build de frontend ou dependência de CDN. O Node 26 do nvm é registrado em `.nvmrc`; Node 24+ atende às dependências.

O servidor também entrega os arquivos estáticos. Isso permite cookies na mesma origem, uma instalação e um processo. O sistema foi implementado no checkout existente para execução local; não foi convertido para hospedagem Sites/Cloudflare, que alteraria o ambiente PostgreSQL/Express solicitado.

## Identidade e isolamento

JWT com algoritmo HS256 fixo, emissor validado e validade de 8 horas em cookie httpOnly e SameSite Strict. Em produção o cookie usa Secure. Escolhemos cookie para evitar expor a credencial ao JavaScript da interface. A assinatura não substitui autorização: a cada requisição verificamos usuário e estabelecimento no banco.

Não há cadastro público ou administração de usuários nesta etapa. O seed cria dois usuários, com senha fornecida por variável de ambiente. E-mails são únicos globalmente para dispensar escolher uma loja no login. A consulta de login por e-mail é a etapa que descobre o tenant.

Logout remove o cookie. Tokens já copiados não têm lista de revogação e expiram em até 8 horas. Trocar `JWT_SECRET` invalida todos eles. Uma futura gestão de usuários poderá acrescentar versão de sessão, troca de senha e recuperação de acesso.

## Banco e dinheiro

Migrations SQL em ordem, com transação e trava consultiva; `bigserial`, `timestamptz` e constraints compatíveis com PostgreSQL 12. IDs são retornados pelo `pg` como strings para preservar precisão. Entradas de ID aceitam apenas números inteiros seguros ou dígitos, sem coerção de booleanos.

Valores são inteiros em centavos. Não usamos ponto flutuante para somar pedidos. A conversão do texto de preço separa reais e centavos. O valor máximo por pedido é R$ 100.000,00, e a API limita itens e quantidades para evitar abuso.

O contador está na linha do estabelecimento. `FOR UPDATE` dentro da transação serializa a numeração daquela loja e evita o erro clássico de fazer `MAX(numero)+1`. Pedidos cancelados mantêm o número; falhas de gravação não consomem número.

Itens e adicionais possuem cópias de nomes/preços. Pedidos também copiam dados do cliente. A tabela `clientes` reúne o contato mais recente por telefone e loja. O histórico permanece fiel às compras anteriores.

## Adicionais e exclusão

Um grupo se aplica a um produto OU a uma categoria, com exclusividade garantida por constraint. Grupos têm limites mínimo/máximo. Cada opção aparece no máximo uma vez por item; para pedir combinações diferentes, o cliente adiciona o mesmo produto novamente ao carrinho. A quantidade do produto multiplica seus adicionais.

Exclusão pelo painel é lógica (`ativo=false`), preservando o histórico. A tela permite reativar pela edição. Grupos obrigatórios sem opções ativas suficientes tornam o pedido inválido; o gestor precisa manter os limites coerentes ao editar opções.

## Upload e interface

Multer usa memória com limite de um arquivo de 2 MB por requisição. Aceitamos PNG, JPEG e WebP, verificamos o MIME declarado e a assinatura binária. SVG/HTML não são aceitos. Os arquivos recebem UUID aleatório; nomes originais não controlam caminhos. A pasta tem política de conteúdo restritiva e `nosniff`.

A verificação de assinatura não é uma decodificação completa ou antivírus. Para uma operação pública de maior escala, considere normalização da imagem, limite de dimensões e armazenamento de objetos. Uploads são públicos para exibir cardápios; não devem receber documentos pessoais. Arquivos antigos não são removidos automaticamente.

Não há `innerHTML` para dados variáveis. A paleta original foi preservada e o contraste dos botões do cardápio se adapta à cor configurada. O catálogo inicial usa uma ilustração local; fotos e logo são enviados pela loja.

## Proteções HTTP

Helmet, JSON de até 64 KB, validação Zod, CORS limitado à origem configurada e rejeição de requisições browser cross-site. Cookies SameSite Strict e checagem de Origin/Fetch Metadata protegem as mutações contra chamadas externas de navegador. Não se permite CORS genérico com credenciais.

Login: até 10 tentativas por IP em 15 minutos. Pedidos: até 20 requisições por IP por minuto. Upload: até 20 por minuto. Os limites incluem entradas inválidas. Não confiamos em `X-Forwarded-For` recebido da internet. Proxy confiável e armazenamento compartilhado de rate limit devem ser configurados conscientemente ao escalar a instalação.

## Operação e evolução

O dashboard usa o dia em America/Sao_Paulo. Pedidos não cancelados contam para o valor vendido, mesmo pendentes; não há confirmação bancária. O painel atualiza por ação explícita e mostra até 200 pedidos por filtro. Paginação e atualização em tempo real ficam como evolução.

O WhatsApp é uma URL de conversa, gerada no servidor a partir do pedido persistido. Não há confirmação de envio/leitura nem integração oficial. Não há pagamento online. Cliques repetidos são bloqueados na tela durante a gravação, mas a API não oferece chave de idempotência: reenviar uma requisição concluída cria outro pedido.

Abre/fecha é manual; horários são informativos. O checkout coleta o necessário e informa o compartilhamento com WhatsApp. Retenção e anonimização dependem de procedimento da loja; não criamos coleta adicional para funcionalidades futuras.

PDV, comandas, impressão, cozinha, cupons, fidelidade, domínio próprio e mensalidades não foram implementados. A camada de serviços, os IDs globais, o tenant obrigatório, o histórico e as migrations permitem acrescentar novas tabelas e fluxos sem alterar pedidos históricos. Evitamos criar tabelas vazias ou recursos sem uso.
