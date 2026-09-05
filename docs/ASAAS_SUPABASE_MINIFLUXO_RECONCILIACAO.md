# Integração Asaas, Supabase e Minifluxo

Este documento descreve o padrão para todas as versões do site de música. O objetivo é garantir que um Pix aprovado inicie o fluxo correto no Minifluxo mesmo se o webhook do Asaas atrasar ou falhar.

## Visão geral

```text
Cliente paga Pix
   │
   ├─ Asaas envia PAYMENT_RECEIVED / PAYMENT_CONFIRMED
   │     │
   │     └─ Supabase atualiza o pedido para paid
   │           │
   │           └─ Envia PAYMENT_APPROVED ao Minifluxo
   │                 │
   │                 └─ Fluxo gera ou entrega a música pelo WhatsApp
   │
   └─ Se o webhook não chegar
         │
         └─ Reconciliação consulta o Asaas nos primeiros 10 minutos
               │
               └─ Confirma somente Pix realmente pagos e repete o fluxo oficial
```

O Supabase do site é a fonte de verdade para pedido e pagamento. O Minifluxo recebe apenas o evento de pagamento aprovado e executa a automação de WhatsApp.

## Variáveis de ambiente obrigatórias

Cadastre estas variáveis como secrets das Edge Functions do Supabase do site. Nunca coloque valores reais no frontend, no repositório ou em variáveis `NEXT_PUBLIC_`.

| Variável | Uso |
| --- | --- |
| `ASAAS_API_KEY` | Consulta de pagamentos na API do Asaas. |
| `ASAAS_API_URL` | URL da API do Asaas. Produção: `https://api.asaas.com/v3`. |
| `ASAAS_WEBHOOK_TOKEN` | Token configurado também no webhook do Asaas. |
| `WHATSENTREGAVEL_URL` | URL pública do Minifluxo. |
| `WHATSENTREGAVEL_INTEGRATION_KEY` | Chave fixa da conta/integração do usuário no Minifluxo. |
| `WHATSENTREGAVEL_PAYMENT_SECRET` | Segredo enviado no cabeçalho `x-payment-secret` ao Minifluxo. |
| `SUPABASE_URL` | URL do próprio projeto Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | Uso exclusivo no backend/Edge Functions. |

Cada site/conta deve usar sua própria `WHATSENTREGAVEL_INTEGRATION_KEY`. Nunca reutilize a chave de uma conta para outra.

## Webhook do Asaas

Configure no painel do Asaas a URL:

```text
https://SEU-PROJETO.supabase.co/functions/v1/asaas-webhook
```

No cabeçalho do webhook, envie:

```text
asaas-access-token: valor-de-ASAAS_WEBHOOK_TOKEN
```

Eventos que devem estar habilitados:

- `PAYMENT_RECEIVED`
- `PAYMENT_CONFIRMED`

O webhook deve:

1. Validar o token.
2. Aceitar somente eventos de pagamento confirmado/recebido.
3. Localizar o pedido pelo `externalReference` ou `pixQrCodeId`.
4. Atualizar o pedido de `awaiting_payment` para `paid`, preenchendo `paid_at` e `asaas_payment_id`.
5. Criar uma notificação idempotente com a chave `payment:<order_id>`.
6. Enviar o evento ao endpoint `/api/webhooks/payment` do Minifluxo.

Não envie a música diretamente pelo webhook do site. A entrega deve continuar no Minifluxo, pois é ele que conhece o fluxo, a conexão de WhatsApp e as etapas do canvas.

## Payload mínimo para o Minifluxo

O site deve enviar o evento para o Minifluxo com uma chave de idempotência estável:

```json
{
  "event": "PAYMENT_APPROVED",
  "idempotency_key": "payment:<order_id>",
  "integration_key": "<chave-da-conta>",
  "order_id": "<uuid-do-pedido>",
  "customer": {
    "name": "<nome-do-comprador>",
    "phone": "55<ddd><numero>"
  },
  "quiz": {
    "recipient": "...",
    "honoree": "...",
    "story": "...",
    "music_style": "...",
    "voice_gender": "...",
    "fulfillment_mode": "generate_music_in_miniflux"
  },
  "lyric_text": "<letra, quando existir>",
  "fulfillment": {
    "mode": "generate_music_in_miniflux"
  }
}
```

