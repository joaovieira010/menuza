# Validação da entrega

Execução local em 13/11/2026, com Node 26.13.0, PostgreSQL 12.22, Jest/Supertest e Chrome em modo headless.

## Ambiente usado

O acesso inicial dentro do sandbox não encontrou um banco respondendo. Fora dele, a porta 5432 estava ocupada. A conexão solicitada a `menuza` nessa porta não foi utilizada: não havia senha fornecida nem `backend/.env` no repositório.

Foi criada uma instância isolada de PostgreSQL 12 em `/tmp/menuza-pg`, escutando apenas em `127.0.0.1:55432`. Nela foram criados `menuza` e `menuza_test`, com usuário `menuza_app`. O `.env` local ignorado contém essa conexão e valores aleatórios para JWT e senha dos admins de demonstração; nenhum segredo foi versionado. A instância temporária usa autenticação local de desenvolvimento e não deve ser usada como configuração de produção.

A aplicação roda em `http://localhost:3000`. A base da porta 5432 e seu histórico foram preservados. Para usar essa base, preencha a conexão com a senha em `backend/.env`, ajuste `TEST_DATABASE_URL` para outro banco e siga o README. `/tmp` pode ser removido ao reiniciar o computador; este banco é de demonstração, não armazenamento definitivo.

## Comandos e resultados

| Verificação | Resultado |
| --- | --- |
| `npm install` com Node 26 | Dependências instaladas e lockfile gerado |
| `npm run migrate` | Migration aplicada no PostgreSQL 12 real |
| `npm run seed` | Dois estabelecimentos e admins criados |
| Repetição de migrate/seed | Sem duplicar lojas ou apagar pedidos |
| `npm test` | 2 suítes, 27 testes aprovados |
| `npm start` | Servidor HTTP iniciado na porta 3000 |
| `npm run test:browser` | Fluxo no Chrome aprovado |
| `GET /health` | Conexão com banco verificada pela suíte |
| `git diff --check` | Sem erros de espaços/conflitos |
| `npm audit --omit=dev` | 0 vulnerabilidades reportadas |
| Auditoria completa | 19 alertas de desenvolvimento: 3 baixos, 16 moderados |

## O que os testes provaram

Testes unitários e de integração usam o banco real e verificam:

- Preço, taxa e total recalculados no servidor; preços adulterados são ignorados.
- Adicionais com preços do banco, produtos estrangeiros recusados e rollback sem consumir o número.
- Sequência independente entre lojas e três pedidos concorrentes sem números duplicados.
- Catálogos diferentes; um usuário não edita, remove, vincula ou muda status de registros de outra loja.
- Login válido/inválido, cookie httpOnly/SameSite, painel protegido e logout.
- Quantidade, telefone, endereço, troco, mínimos de adicionais e datas inválidas.
- Loja fechada não recebe pedidos e o usuário não escolhe outro tenant no corpo da requisição.
- CRUD de categorias, produtos, grupos e adicionais, com desativação lógica.
- Transições válidas/inválidas de status e histórico persistido.
- Restrição de origem, arquivo disfarçado, tamanho máximo de upload e tentativas de SQL por parâmetros.
- Limites de login/criação de pedidos com resposta 429, dashboard e health.

O teste no Chrome verificou:

1. Cardápio mobile em 390 × 844, sem rolagem lateral da página.
2. Produto com adicional e observação, carrinho preservado após recarregar e alteração de quantidade.
3. Entrega, endereço, pagamento em dinheiro e troco.
4. Pedido salvo com total esperado de R$ 70,80; conversa `wa.me` aberta somente depois da resposta de criação.
5. Login no painel, visualização do mesmo pedido e passagem por todos os status de entrega até concluído.
6. Upload válido de PNG, criação, edição e desativação de produto pela interface.
7. Configurações salvas, painel mobile sem estouro lateral e logout.
8. Troca para Doces Demo com catálogo e carrinho independentes.
9. Ausência de erros de JavaScript de página durante esse percurso.

A navegação para WhatsApp foi interceptada e respondeu localmente. Não foi enviada mensagem real. Pedidos fictícios “Cliente QA navegador” e produtos de QA desativados ficam na base demo como evidência do fluxo.

Screenshots em `/tmp/menuza-cardapio-mobile.png`, `/tmp/menuza-dashboard.png` e `/tmp/menuza-pedidos.png`. Cardápio mobile e dashboard desktop também foram inspecionados visualmente.

## O que não foi testado

- Conexão com o banco original na porta 5432, pois a senha não foi fornecida.
- WhatsApp real, aplicativo em celular físico, envio/leitura de mensagens ou qualquer pagamento real.
- Safari/iOS, Firefox, leitor de tela ou auditoria completa WCAG. Foram usados labels, foco visível, elementos nativos e alvos de toque adequados, com verificação visual no Chrome.
- Carga alta, falha de energia durante transação, múltiplas instâncias, implantação HTTPS/proxy ou restauração de backup.
- Análise antivírus/decodificação completa de imagens e testes de penetração independentes.

## Limitações conhecidas

A auditoria das ferramentas de desenvolvimento aponta avisos transitivos no Jest, incluindo deepmerge, glob e minimatch. A solução automática sugeria downgrade incompatível do Jest; não foi aplicada com `--force`. Esses pacotes não fazem parte da execução instalada com `npm ci --omit=dev`; devem ser acompanhados ao atualizar as ferramentas.

Fotos do seed são espaços reservados. O gestor deve enviar imagens e trocar o número fictício de WhatsApp. Horários são informativos e a abertura é manual. O painel precisa de atualização explícita e retorna os 200 pedidos mais recentes do filtro. Não há idempotência de requisições repetidas, recuperação de senha, revogação individual de JWT, pagamento online nem envio automático via WhatsApp. A pasta de uploads não remove arquivos antigos automaticamente.

Esses limites e a operação de produção estão detalhados em `docs/decisoes.md` e no README.
