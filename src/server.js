import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import { load, save, list, findByPhone, findByKieTask } from './store.js';
import { sendWhatsApp, inspectPix, createKieMusic, getWhatsAppImage } from './services.js';

const app = express();
app.use(express.json());
app.use(express.static('public'));
await load();

const cleanPhone = (phone = '') => phone.replace(/\D/g, '');
const now = () => new Date().toISOString();
const initialText = (name) => `Olá, ${name}! Para começar sua música, envie aqui o comprovante do Pix.`;

async function beginLead({ name, phone, musicRequest = '', source }) {
  const lead = { id: crypto.randomUUID(), name, phone: cleanPhone(phone), musicRequest, source, status: 'WAITING_PIX', createdAt: now(), updatedAt: now(), history: [] };
  lead.history.push({ at: now(), event: 'Fluxo iniciado', detail: source });
  await sendWhatsApp(lead.phone, initialText(lead.name));
  await save(lead);
  return lead;
}

app.get('/api/leads', (_req, res) => res.json(list()));
app.post('/api/leads', async (req, res, next) => {
  try {
    const { name, phone } = req.body;
    if (!name || !cleanPhone(phone)) return res.status(400).json({ error: 'Nome e telefone são obrigatórios.' });
    res.status(201).json(await beginLead({ name, phone, source: 'manual' }));
  } catch (error) { next(error); }
});

app.post('/webhooks/site', async (req, res, next) => {
  try {
    if (process.env.SITE_WEBHOOK_SECRET && req.get('x-site-secret') !== process.env.SITE_WEBHOOK_SECRET) return res.sendStatus(401);
    const { name, phone, musicRequest } = req.body;
    if (!name || !cleanPhone(phone)) return res.status(400).json({ error: 'name e phone são obrigatórios.' });
    res.status(201).json(await beginLead({ name, phone, musicRequest, source: 'site' }));
  } catch (error) { next(error); }
});

app.get('/webhooks/whatsapp', (req, res) => {
  if (req.query['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN) return res.send(req.query['hub.challenge']);
  return res.sendStatus(403);
});

app.post('/webhooks/whatsapp', async (req, res, next) => {
  res.sendStatus(200);
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    if (!message) return;
    const lead = findByPhone(cleanPhone(message.from));
    if (!lead) return;
    lead.updatedAt = now();
    if (lead.status === 'WAITING_PIX') {
      if (!message.image?.id) { await sendWhatsApp(lead.phone, 'Por favor, envie o comprovante do Pix como imagem.'); return; }
      const mediaUrl = await getWhatsAppImage(message.image.id);
      const check = await inspectPix(mediaUrl);
      lead.history.push({ at: now(), event: 'Comprovante analisado', detail: check.reason });
      if (!check.approved) { await sendWhatsApp(lead.phone, `Não consegui validar o comprovante. ${check.reason || 'Envie uma imagem mais legível.'}`); await save(lead); return; }
      if (!lead.musicRequest) { lead.status = 'WAITING_BRIEFING'; await sendWhatsApp(lead.phone, 'Pagamento confirmado! Agora me envie um briefing curto: nome da pessoa, estilo da música e mensagem principal.'); await save(lead); return; }
      await queueMusic(lead);
    } else if (lead.status === 'WAITING_BRIEFING' && message.text?.body) {
      lead.musicRequest = message.text.body;
      await queueMusic(lead);
    }
  } catch (error) { next(error); }
});

async function queueMusic(lead) {
  lead.status = 'GENERATING';
  lead.history.push({ at: now(), event: 'Música enviada ao Kie.ai' });
  await sendWhatsApp(lead.phone, 'Pagamento confirmado! Estamos criando sua música; aviso assim que estiver pronta.');
  const task = await createKieMusic(lead);
  lead.kieTaskId = task.taskId;
  if (task.musicUrl) { lead.musicUrl = task.musicUrl; lead.status = 'COMPLETED'; await sendWhatsApp(lead.phone, `Sua música está pronta 🎵\n${task.musicUrl}`); }
  await save(lead);
}

app.post('/webhooks/kie', async (req, res) => {
  if (process.env.KIE_WEBHOOK_SECRET && req.get('x-kie-signature') !== process.env.KIE_WEBHOOK_SECRET) return res.sendStatus(401);
  res.sendStatus(200);
  const taskId = req.body.taskId || req.body.id || req.body.data?.taskId;
  const musicUrl = req.body.musicUrl || req.body.data?.musicUrl || req.body.data?.resultUrl;
  const lead = findByKieTask(taskId);
  if (!lead || !musicUrl) return;
  lead.status = 'COMPLETED'; lead.musicUrl = musicUrl; lead.updatedAt = now();
  lead.history.push({ at: now(), event: 'Música entregue', detail: musicUrl });
  await sendWhatsApp(lead.phone, `Sua música está pronta 🎵\n${musicUrl}`);
  await save(lead);
});

app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: error.message || 'Erro interno.' }); });
app.listen(process.env.PORT || 3000, () => console.log(`Mini Fluxo ativo em http://localhost:${process.env.PORT || 3000}`));
