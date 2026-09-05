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

## MVP de vídeos verticais

O MVP cria vídeos determinísticos de fotos, MP3 e letra. A interface de WhatsApp ainda não participa: o sistema usa jobs em `video_orders`, um worker Node e o bucket `video-outputs` do Supabase.

1. Aplique [20260905_create_video_orders.sql](supabase/migrations/20260905_create_video_orders.sql) no Supabase do Minifluxo.
2. Instale as dependências: `npm install`.
3. Instale FFmpeg e deixe `ffmpeg` e `ffprobe` disponíveis no `PATH` do computador/servidor do worker.
4. Inicie o worker em uma VM ou servidor persistente: `npm run video:worker`.

Não execute o worker na Vercel: renderização de 60 segundos exige disco temporário, FFmpeg e pode superar o tempo de execução de uma função serverless.

### Criar um job

Com o usuário logado no Minifluxo, faça `POST /api/videos` com `audio_url`, `photos` (4–8 URLs), `lyrics`, `lyrics_timestamps` opcional e `intro_text` opcional. Consulte os jobs da conta em `GET /api/videos`.

O worker usa bloqueio atômico no banco, faz até três tentativas e grava o MP4 H.264/AAC em `video-outputs/videos/<jobId>/music-video.mp4`. O áudio é limitado a 60 segundos; se for menor, o vídeo termina junto com ele.

### Prévia local

Edite [sample-data.json](sample-data.json) com URLs reais e execute `npm run preview` para abrir o Remotion Studio. Para renderizar manualmente: `npm run render:sample`. O arquivo final é `output/sample.mp4`.

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
