# TikTok — Pix Efí e pagamento aprovado no Minifluxo

Documento de integração da rota `https://musica.memberproduto.shop/tiktok` com o Minifluxo. Atualizado em 03/09/2026.

> Não coloque neste arquivo, no Git, no WhatsApp ou no front-end: Client Secret Efí, certificado P12, senha P12, tokens, chaves da Vercel, secrets do Supabase ou secrets do relay.

## Objetivo

Na versão TikTok, a tela continua com a mesma experiência de Pix do site, mas a cobrança não é criada pela Asaas. O site pede a cobrança ao Minifluxo; o Minifluxo usa as credenciais Efí da conta, devolve QR Code e Pix copia e cola, e recebe a confirmação de pagamento pela Efí. Ao confirmar, ele:

1. marca o pedido correspondente como pago no Supabase do site;
2. dispara, a partir da entrada, o mesmo fluxo selecionado em **Disparos** para pagamento aprovado pelo Asaas: prévia pronta ou geração no Minifluxo;
3. não processa uma segunda vez se a Efí reenviar a notificação.

As demais versões e rotas que usam Asaas não são alteradas.

## Arquitetura

```text
Cliente abre /tiktok e gera o Pix
        |
        v
Site (Supabase Edge Function create-pix)
        | POST assinado
        v
Minifluxo /api/webhooks/site/efi-pix
        | OAuth mTLS + P12
        v
API Pix Efí
        |
        | webhook mTLS de pagamento
        v
Oracle relay -> Minifluxo /api/webhooks/efi
        |                          |
        |                          +--> continua o fluxo WhatsApp
        | POST assinado
        v
Supabase /functions/v1/efi-payment-webhook
        |
        v
Pedido marcado como pago no site
```

## Código do Minifluxo envolvido

| Arquivo | Responsabilidade |
| --- | --- |
| `app/api/webhooks/site/efi-pix/route.js` | Recebe a solicitação do site, inicia/recupera o lead, cria/reutiliza a cobrança Efí e devolve QR Code/Pix. |
| `app/api/webhooks/efi/route.js` | Recebe o evento da Oracle, confirma a cobrança, notifica o Supabase do site e continua o fluxo. |
| `app/api/flow-engine.js` | OAuth mTLS, funções Efí, persistência e execução dos cards do fluxo. |
| `app/api/efi-webhook/route.js` | Registra o webhook da Efí apontando para a Oracle. |
| `docs/EFI_ORACLE_WEBHOOK_OPERATIONS.md` | Operação da Oracle, Nginx, mTLS e diagnóstico do relay. |

## Pré-requisitos obrigatórios no Minifluxo

### 1. Conexão e integração do site

- A conexão WhatsApp escolhida deve estar com status **connected**.
- Deve existir uma `site_integrations.integration_key` usada pelo TikTok e ligada a essa conexão.
- Em `connection_flow_configs`, configure o **Fluxo de pedido vindo do site** (`site_flow_id`).
- Esse fluxo deve estar **active** e pertencer ao mesmo dono da conexão.

### 2. Fluxo no canvas

Use obrigatoriamente o card **Pagamento confirmado** no fluxo de preparação do pedido vindo do site. Depois da aprovação, o Minifluxo inicia o fluxo de pagamento escolhido em **Disparos**, exatamente como no Asaas.

```text
Fluxo de pedido vindo do site
  -> informações/opções do pedido
  -> Pagamento confirmado

Pix Efí aprovado
  -> fluxo de pagamento com prévia pronta OU fluxo de geração no Minifluxo
```

O endpoint Efí identifica esse card para vincular o pedido à cobrança. Quando o pagamento chega, ele escolhe o fluxo de pagamento pela modalidade recebida do site e o inicia desde o começo. Não substitua esse card por Delay.

### 3. Credenciais Efí por conta

No painel Minifluxo, em **APIs**, cadastre para a conta que atende o TikTok:

- Client ID Efí;
- Client Secret Efí;
- certificado `.p12`;
- senha do certificado, se houver;
- chave Pix recebedora;
- ambiente: `production` ou `homologation`.

