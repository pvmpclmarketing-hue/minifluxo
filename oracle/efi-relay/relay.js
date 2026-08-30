const http = require('http');
const https = require('https');

const port = Number(process.env.PORT || 3001);
const target = String(process.env.MINIFLUX_EFI_WEBHOOK_URL || '');
const relaySecret = String(process.env.EFI_WEBHOOK_RELAY_SECRET || '');

if (!target.startsWith('https://') || !relaySecret) throw new Error('Defina MINIFLUX_EFI_WEBHOOK_URL e EFI_WEBHOOK_RELAY_SECRET.');

const server = http.createServer((request, response) => {
  if (request.method !== 'POST' || !/^\/efi(?:\/pix)?\/?$/.test(request.url || '')) { response.writeHead(404); return response.end(); }
  let body = '';
  request.setEncoding('utf8');
  request.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) request.destroy(); });
  request.on('end', () => {
    const destination = new URL(target);
    const upstream = https.request({ hostname: destination.hostname, path: `${destination.pathname}${destination.search}`, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-efi-relay-secret': relaySecret }, timeout: 15000 }, upstreamResponse => {
      response.writeHead(upstreamResponse.statusCode || 502, { 'content-type': 'application/json' });
      upstreamResponse.pipe(response);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('Timeout no Minifluxo')));
    upstream.on('error', error => { console.error('[efi relay] forward failed', error.message); response.writeHead(502); response.end(JSON.stringify({ error: 'Falha ao encaminhar evento.' })); });
    upstream.end(body);
  });
});

server.listen(port, '127.0.0.1', () => console.log(`[efi relay] listening on ${port}`));
