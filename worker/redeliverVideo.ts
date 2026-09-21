const apiUrl = process.env.WORKER_API_URL?.replace(/\/$/, '');
const token = process.env.VIDEO_WORKER_TOKEN;
const orderId = process.argv[2];

async function run() {
  if (!apiUrl || !token) throw new Error('WORKER_API_URL ou VIDEO_WORKER_TOKEN não configurado.');
  if (!orderId) throw new Error('Informe o ID do pedido de vídeo.');
  console.log('[delivery] retrying completed video pair', { orderId });
  const response = await fetch(`${apiUrl}/api/video-worker`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'redeliver', orderId }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Falha ao reenviar os vídeos.');
  console.log('[delivery] result', data);
}

void run();
