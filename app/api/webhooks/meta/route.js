import { NextResponse } from 'next/server';
import { POST as datafyWebhook } from '../datafy/route';
export async function GET(request) { const p=request.nextUrl.searchParams; return p.get('hub.verify_token')===process.env.META_VERIFY_TOKEN ? new NextResponse(p.get('hub.challenge')) : new NextResponse(null,{status:403}); }
export async function POST(request) {
  // Alguns canais foram cadastrados inicialmente com esta URL da Meta. A
  // Datafy mantém o payload compatível, mas adiciona seus headers assinados;
  // delegar aqui evita que uma URL antiga responda 200 e descarte a conversa.
  if (request.headers.get('x-datafy-signature-256')) return datafyWebhook(request);
  const body=await request.json(); console.log('Webhook Meta recebido', body.entry?.[0]?.id); return NextResponse.json({received:true});
}
