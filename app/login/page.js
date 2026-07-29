'use client';
import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

export default function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  async function submit(event) {
    event.preventDefault(); setLoading(true); setError('');
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } });
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) { setError(authError.message); setLoading(false); return; } window.location.assign('/dashboard');
  }
  return <main className="auth-page"><section className="brand-panel"><div className="mark">W</div><p className="eyebrow">AUTOMAÇÃO DE ENTREGAS</p><h1>Whats<span>Entregável</span></h1><p>Do pedido à música pronta. Tudo no WhatsApp.</p><div className="auth-flow"><b>Pedido</b><i>→</i><b>Pix</b><i>→</i><b>IA</b><i>→</i><b>Música</b></div></section><section className="login-card"><p className="eyebrow">ACESSO SEGURO</p><h2>Entre no painel</h2><p>Use o e-mail cadastrado no WhatsEntregavel.</p><form onSubmit={submit}><label>E-mail<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required /></label><label>Senha<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required /></label>{error && <p className="form-error">{error}</p>}<button disabled={loading}>{loading ? 'Entrando...' : 'Entrar no painel'}</button></form></section></main>;
}
