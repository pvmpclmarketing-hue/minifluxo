import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../supabase';

const allowedHosts = new Set(['musica.memberproduto.shop', 'felicidadeemmusica.vercel.app']);

function allowedOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const host = new URL(origin).hostname;
    return allowedHosts.has(host) || host.endsWith('.memberproduto.shop') || host.endsWith('-paulo-vitors-projects-fa53d133.vercel.app');
  } catch { return false; }
}

function cors(request) {
  return { 'access-control-allow-origin': request.headers.get('origin') || '', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'Origin' };
}

export async function OPTIONS(request) {
  return allowedOrigin(request) ? new NextResponse(null, { status: 204, headers: cors(request) }) : new NextResponse(null, { status: 403 });
}

export async function POST(request) {
  if (!allowedOrigin(request)) return new NextResponse(null, { status: 403 });
  try {
    const body = JSON.parse(await request.text());
    const visitorId = String(body?.visitor_id || '');
    const path = String(body?.path || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(visitorId) || !/^\/(?:[a-z0-9_-]+)?$/.test(path)) return NextResponse.json({ error: 'Visita inválida.' }, { status: 400, headers: cors(request) });
    const { error } = await adminClient().from('site_visit_daily').upsert({ visitor_id: visitorId, path }, { onConflict: 'visitor_id,path,visit_date', ignoreDuplicates: true });
    if (error) throw error;
    return NextResponse.json({ ok: true }, { headers: cors(request) });
  } catch (error) {
    console.error('[site visits] record failed', { error: error.message });
    return NextResponse.json({ error: 'Não foi possível registrar a visita.' }, { status: 500, headers: cors(request) });
  }
}

export async function GET() {
  try {
    await requireUser();
    const db = adminClient();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const since = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(sevenDaysAgo);
    const [{ count: total }, { count: todayCount }, { data: byVersion }] = await Promise.all([
      db.from('site_visit_daily').select('*', { count: 'exact', head: true }),
      db.from('site_visit_daily').select('*', { count: 'exact', head: true }).eq('visit_date', today),
      db.from('site_visit_daily').select('path').gte('visit_date', since),
    ]);
    const versions = Object.entries((byVersion || []).reduce((acc, item) => { acc[item.path] = (acc[item.path] || 0) + 1; return acc; }, {})).map(([path, visits]) => ({ path, visits })).sort((a, b) => b.visits - a.visits);
    return NextResponse.json({ total: total || 0, today: todayCount || 0, last7Days: (byVersion || []).length, versions });
  } catch (error) { return NextResponse.json({ error: error.message || 'Não autenticado.' }, { status: 401 }); }
}
