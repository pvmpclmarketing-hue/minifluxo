/** Dispara um único render no runner efêmero do GitHub Actions. */
export async function dispatchRemotionRender(orderId) {
  const token = process.env.GITHUB_ACTIONS_DISPATCH_TOKEN;
  const repository = process.env.GITHUB_ACTIONS_REPOSITORY;
  if (!token || !repository) {
    throw new Error('Configure GITHUB_ACTIONS_DISPATCH_TOKEN e GITHUB_ACTIONS_REPOSITORY na Vercel.');
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('GITHUB_ACTIONS_REPOSITORY deve usar o formato dono/repositorio.');
  const response = await fetch(`https://api.github.com/repos/${repository}/dispatches`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'minifluxo-remotion-dispatcher',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ event_type: 'remotion-render', client_payload: { order_id: orderId } }),
  });
  if (!response.ok) throw new Error(`GitHub Actions recusou o render (${response.status}).`);
}