Para entrega de prévia já pronta, use `fulfillment.mode` igual a `deliver_existing_preview_audio` e envie exatamente duas URLs válidas em `preview.audios`.

## Reconciliação automática de Pix

Além do webhook, mantenha a Edge Function `reconcile-asaas-payments` agendada pelo `pg_cron` e `pg_net`.

Ela consulta a API do Asaas somente para pedidos com QR e status `awaiting_payment`, respeitando este plano por pedido:

| Momento após criar o QR | Tentativas |
| --- | --- |
| Primeiros 2 minutos | 2 tentativas rápidas |
| Aproximadamente 5 minutos | 1 tentativa |
| Aproximadamente 9 minutos | 1 tentativa |
| Após 10 minutos | Nenhuma tentativa automática adicional |

O agendamento roda a cada 30 segundos para permitir as duas verificações rápidas. Cada tentativa deve ser registrada em uma tabela interna, por exemplo `asaas_reconciliation_attempts`, com:

- `order_id`
- `fast_attempts`
- `slow_attempts`
- `next_slow_at`
- `last_checked_at`
- `last_result`
- `last_error`

Quando o Asaas retornar `RECEIVED`, `CONFIRMED` ou `RECEIVED_IN_CASH`, a reconciliação não deve criar um fluxo diretamente. Ela deve reenviar um evento canônico `PAYMENT_RECEIVED` ao `asaas-webhook`. Assim o mesmo controle de idempotência é usado para webhook normal e recuperação.

## Segurança

- Ative RLS em tabelas internas de tentativa e não crie políticas públicas para elas.
- Guarde a chave usada pelo cron no Supabase Vault.
- A Edge Function de reconciliação deve exigir JWT válido.
- O cron chama a função com a chave de publicação armazenada no Vault; não salve a chave no SQL, código ou frontend.
- Nunca marque `paid` por suposição ou por mensagem do cliente. A confirmação automática só pode ocorrer após resposta positiva da API do Asaas.

## Monitoramento e diagnóstico

Mantenha estas tabelas/logs:

- `orders`: status, QR, `paid_at`, `asaas_payment_id`.
- `webhook_events`: eventos recebidos do Asaas.
- `outbound_notifications`: envio para o Minifluxo, tentativas e erro.
- `api_call_logs`: respostas de Edge Functions.
- `asaas_reconciliation_attempts`: tentativas do fallback.

Diagnóstico rápido:

| Situação | Onde investigar |
| --- | --- |
| Pedido aguardando e sem evento em `webhook_events` | Webhook do Asaas ou atraso do provedor; a reconciliação deve consultar o QR. |
| Pedido pago, notificação `failed` | Erro de comunicação site → Minifluxo; reenvie a notificação com a mesma `idempotency_key`. |
| Minifluxo recebeu, mas não entregou | Verifique o lead, a conexão WhatsApp, a tarefa Kie e as etapas do fluxo. |
| UazAPI informa que o número não existe no WhatsApp | Corrija o telefone; não é falha de Pix ou webhook. |

## Checklist para publicar uma nova versão do site

- [ ] Pedido grava `buyer_phone` com DDD e somente dígitos.
- [ ] QR Pix grava `asaas_static_qr_id` no pedido.
- [ ] Webhook do Asaas está configurado com URL e token corretos.
- [ ] Eventos `PAYMENT_RECEIVED` e `PAYMENT_CONFIRMED` estão ativos.
- [ ] `asaas-webhook` está publicado e com secrets configurados.
- [ ] `reconcile-asaas-payments` está publicado, protegido e com cron ativo.
- [ ] Integração do Minifluxo usa a chave da conta correta.
- [ ] Um pagamento de teste confirma o pedido e inicia um único lead no Minifluxo.
- [ ] O fluxo de teste gera/entrega as duas faixas ou a prévia correta.

