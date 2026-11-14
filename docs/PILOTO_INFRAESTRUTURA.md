# Infraestrutura gratuita para o piloto da Menuza

> Registro histórico anterior à implementação de Cloudinary. O manifesto e o armazenamento descritos abaixo foram substituídos pelo fluxo atual em [PUBLICACAO.md](PUBLICACAO.md). Não aplicar as instruções históricas como estado atual.

Diagnóstico de 14/11/2026. **CONCLUÍDO**: análise e planejamento. **DEPENDE DE AUTORIZAÇÃO**: provisionamento, conexão de serviços, deploy, DNS e migração da base real. Nenhuma dessas operações foi executada.

## Compatibilidade do projeto

A aplicação Express entrega frontend e API na mesma origem. Os módulos usam `/assets` e `/api`; os cookies exigem mesma origem. Manter tudo em um serviço evita mudar autenticação, CORS e proteção contra requisições de outros sites. Separar frontend em hospedagem estática exigiria proxy da API na mesma origem e homologação dos cookies. Não basta subir a pasta frontend em outro domínio.

O PostgreSQL usa transações, travas, funções, triggers e chaves compostas para isolamento. Deve continuar PostgreSQL. As fotos são arquivos gravados em `UPLOAD_DIR`, não no banco; backend sem disco persistente perde uploads em reinícios. Os limitadores de requisições ficam em memória. Começar com uma instância; múltiplas exigiriam armazenamento compartilhado e revisão dos limitadores.

O `render.yaml` existente contrata planos pagos e disco. **Não é um modelo gratuito** e não foi aplicado ou alterado nesta revisão.

## Alternativas e limitações

| Componente                | Alternativa sem mensalidade inicial                     | Condição para o piloto                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backend e frontend        | Render Free, ambos no Express                           | Suspende após 15 minutos sem tráfego; retorno pode demorar cerca de um minuto. Disco efêmero perde uploads. Adequado para homologação; o provedor desaconselha produção nesse plano. |
| PostgreSQL                | Neon Free                                               | Tem quotas de armazenamento, computação e transferência; conferir limites na conta. Avaliar latência, TLS e conexões da aplicação. Ainda não conectado ou homologado.                |
| PostgreSQL alternativo    | Supabase Free                                           | Pode pausar por baixa atividade após sete dias. Exige cópias externas próprias; não assumir disponibilidade permanente.                                                              |
| PostgreSQL Render Free    | Somente teste descartável                               | Expira após 30 dias; não serve para guardar a única cópia dos pedidos reais.                                                                                                         |
| HTTPS e endereço          | Subdomínio `onrender.com`                               | Render fornece TLS gerenciado gratuito. Configurar `APP_ORIGIN` com a origem final exata.                                                                                            |
| Imagens                   | Armazenamento persistente a definir                     | Render Free não atende o upload atual. Storage externo exige adaptação de upload/leitura, revisão de CSP, acesso e backup. Nenhuma integração criada.                                |
| Backup externo automático | Job em máquina/runner e destino privado do proprietário | Agendar exportação e cópia criptografada do banco e das imagens; definir retenção, credenciais restritas e alertas. O script existente gera backup local; não faz cópia externa.     |
| Monitoramento             | `/health`, logs e um monitor externo a escolher         | Definir destinatário de alertas e verificar limites gratuitos. `/health` confirma banco acessível, não garante migrations ou entrega de mensagens.                                   |

Essas limitações são relevantes para atendimento real: combinar serviços gratuitos não resolve a persistência das fotos no código atual. Para custo recorrente zero, resta uma homologação controlada com infraestrutura já disponível do proprietário ou uma futura adaptação para storage externo autorizado. Não há, nesta revisão, uma instalação gratuita de produção pronta e confiável.

Fontes oficiais consultadas: [Render Free](https://render.com/docs/free), [HTTPS Render](https://render.com/docs/tls), [planos Neon](https://neon.com/docs/introduction/plans), [pausa Supabase](https://supabase.com/docs/guides/platform/free-project-pausing) e [backups Supabase](https://supabase.com/docs/guides/platform/backups). As quotas podem mudar; confirmar no momento da contratação.

## Configuração e segurança antes de publicar

**PENDENTE**: configurar, no gerenciador de segredos do host, `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV=production`, `APP_ORIGIN`, `HOST`, `PORT`, `UPLOAD_DIR` e `TRUST_PROXY` apropriado à topologia. Não substituir as credenciais existentes durante a revisão. Não publicar arquivos `.env` ou suas cópias. A base externa deve exigir TLS com certificado validado; não desabilitar validação de certificado. Usar usuário de banco com privilégios mínimos e restringir acesso administrativo.

**PENDENTE**: revisar privacidade/retenção dos dados de clientes, contato comercial e backups. Não habilitar webhook de cobrança ou qualquer provedor de mensagens sem autorização. O WhatsApp de pedidos e status continua sendo um link com envio manual.

**DEPENDE DE AUTORIZAÇÃO**: após selecionar infraestrutura, preparar homologação separada, restaurar uma cópia autorizada em destino vazio, revisar migrations pendentes, validar imagens após reinício e só então planejar a entrada em operação. Não executar indiscriminadamente migrations antigas sobre a base real sem conhecer seu estado: as migrations anteriores incluem inicialização de assinaturas e marcação de demonstrações.

## Backup e recuperação

**CONCLUÍDO em ambiente descartável**: scripts de backup e restauração preservam contagens, pedidos, financeiro e arquivo de teste; verificam checksum e recusam sobrescrever banco populado. Isso não equivale a um backup da Frutella.

**PENDENTE**: escolher destino externo privado, agendar backup diário fora do serviço efêmero, manter por exemplo sete diários e quatro semanais, alertar falhas e executar restauração periódica em destino vazio. Definir responsável e tempo aceitável de recuperação. Monitor gratuito e cópia externa ainda não estão ativos.

## Ordem de execução após a decisão do proprietário

1. Restabelecer acesso somente leitura ao PostgreSQL real e executar `npm run pilot:check`; conferir o link da Frutella e migrations.
2. Fazer backup verificado do banco e uploads reais, sem modificar o original.
3. Selecionar host, banco persistente, estratégia de imagens e destino de backup; autorizar as conexões necessárias.
4. Homologar em ambiente separado: migrations, restauração, HTTPS, autenticação, isolamento, reinício e imagens.
5. Definir janela controlada para publicar, sem mudar `/frutellagourmet-d9b505e6`.
6. Testar o envio manual no WhatsApp da loja e cliente em celulares reais; monitorar o primeiro atendimento.
