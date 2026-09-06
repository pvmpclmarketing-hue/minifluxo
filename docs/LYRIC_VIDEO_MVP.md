# MVP — Lyric Video Romântico 9:16

O upsell gera um clipe vertical de 60 segundos a partir do MP3 e da letra da música. Nesta primeira versão não há fotos do cliente.

## Fluxo

1. No painel, abra **Clipes**.
2. Envie o MP3, cole a letra, escolha um dos três temas e, se desejar, informe uma frase de introdução.
3. O Minifluxo cria um registro em `lyric_video_orders` como `pending`.
4. A API envia um Edit para a Shotstack e salva o `shotstack_render_id`.
5. A Shotstack chama o webhook do Minifluxo.
6. O webhook confirma o ID consultando a Shotstack antes de registrar `complete`, `failed` ou `rendering`.

## Ambiente

Configure somente no servidor/Vercel:

```ini
SHOTSTACK_API_KEY=sua_chave_da_shotstack
SHOTSTACK_WEBHOOK_SECRET=segredo_aleatorio_longo
SHOTSTACK_ENVIRONMENT=stage
APP_URL=https://minifluxo.vercel.app
```

Use `stage` para testes e mude para `v1` apenas com uma chave de produção da Shotstack.

## Entrada da API

`POST /api/lyric-videos`

```json
{
  "audio_url": "storage://video-inputs/ID_DO_USUARIO/audio/musica.mp3",
  "lyrics": "Letra completa da música...",
  "lyrics_timestamps": [
    { "start": 7.2, "end": 10.6, "text": "VOCÊ CHEGOU E MUDOU TUDO" }
  ],
  "intro_text": "Uma música feita com amor",
  "theme": "romantic_rose"
}
```

`lyrics_timestamps` é opcional neste MVP. Se não for enviado, o sistema cria blocos de até seis palavras distribuídos entre 5 e 58 segundos e marca `timing_source` como `estimated`.

## Temas

- `romantic_rose`: rosé, preto e bokeh delicado.
- `night_love`: vinho, preto e dourado discreto.
- `soft_gold`: rosa queimado e tons quentes.

Os fundos estão em `public/lyric-backgrounds`. Para criar um novo tema, adicione um SVG/asset público e registre suas cores em `lib/lyric-video/themes.js`.

## Timestamps reais (próxima etapa)

A função `generateLyricsTiming()` já separa o ponto de extensão. A próxima versão deverá:

1. transcrever o MP3 com timestamps por palavra;
2. usar GPT-5.4 mini para alinhar a transcrição à letra original sem alterar os tempos;
3. salvar os blocos corrigidos em `lyrics_timestamps`;
4. enviar os blocos diretamente para a Shotstack.

## Teste do webhook

Endpoint que a Shotstack recebe no JSON do render:

```text
POST /api/webhooks/shotstack-lyric-video?order=ID_DO_PEDIDO&token=SHOTSTACK_WEBHOOK_SECRET
```

O token não deve ser exposto no frontend. O endpoint compara o `render_id` recebido com o salvo no pedido e consulta a Shotstack antes de aceitar qualquer mudança de status.
