# Hotmart México: pagamento aprovado → disparo da música

O MiniFluxo usa o Webhook de Eventos de Pedido **v2.0.0** da Hotmart. Ele aceita apenas `PURCHASE_APPROVED` com `purchase.status = APPROVED` e valida o header `X-HOTMART-HOTTOK`.

## URLs

| Etapa | Endpoint |
| --- | --- |
| Registrar letra antes de abrir checkout | `POST https://minifluxo.vercel.app/api/webhooks/hotmart/checkout` |
| Receber pagamento Hotmart | `POST https://minifluxo.vercel.app/api/webhooks/hotmart` |

## 1. Site México: registrar a letra

Antes de redirecionar ao checkout, o backend do site deve enviar `x-site-secret` e os dados do quiz ao endpoint `hotmart/checkout`. A resposta devolve um `sck` único.

```json
{
  "name": "María López",
  "phone": "5512345678",
  "lyric_text": "Letra gerada no quiz...",
  "story": "História usada na canção",
  "quiz": { "estilo": "balada" },
  "integration_key": "CHAVE_DA_INTEGRACAO_DO_SITE"
}
```

Use o valor retornado no checkout Hotmart em `prefilledInfo.sck`. A Hotmart devolve esse mesmo valor em `data.purchase.origin.sck` quando envia o webhook; ele é o vínculo seguro entre a compra e a letra, sem depender de e-mail ou telefone.

## 2. Hotmart

Em **Ferramentas → Webhook**, crie uma configuração para o produto mexicano:

- Versão: **2.0.0**
- URL: `https://minifluxo.vercel.app/api/webhooks/hotmart`
- Evento: **Compra aprovada** (`PURCHASE_APPROVED`)
- Autenticação: copie o Hottok da Hotmart para a variável `HOTMART_HOTTOK` na Vercel.

Também mantenha `PAYMENT_WEBHOOK_SECRET` configurado. Ele é usado internamente pelo MiniFluxo para passar a compra validada ao mesmo motor de pagamento das demais versões do site.

## Comportamento após aprovação

1. O webhook valida o `X-HOTMART-HOTTOK`, o evento, o status, a transação e o `sck`.
2. Marca o pedido como pago uma única vez usando `hotmart:<transaction>` como idempotência.
3. Inicia o template aprovado do WhatsApp.
4. Após qualquer resposta do cliente, o fluxo normal gera e entrega música e vídeo.

Números mexicanos com 10 dígitos são convertidos para o formato WhatsApp `52` + número. A Hotmart normalmente já envia o DDI em `buyer.checkout_phone` para compras fora do Brasil.
