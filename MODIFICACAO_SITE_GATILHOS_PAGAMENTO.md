# Ajuste do site: dois gatilhos de pagamento do WhatsEntregavel

O webhook continua sendo o mesmo:

`POST https://minifluxo.vercel.app/api/webhooks/payment`

Envie sempre o header abaixo. O valor deve ser o mesmo `PAYMENT_WEBHOOK_SECRET` configurado no WhatsEntregavel.

```http
x-payment-secret: SEU_SEGREDO
content-type: application/json
```

Também envie a chave fixa da conta em `integration_key`. Ela é exibida em **Conexões > Integração do seu site** no painel do WhatsEntregavel. Não envie `connection_id`: o sistema resolve o WhatsApp atual dessa conta pela `integration_key`.

## 1. Pagamento de música que já possui prévia pronta

Use este modo quando o cliente ouviu a prévia no site e as duas faixas finais já existem na Kie. No painel, ele aciona o campo **Fluxo para pagamento com música da prévia pronta**.

```json
{
  "event": "PAYMENT_APPROVED",
  "integration_key": "CHAVE_DA_CONTA",
  "order_id": "asaas_pay_123",
  "customer": {
    "name": "Ana Martins",
    "phone": "5511999999999"
  },
  "fulfillment": {
    "mode": "deliver_existing_preview_audio"
  },
  "preview": {
    "task_id": "kie_task_123",
    "audios": [
      "https://arquivo-seguro.com/musica-1.mp3",
      "https://arquivo-seguro.com/musica-2.mp3"
    ]
  }
}
```

Regras:

- `order_id` precisa ser estável e único por pagamento.
- `preview.audios` precisa ter exatamente duas URLs públicas de arquivos MP3.
- O fluxo selecionado deve conter o bloco **Enviar música da prévia**; ele envia as duas faixas em sequência.

## 2. Pagamento sem prévia: gerar a música no WhatsEntregavel

Use este modo quando a música ainda será gerada depois do pagamento. No painel, ele aciona o campo **Fluxo para pagamento sem música da prévia pronta**.

```json
{
  "event": "PAYMENT_APPROVED",
  "integration_key": "CHAVE_DA_CONTA",
  "order_id": "asaas_pay_456",
  "customer": {
    "name": "Ana Martins",
    "phone": "5511999999999"
  },
  "fulfillment": {
    "mode": "generate_music_in_miniflux"
  },
  "lyric_text": "Letra completa da música...",
  "story": "História informada no quiz...",
  "quiz": {
    "music_style": "Sertanejo romântico",
    "voice_gender": "f"
  }
}
```

Regras:

- `lyric_text` é obrigatório neste modo.
- `quiz.music_style` define o estilo musical.
- `quiz.voice_gender` deve ser `f` para voz feminina ou `m` para voz masculina.
- O fluxo selecionado deve conter **Gerar música (Kie)** e depois **Enviar música**.

## O que remover do site

Não use mais um gatilho genérico de pagamento sem `fulfillment.mode`. Todo pagamento aprovado deve informar um dos dois valores acima. Assim, o WhatsEntregavel escolhe o fluxo correto sem confundir uma prévia pronta com uma nova geração.
