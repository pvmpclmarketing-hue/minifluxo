# Relay Efi mTLS

O relay existe porque a Efi exige certificado de cliente (mTLS) para entregar webhooks Pix. A Oracle recebe o certificado da Efi no Nginx e encaminha somente o JSON validado para `POST /api/webhooks/efi` do WhatsEntregavel.

Variáveis do servidor:

```text
MINIFLUX_EFI_WEBHOOK_URL=https://minifluxo.vercel.app/api/webhooks/efi
EFI_WEBHOOK_RELAY_SECRET=<o mesmo valor cadastrado na Vercel>
```

O Nginx usa a cadeia pública da Efi em `/etc/nginx/efi/certificate-chain.crt` e exige mTLS em `/efi` e `/efi/pix`.
