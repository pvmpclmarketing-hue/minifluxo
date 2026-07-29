# WhatsEntregavel

Painel de entregas de músicas por WhatsApp, com login Supabase e dois conectores selecionáveis:

- **WhatsApp oficial** — Meta Cloud API, ideal para produção e deploy 100% serverless.
- **UazAPI** — opção por QR Code, usando sua instância UazAPI.

## Fluxos fixos

1. Lead do site: pede Pix, valida o comprovante por IA, gera música e entrega.
2. Contato manual: recebe nome/número no painel, pede Pix, coleta briefing, gera e entrega.

## Desenvolvimento

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

Execute o SQL de [supabase/schema.sql](supabase/schema.sql) no SQL Editor do Supabase. Em **Authentication → URL Configuration**, defina a Site URL local e depois o domínio da Vercel. Crie o primeiro usuário em **Authentication → Users**.

## Webhooks

| Rota | Origem |
| --- | --- |
| `/api/webhooks/meta` | Meta Cloud API |
| `/api/webhooks/uazapi` | UazAPI (`messages`) |
| `/api/webhooks/site` | Seu site (`x-site-secret`) |
| `/api/webhooks/kie` | Kie.ai |

### Entrega da música ouvida na prévia

Quando o site já tiver gerado a prévia pela Kie.ai, o webhook de pagamento deve enviar as duas URLs finais da mesma prévia. O WhatsEntregavel guarda essas URLs no pedido, pula qualquer bloco Kie do fluxo e as envia como áudio no WhatsApp:

```json
{
  "event": "PAYMENT_APPROVED",
  "integration_key": "chave-da-conta",
  "order_id": "pedido-unico",
  "customer": { "name": "Ana Martins", "phone": "5511999999999" },
  "preview": {
    "task_id": "id-da-tarefa-kie",
    "audios": [
      "https://url-publica-da-primeira-faixa.mp3",
      "https://url-publica-da-segunda-faixa.mp3"
    ]
  }
}
```

Envie esse JSON com o header `x-payment-secret`. As URLs precisam continuar acessíveis quando o WhatsEntregavel for enviá-las; não envie apenas o `task_id`.

As chaves privadas ficam somente nas variáveis de ambiente da Vercel. Nunca as exponha no navegador.
