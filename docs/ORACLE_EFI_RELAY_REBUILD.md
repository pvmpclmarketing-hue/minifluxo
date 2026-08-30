# Relay Efí na Oracle Cloud

Este documento registra a recriação do relay mTLS da Efí para o WhatsEntregavel.

## Acesso preservado

- Chave privada SSH: `C:\Users\T-GAMER\.ssh\whatsentregavel-efi-oracle`
- Chave pública SSH: `C:\Users\T-GAMER\.ssh\whatsentregavel-efi-oracle.pub`
- Impressão digital: `SHA256:CJf3ACVZAwkA282ecL4MpR4aG3hZwtsSOJA/sS+itg8`

Não há senha de VM salva: o acesso será exclusivamente pela chave SSH. A chave privada não deve ser enviada ao Git, WhatsApp ou e-mail.

## Infraestrutura removida

Foram removidos somente recursos criados para o relay antigo: VMs, discos de inicialização, VCN, sub-redes, gateways, tabelas de rota, listas de segurança e a política/grupo dinâmico de Run Command. Supabase, Vercel, Efí e a conta Oracle não foram alterados.

## Nova arquitetura

1. Criar uma VM Always Free `VM.Standard.E2.1.Micro` em São Paulo.
2. Instalar somente o binário estático do Caddy — sem `dnf`/Node/Nginx, para evitar falta de memória.
3. Expor apenas SSH (22), HTTP (80) e HTTPS (443).
4. Configurar Caddy com mTLS usando a cadeia de certificados de webhook da Efí.
5. Fazer o relay encaminhar `/efi` para `https://minifluxo.vercel.app/api/webhooks/efi`, acrescentando `X-Efi-Relay-Secret` no servidor.
6. Atualizar `EFI_WEBHOOK_RELAY_URL` na Vercel para o novo domínio `https://<ip>.nip.io` e redeployar.
7. Ativar o webhook da Efí no painel do WhatsEntregavel e testar uma cobrança Pix.

## Segredos

Os valores de `EFI_WEBHOOK_RELAY_SECRET`, credenciais Efí e demais tokens ficam apenas nas variáveis de ambiente. Este arquivo não contém segredos.
