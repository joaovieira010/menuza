# Decisões e limites

## Evolução aditiva

Express 5, PostgreSQL/pg, JWT/bcrypt e frontend sem framework foram mantidos. A skill Sites foi consultada para interface/preview; não houve migração para Cloudflare ou criação de outro projeto. A autorização do usuário exige trabalhar no checkout existente e preparar hospedagem compatível com TCP/PostgreSQL.

As migrations 002–004 acrescentam recursos e constraints. Nenhuma tabela de pedidos foi recriada. Para lojas preexistentes, migração cria contrato em avaliação de 14 dias, a R$ 49,90, sem registrar recebimento. O operador deve revisar valor, plano e vencimento antes da implantação. Slugs `hamburgueria-demo` e `doces-demo` recebem marca de demonstração e não podem ser renomeados pelo painel. Revise essa classificação se esses endereços tiverem sido reutilizados comercialmente.

## Identidade e sessões

SUPERADMIN tem tenant nulo; STORE_ADMIN tem tenant obrigatório. CUSTOMER é o contexto público, sem conta artificial no banco. Cada login cria uma sessão persistida de oito horas e JWT com `jti`. Cookies de loja e plataforma são independentes. Logout, troca de senha da loja e suspensão administrativa revogam sessões. Chave JWT fora do código; HTTPS e cookie Secure obrigatórios em produção. Criar um superadmin é CLI administrativa e nunca cria senha padrão ou sobrescreve conta existente.

Não há MFA ou recuperação de senha por e-mail. O proprietário redefine a senha de uma loja pelo painel. Credenciais globais adicionais podem ser provisionadas via CLI; revogação de uma conta global exige procedimento operacional no banco ou troca da chave JWT. Rate limit usa memória de uma instância e deve migrar para armazenamento compartilhado ao escalar.

## Assinatura e financeiro

Preço de plano e mensalidade contratada são conceitos separados. Reajustar preço de tabela não altera contratos. Recursos e limites do plano são dinâmicos; os três planos iniciais têm todos os recursos ligados, sem limites. O operador escolhe como diferenciá-los.

Estados efetivos são calculados com data do banco no horário de Brasília. Uma assinatura vencida pode operar até o prazo de suspensão, conforme a política. Cancelamento e suspensão manual têm precedência. Alterar vencimento é uma decisão administrativa auditada e não inventa pagamento. Reativar exige vencimento futuro. Pagamento confirmado permite reativação de bloqueio automático; bloqueio manual continua dependendo de decisão explícita.

Recebimentos são manuais, append-only pela API, com referência única e quitação integral do valor contratado. O próximo vencimento é informado explicitamente; evita arredondamentos de fim de mês e não presume quantos meses um valor paga. Não há parcelas, estornos automáticos, emissão fiscal ou gateway. Dados de cartão nunca são coletados. Uma integração futura deverá verificar assinatura/idempotência do evento do provedor e chamar a operação transacional de confirmação, sem confiar no navegador.

Arquivar é exclusão lógica e cancelamento de acesso. Não apaga pedidos, cadastros, pagamentos ou auditoria. Não existe DELETE financeiro/tenant na API. Retenção legal, contratos, política de privacidade e canal de exercício de direitos devem ser definidos pelo operador conforme sua operação; não foi implementado um módulo jurídico/LGPD.

## Cobrança confiável

A rotina tem advisory lock global, transação, log persistido e outbox única por loja/vencimento. Pode rodar no processo, CLI, timer ou botão. A mesma regra é aplicada no acesso online: falha de cron não libera pedidos indevidos. Interrupção de processo pode deixar uma execução incompleta; a próxima concilia o estado e mantém a evidência anterior.

Webhook HTTPS opcional é um adaptador para o serviço de comunicação do operador. Não é WhatsApp oficial. Entrega é pelo menos uma vez e requer deduplicação do receptor. Sem integração configurada há fila, sem envio fictício. Logs não incluem segredo ou corpo de mensagens. Não houve contato real com destinatários nos testes.

## Pedidos e catálogo

Cálculo em centavos e limite de R$ 100 mil por pedido foram preservados. Counter por tenant com `FOR UPDATE` evita numeração duplicada. O mesmo lock serializa checkout, alterações comerciais e limite mensal. Um produto não pode apontar para categoria de outra empresa. Itens e adicionais guardam snapshots históricos.

Idempotência opcional mantém compatibilidade com clientes antigos. O frontend gera UUID e conserva uma tentativa após falha de rede; o backend armazena hash e resposta no commit do pedido. Sem chave, repetição ainda cria novo pedido. O usuário precisa manter os mesmos dados ao repetir; uma alteração com a mesma chave retorna 409. A API não oferece consulta pública de pedidos.

Horários são informativos e abertura é manual. Não há cálculo por distância/bairro, só taxa fixa por loja. Dashboard da loja representa pedidos não cancelados, sem conciliação bancária. Atualização de pedidos é manual. Listas limitadas: pedidos/histórico 200, lojas 500, contatos 200. Paginação, tempo real, PDV, impressão, cozinha, cupons e fidelidade ficam fora desta versão.

## Upload e UX

sharp valida/decodifica imagens reais, rejeita entradas inválidas, limita 20 milhões de pixels, redimensiona a até 2000×2000 e recodifica em WebP sem metadados. Originais não são armazenados. Limite de entrada 2 MB, um arquivo; UUID controla o caminho. URLs de logo/banner/produto só aceitam caminho local conhecido. Upload é público para renderizar cardápio; não deve receber documentos pessoais. Arquivos antigos não são apagados automaticamente.

UI usa criação de elementos/textContent, controles nativos, labels e foco visível. CSS usa preto, violeta e neutros; identidade do tenant é preservada. Testes Chrome desktop/mobile não substituem homologação em Safari/iOS, dispositivos físicos ou auditoria WCAG completa.

## Produção

Uma instância é a topologia inicial suportada. Volume de uploads e banco persistente são obrigatórios. Ambiente de produção recusa origem sem HTTPS/localhost e banco terminado em `_test`. Isso não substitui configurar DNS, proxy, backups externos e monitoramento no provedor. `TRUST_PROXY` deve representar somente os proxies reais; nunca use `true` indiscriminadamente. Confira o IP resolvido e a resistência a X-Forwarded-For forjado na homologação.

Backup inclui dump custom, arquivo de uploads e hashes; restauração recusa destino populado. Timers systemd são modelos para VPS, não serviços já instalados. No Render, habilite recuperação do PostgreSQL pago, snapshots/exportação do volume e cópia fora da conta/host. Docker não inclui o cliente PostgreSQL: rode backup em um host/ferramenta com pg_dump compatível. Nenhuma infraestrutura paga foi criada.
