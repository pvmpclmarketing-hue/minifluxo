# Worker de vídeo na Oracle Cloud

## Objetivo

O Minifluxo recebe fotos, letra e MP3 pelo painel e grava um trabalho na tabela
`video_orders`. A renderização não roda na Vercel: ela é processada por um worker
Node persistente na Oracle Cloud e o MP4 final é salvo no bucket `video-outputs`
do Supabase.

## Infraestrutura

- VM: `whatsentregavel-video-worker`
- Região: Brazil East (São Paulo)
- Forma atual: `VM.Standard.E2.1.Micro` (Always Free, 1 OCPU e 1 GB RAM)
- Disco de apoio: swap de 4 GB
- Serviço: `whatsentregavel-video-worker.service`
- Código: `/opt/whatsentregavel/app`
- Arquivo de ambiente: `/etc/whatsentregavel/video-worker.env`

O worker usa uma renderização por vez (`concurrency: 1`) para caber no limite de
memória da máquina. Se uma forma A1 Flex Always Free estiver disponível no futuro,
prefira 1 OCPU e 6 GB de RAM para reduzir o tempo de renderização.

## Fluxo de dados

```text
Painel Clipes -> bucket privado video-inputs -> video_orders
                                             -> worker Oracle + FFmpeg
                                             -> bucket público video-outputs
                                             -> painel exibe MP4 concluído
```

Os arquivos de entrada permanecem privados. O worker gera URLs assinadas somente
para processar o trabalho e grava o resultado final no caminho
`videos/<id-do-job>/music-video.mp4`.

## Operação na VM

Após acessar a VM por um canal administrativo autorizado:

```bash
sudo systemctl status whatsentregavel-video-worker
sudo journalctl -u whatsentregavel-video-worker -n 200 --no-pager
sudo systemctl restart whatsentregavel-video-worker
```

Para publicar uma nova versão do worker:

```bash
cd /opt/whatsentregavel/app
git pull origin main
npm ci
sudo systemctl restart whatsentregavel-video-worker
```

## Diagnóstico seguro

1. No painel **Clipes**, confira se o job está em `na fila`, `processando`,
   `renderizando`, `concluído` ou `falhou`.
2. Em caso de falha, consulte os logs do serviço acima. Nunca copie o conteúdo do
   arquivo de ambiente para telas, tickets ou commits.
3. Confirme a presença de `ffmpeg` e `ffprobe` no `PATH` da VM.
4. Confira se o serviço está com inicialização automática:

```bash
sudo systemctl is-enabled whatsentregavel-video-worker
```

## Variáveis necessárias

O arquivo de ambiente contém somente credenciais do servidor necessárias para
acessar o projeto Supabase do Minifluxo:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Esses valores são segredos. Eles não devem ser colocados no frontend, no Git ou em
capturas de tela.

## Observação de rede

A VM precisa de saída HTTPS para baixar dependências e acessar Supabase/GitHub.
Se for usado IP público apenas para essa saída, não exponha aplicações HTTP na VM
e remova regras de entrada que não sejam indispensáveis. A renderização não abre
porta web.
