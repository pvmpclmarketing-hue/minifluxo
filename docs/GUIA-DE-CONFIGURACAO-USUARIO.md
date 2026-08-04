# Guia de configuração do WhatsEntregavel

Este guia mostra o que cada usuário deve configurar na própria conta. Nunca cole chaves de API em mensagens, no navegador do cliente ou dentro do canvas do fluxo.

## 1. Conecte o WhatsApp

1. No painel, abra **Conexões** e crie uma conexão **API Web (UazAPI)**.
2. Use **QR Code** ou **Pair Code** para conectar o número.
3. Clique em **Usar no site** na conexão que receberá os pedidos.
4. Copie a chave `WHATSENTREGAVEL_INTEGRATION_KEY` exibida nessa página. Ela identifica a conta e pode continuar a mesma se o usuário trocar de número.

## 2. Cadastre as APIs no painel

Abra **APIs** no WhatsEntregavel.

### OpenAI / GPT

1. Entre em [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
2. Crie uma chave secreta de API e mantenha créditos ativos na conta OpenAI.
3. Cole a chave no campo **Chave da API GPT** e clique em **Salvar APIs**.

Ela é usada apenas pelos blocos **Bloco de IA**, por exemplo para conversar ou analisar comprovantes. A chave fica criptografada e não aparece novamente.

### Kie.ai

1. Entre na sua conta Kie.ai e gere/copiei a chave da API.
2. Cole-a no campo **Chave da API Kie.ai** em **APIs** e salve.

Ela é usada pelo bloco **Gerar música**. Não é preciso preencher prompt nesse bloco: letra, estilo, gênero e voz chegam automaticamente do site. A Kie.ai retorna duas faixas e o bloco **Entrega gerada** as envia como dois áudios no WhatsApp.

## 3. Escolha o fluxo em Disparos

Em **Disparos**, selecione a conexão WhatsApp e configure:

- **Pagamento com música da prévia pronta**: use o fluxo *Fluxo Prévia Pronta*. O site envia as duas URLs que a pessoa já ouviu.
- **Pagamento sem música da prévia pronta**: use o fluxo *Fluxo Gerar Música KIE*. O site envia letra, estilo e gênero vocal e o WhatsEntregavel gera as duas faixas na Kie.ai.
- **Pedido vindo do site**: opcional; é usado antes do pagamento para iniciar uma conversa no WhatsApp.

Depois clique em **Salvar disparos**.

## 4. Configure o site para avisar o WhatsEntregavel

O site deve chamar o backend do WhatsEntregavel. Nunca envie os segredos pelo navegador do comprador.

### Pagamento aprovado

`POST https://minifluxo.vercel.app/api/webhooks/payment`

Headers:

```text
Content-Type: application/json
x-payment-secret: PAYMENT_WEBHOOK_SECRET
```

O `PAYMENT_WEBHOOK_SECRET` é configurado pelo administrador da plataforma na Vercel. O site deve enviar também a chave da conta em `integration_key`.

Exemplo para gerar a música no WhatsEntregavel:

```json
{
  "event": "PAYMENT_APPROVED",
  "integration_key": "CHAVE_COPIADA_EM_CONEXOES",
  "order_id": "pedido_unico_123",
  "customer": { "name": "Ana", "phone": "5511999999999" },
  "fulfillment": { "mode": "generate_music_in_miniflux" },
  "lyric_text": "Letra completa da música...",
  "quiz": { "music_style": "Sertanejo romântico", "vocal_gender": "f" }
}
```

Exemplo para entregar a prévia já pronta:

```json
{
  "event": "PAYMENT_APPROVED",
  "integration_key": "CHAVE_COPIADA_EM_CONEXOES",
  "order_id": "pedido_unico_456",
  "customer": { "name": "Ana", "phone": "5511999999999" },
  "fulfillment": { "mode": "deliver_existing_preview_audio" },
  "preview": {
    "audios": [
      "https://servidor-do-site/faixa-1.mp3",
      "https://servidor-do-site/faixa-2.mp3"
    ]
  }
}
```

`order_id` deve ser único. Isso impede que uma mesma confirmação de pagamento envie a música duas vezes.

### Pedido antes do pagamento (opcional)

`POST https://minifluxo.vercel.app/api/webhooks/site`

Headers:

```text
Content-Type: application/json
x-site-secret: SITE_WEBHOOK_SECRET
```

O corpo deve conter ao menos `integration_key`, `name` e `phone`; pode conter `story`, `lyric_text`, `quiz` e `order_id`.

## Checklist final

1. WhatsApp aparece como **Conectada**.
2. A conexão está marcada como **No site**.
3. As chaves GPT/Kie necessárias foram salvas em **APIs**.
4. Os dois fluxos foram escolhidos em **Disparos**.
5. O backend do site usa a `integration_key` da conta correta e os segredos de webhook corretos.