Escopos recomendados da aplicação Efí: `cob.write`, `cob.read`, `pix.read`, `webhook.write` e `webhook.read`.

O P12 e as credenciais são cifrados por conta. Eles nunca são enviados ao site, Supabase ou cliente.

### 4. Oracle relay e webhook Efí

O webhook da Efí usa mTLS, portanto a Efí não chama diretamente a Vercel. A Oracle recebe a conexão, valida o certificado cliente Efí e repassa o JSON assinado ao Minifluxo.

Na Vercel do Minifluxo:

```env
EFI_WEBHOOK_RELAY_URL=https://<dominio-oracle>
EFI_WEBHOOK_RELAY_SECRET=<segredo igual ao do relay Oracle>
```

Depois de cadastrar credenciais, use **Ativar webhook Efí** no painel. Isso deve registrar na Efí:

```text
PUT /v2/webhook/{CHAVE_PIX}
{ "webhookUrl": "https://<dominio-oracle>/efi" }
```

Reative o webhook se mudar chave Pix, ambiente, certificado, domínio da Oracle ou infraestrutura do relay.

## Variáveis da Vercel do Minifluxo

Além das variáveis normais de Supabase/UazAPI/fluxos, a integração TikTok requer estas em **Production**:

```env
SITE_WEBHOOK_SECRET=<segredo que o site usa em x-site-secret>
EFI_WEBHOOK_RELAY_URL=https://<dominio-oracle>
EFI_WEBHOOK_RELAY_SECRET=<segredo do relay>
EFI_SITE_PAYMENT_WEBHOOK_URL=https://mywafaatlssiphxecuej.supabase.co/functions/v1/efi-payment-webhook
EFI_SITE_PAYMENT_WEBHOOK_SECRET=<segredo compartilhado somente com o Supabase do site>
```

Sempre faça novo deploy de produção no Minifluxo depois de trocar uma variável.

O mesmo valor de `EFI_SITE_PAYMENT_WEBHOOK_SECRET` precisa existir, como secret, no Supabase do site. Ele é transmitido no header `x-efi-site-secret` e não deve ser mostrado ao cliente.

## Solicitação de criação de Pix recebida do site

O site chama:

```http
POST https://minifluxo.vercel.app/api/webhooks/site/efi-pix
Content-Type: application/json
x-site-secret: <SITE_WEBHOOK_SECRET>
```

Payload esperado:

```json
{
  "integration_key": "<chave-da-integracao-do-site>",
  "order_id": "<uuid-do-pedido>",
  "name": "Nome do comprador",
  "phone": "5522...",
  "amount_cents": 1990,
  "quiz": { "music_style": "...", "voice_gender": "..." },
  "story": "História/homenagem enviada pelo cliente",
  "lyric_text": "Letra gerada, quando existir"
}
```

O endpoint valida a integração e o fluxo, cria ou recupera um lead usando `external_order_id`, executa o fluxo até o card de pagamento e cria a cobrança:

```text
PUT /v2/cob/{txid}
```

O `txid` é determinístico a partir do `order_id`, evitando duas cobranças quando o cliente atualiza a página ou pede o Pix de novo.

Resposta usada pela tela:

```json
{
  "order_id": "...",
  "txid": "...",
  "pixPayload": "copia e cola Efí",
  "qrCode": "data:image/png;base64,...",
  "expiresAt": "2026-..."
}
```

## Confirmação de pagamento

Após pagamento, a Efí chama a Oracle. O relay encaminha:

```http
POST https://minifluxo.vercel.app/api/webhooks/efi
Content-Type: application/json
x-efi-relay-secret: <EFI_WEBHOOK_RELAY_SECRET>
```

O payload Efí pode conter `pix: []` ou um pagamento individual com `txid`. Para cada `txid` pendente, o Minifluxo:

1. faz o claim atômico de `efi_pix_charges.status = pending` para `paid`;
2. registra data e payload do pagamento;
3. marca o contexto do lead com `paid: true`;
4. chama o Supabase do site;
5. inicia o fluxo de pagamento configurado em **Disparos**, como ocorre no Asaas.

