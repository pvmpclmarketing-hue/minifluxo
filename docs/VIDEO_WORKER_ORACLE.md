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
- Estado validado em 06/09/2026: serviço `active (running)` e worker online.
- Dependências de renderização validadas: Chrome Headless do Remotion e `ffprobe`
  incluído pelo pacote `@remotion/compositor-linux-x64-gnu`.

O worker usa uma renderização por vez (`concurrency: 1`) para caber no limite de
memória da máquina. Se uma forma A1 Flex Always Free estiver disponível no futuro,
prefira 1 OCPU e 6 GB de RAM para reduzir o tempo de renderização.

Não instale FFmpeg globalmente apenas para o worker: o código usa o binário
embarcado pelo Remotion, evitando uma dependência adicional na VM.

## Fluxo de dados

```text
Painel Clipes -> bucket privado video-inputs -> video_orders
                                             -> worker Oracle
                                             -> API interna protegida do Minifluxo
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

Para publicar uma nova versão do worker, baixe o código sem levar nenhum segredo
para o repositório:

```bash
sudo systemctl stop whatsentregavel-video-worker
sudo rm -rf /opt/whatsentregavel/app /tmp/minifluxo-main.tar.gz
sudo curl -fsSL https://github.com/pvmpclmarketing-hue/minifluxo/archive/refs/heads/main.tar.gz \
  -o /tmp/minifluxo-main.tar.gz
sudo tar -xzf /tmp/minifluxo-main.tar.gz -C /opt/whatsentregavel
sudo mv /opt/whatsentregavel/minifluxo-main /opt/whatsentregavel/app
cd /opt/whatsentregavel/app && sudo npm install --no-audit --no-fund
sudo systemctl restart whatsentregavel-video-worker
```

## Diagnóstico seguro

1. No painel **Clipes**, confira se o job está em `na fila`, `processando`,
   `renderizando`, `concluído` ou `falhou`.
2. Em caso de falha, consulte os logs do serviço acima. Nunca copie o conteúdo do
   arquivo de ambiente para telas, tickets ou commits.
3. Confira se o serviço está com inicialização automática:

```bash
sudo systemctl is-enabled whatsentregavel-video-worker
```

## Segurança e variáveis necessárias

O arquivo de ambiente da VM não possui chave de serviço do Supabase. Ele contém:

- `WORKER_API_URL=https://minifluxo.vercel.app`
- `VIDEO_WORKER_TOKEN` — segredo compartilhado exclusivamente entre a VM e a API
  interna `/api/video-worker` da Vercel.
- `NODE_OPTIONS=--max-old-space-size=768`

O token também está configurado como `VIDEO_WORKER_TOKEN` no ambiente de
produção da Vercel. A API rejeita chamadas sem ele (401); a VM só pode executar
as ações internas `claim`, `status`, `input-urls`, `upload-url` e `complete`.

Esses valores são segredos. Eles não devem ser colocados no frontend, no Git ou em
capturas de tela. A chave privada SSH usada para manutenção está fora do projeto,
em `C:\Users\T-GAMER\.ssh\whatsentregavel-video-worker-access`.

## Observação de rede

A VM precisa de saída HTTPS para baixar dependências e acessar Vercel,
Supabase/GitHub.
Se for usado IP público apenas para essa saída, não exponha aplicações HTTP na VM
e remova regras de entrada que não sejam indispensáveis. A renderização não abre
porta web.
