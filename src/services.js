const metaUrl = () => `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || 'v22.0'}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

export async function sendWhatsApp(phone, body) {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    console.info('[simulado] WhatsApp para', phone, body);
    return { simulated: true };
  }
  const response = await fetch(metaUrl(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body } })
  });
  if (!response.ok) throw new Error(`WhatsApp: ${response.status} ${await response.text()}`);
  return response.json();
}

export async function inspectPix(mediaUrl) {
  if (!process.env.OPENAI_API_KEY) return { approved: false, reason: 'OPENAI_API_KEY não configurada.' };
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      input: [{ role: 'user', content: [
        { type: 'input_text', text: `Analise este comprovante Pix. Responda APENAS JSON: {"approved":boolean,"reason":string}. Aprove somente se for um comprovante legível de transferência Pix concluída; não invente dados e rejeite imagens genéricas, editadas ou sem confirmação. Destinatário esperado: ${process.env.PIX_RECIPIENT_NAME || 'não informado'}. Valor esperado: ${process.env.PIX_AMOUNT || 'não informado'}. Se destinatário ou valor esperado estiverem informados, exija correspondência.` },
        { type: 'input_image', image_url: mediaUrl }
      ] }]
    })
  });
  if (!response.ok) throw new Error(`OpenAI: ${response.status} ${await response.text()}`);
  const data = await response.json();
  const text = data.output_text || '{}';
  try { return JSON.parse(text.replace(/```json|```/g, '').trim()); }
  catch { return { approved: false, reason: 'Não foi possível interpretar o comprovante.' }; }
}

export async function getWhatsAppImage(mediaId) {
  if (!process.env.WHATSAPP_TOKEN) throw new Error('WHATSAPP_TOKEN não configurado.');
  const version = process.env.WHATSAPP_API_VERSION || 'v22.0';
  const metadata = await fetch(`https://graph.facebook.com/${version}/${mediaId}`, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } });
  if (!metadata.ok) throw new Error(`Mídia WhatsApp: ${metadata.status}`);
  const { url, mime_type: mimeType = 'image/jpeg' } = await metadata.json();
  const image = await fetch(url, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } });
  if (!image.ok) throw new Error(`Download da mídia: ${image.status}`);
  return `data:${mimeType};base64,${Buffer.from(await image.arrayBuffer()).toString('base64')}`;
}

export async function createKieMusic(lead) {
  if (!process.env.KIE_API_BASE_URL || !process.env.KIE_API_KEY) {
    return { simulated: true, taskId: `sim_${lead.id}`, musicUrl: null };
  }
  const response = await fetch(`${process.env.KIE_API_BASE_URL}${process.env.KIE_MUSIC_ENDPOINT || '/api/v1/generate'}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KIE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: lead.musicRequest, callbackUrl: `${process.env.APP_URL}/webhooks/kie`, metadata: { leadId: lead.id } })
  });
  if (!response.ok) throw new Error(`Kie.ai: ${response.status} ${await response.text()}`);
  const data = await response.json();
  return { taskId: data.taskId || data.id || data.data?.taskId, musicUrl: data.musicUrl || data.data?.musicUrl || null };
}