O callback ao site é:

```http
POST https://mywafaatlssiphxecuej.supabase.co/functions/v1/efi-payment-webhook
Content-Type: application/json
x-efi-site-secret: <EFI_SITE_PAYMENT_WEBHOOK_SECRET>
```

```json
{
  "order_id": "<pedido-do-site>",
  "txid": "<txid-efi>",
  "payment": { "txid": "...", "valor": "19.90" }
}
```

O Supabase atualiza apenas o pedido correspondente. O callback é idempotente por `txid`; uma repetição não libera/entrega novamente.

> Falha temporária ao notificar o site é registrada no log do Minifluxo e não bloqueia a continuidade do fluxo de WhatsApp. Ela deve ser investigada antes de produção em escala.

## Tabelas usadas

| Tabela | Uso |
| --- | --- |
| `account_credentials` | Credenciais Efí cifradas por conta. |
| `site_integrations` | Mapeia `integration_key` para a conexão. |
| `connection_flow_configs` | Define o `site_flow_id`. |
| `leads` | Mantém contexto, `external_order_id`, status e ponto do fluxo. |
| `efi_pix_charges` | Armazena `txid`, valor, expiração, card de pagamento, status e payload. |

## Checklist antes do primeiro teste

- [ ] Credenciais Efí e P12 cadastrados na conta correta do Minifluxo.
- [ ] Ambiente Efí selecionado corretamente.
- [ ] Chave Pix da mesma conta Efí.
- [ ] WhatsApp conectado.
- [ ] `integration_key` TikTok ligada à conexão correta.
- [ ] Fluxo do site ativo, com **Pagamento confirmado** antes da entrega.
- [ ] Relay Oracle online, certificado e segredo conferidos.
- [ ] Webhook Efí ativado pelo painel.
- [ ] As quatro variáveis da seção Vercel configuradas e deploy de produção realizado.
- [ ] `EFI_SITE_PAYMENT_WEBHOOK_SECRET` igual no Minifluxo e no Supabase.

## Como testar

1. Abra `https://musica.memberproduto.shop/tiktok` e faça um pedido de teste até o QR Code.
2. Confirme que o QR Code e o Pix copia e cola vieram da Efí.
3. Confira uma linha `pending` em `efi_pix_charges` com o `txid` criado.
4. Pague no ambiente Efí escolhido.
5. Veja nos logs da Oracle o recebimento e o encaminhamento do webhook.
6. Veja em `/api/webhooks/efi` que o `txid` foi processado uma única vez.
7. Confirme que `efi_pix_charges` ficou `paid`, o pedido no Supabase ficou pago e o fluxo avançou após **Pagamento confirmado**.

### Observação sobre homologação

Na homologação da Efí, valores acima de R$ 10 podem não gerar confirmação automática. A oferta TikTok é R$ 19,90: para validar o webhook automaticamente, use produção com cuidado ou reduza temporariamente o preço de teste para até R$ 10 com autorização explícita.

## Diagnóstico rápido

| Problema | Conferir |
| --- | --- |
| Site não gera QR | `SITE_WEBHOOK_SECRET`, `integration_key`, conexão WhatsApp, fluxo ativo, credenciais Efí/P12 e logs de `/api/webhooks/site/efi-pix`. |
| Efí gera Pix mas não confirma | Webhook ativado, URL Oracle, certificado mTLS, Nginx/relay e `EFI_WEBHOOK_RELAY_SECRET`. |
| Fluxo não avança | Existência do card **Pagamento confirmado**, `node_id` salvo em `efi_pix_charges`, lead e conexão ainda válidos. |
| Site não mostra pagamento aprovado | `EFI_SITE_PAYMENT_WEBHOOK_URL`, segredo compartilhado e logs da Edge Function `efi-payment-webhook` no Supabase. |
| Evento/entrega duplicados | Conferir o mesmo `txid`; a cobrança deve ser reclamada apenas uma vez com status `pending`. |
