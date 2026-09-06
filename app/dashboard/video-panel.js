'use client';

import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

const statusLabel = { pending: 'Na fila', processing: 'Processando', rendering: 'Renderizando', complete: 'Concluído', failed: 'Falhou' };
const themes = [['romantic_rose', 'Romântico Rosé'], ['night_love', 'Noturno Elegante'], ['soft_gold', 'Delicado Premium']];

export default function VideoPanel({ initialVideos = [] }) {
  const [videos, setVideos] = useState(initialVideos);
  const [notice, setNotice] = useState('');
  const [sending, setSending] = useState(false);
  const client = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

  async function upload(audio) {
    const setup = await fetch('/api/video-assets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: audio.name, contentType: audio.type || 'audio/mpeg', kind: 'audio' }) });
    const prepared = await setup.json();
    if (!setup.ok) throw new Error(prepared.error || 'Não foi possível preparar o MP3.');
    const { error } = await client().storage.from('video-inputs').uploadToSignedUrl(prepared.path, prepared.token, audio);
    if (error) throw error;
    return `storage://video-inputs/${prepared.path}`;
  }

  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const audio = form.get('audio');
    if (!(audio instanceof File) || !audio.size) return setNotice('Escolha o MP3 da música.');
    setSending(true);
    try {
      if (audio.size > 30 * 1024 * 1024) throw new Error('O MP3 deve ter no máximo 30 MB para este MVP.');
      setNotice('Enviando música...');
      const audioUrl = await upload(audio);
      setNotice('Montando lyric video na Shotstack...');
      const response = await fetch('/api/lyric-videos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio_url: audioUrl, lyrics: form.get('lyrics'), intro_text: form.get('intro_text'), theme: form.get('theme') }) });
      const job = await response.json();
      if (!response.ok) throw new Error(job.error || 'Não foi possível criar o lyric video.');
      setVideos(current => [job, ...current]);
      event.currentTarget.reset();
      setNotice('Lyric video enviado para renderização. Atualize a lista em alguns minutos.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Falha ao enviar o MP3.');
    } finally { setSending(false); }
  }

  return <section className="video-page"><section className="table-card"><div className="table-head"><div><p className="eyebrow">UPSELL · LYRIC VIDEO</p><h2>Gerar clipe romântico</h2><small>Vídeo vertical 1080×1920 de 60 segundos, com fundo premium e letra em destaque.</small></div></div><form className="video-form" onSubmit={submit}><label>Música MP3<input name="audio" type="file" accept="audio/mpeg,audio/mp3,.mp3" required /></label><label>Tema visual<select name="theme" defaultValue="romantic_rose">{themes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Letra<textarea name="lyrics" rows="10" placeholder="Cole a letra completa da música..." required /></label><small>Sem timestamps, o MVP organiza a letra em blocos estimados. Quando os timestamps estiverem disponíveis, eles serão usados diretamente para sincronização.</small><label>Frase de introdução (opcional)<input name="intro_text" maxLength="90" placeholder="Uma música feita com amor" /></label><button className="primary" disabled={sending}>{sending ? 'Preparando clipe...' : 'Criar lyric video'}</button>{notice && <p className="api-notice">{notice}</p>}</form></section><section className="table-card"><div className="table-head"><h2>Seus lyric videos</h2><button className="link" onClick={() => window.location.reload()}>Atualizar</button></div>{videos.length ? <div className="lead-list">{videos.map(video => <article className="lead-row" key={video.id}><div className="avatar">▶</div><div><b>{video.status === 'complete' ? 'Lyric video pronto' : 'Lyric video em produção'}</b><small>{new Date(video.created_at).toLocaleString('pt-BR')} · {themes.find(([value]) => value === video.theme)?.[1] || video.theme} · 60 segundos</small>{video.timing_source === 'estimated' && <small>Sincronização estimada — pronto para receber timestamps reais.</small>}{video.error && <small className="form-error">{video.error}</small>}</div><span className={'status ' + video.status}>{statusLabel[video.status] || video.status}</span>{video.output_url && <a className="link" href={video.output_url} target="_blank" rel="noreferrer">Abrir MP4</a>}</article>)}</div> : <div className="empty"><p>Nenhum lyric video criado ainda.</p></div>}</section></section>;
}
