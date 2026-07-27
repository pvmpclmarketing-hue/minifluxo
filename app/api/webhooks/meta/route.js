import { NextResponse } from 'next/server';
export async function GET(request) { const p=request.nextUrl.searchParams; return p.get('hub.verify_token')===process.env.META_VERIFY_TOKEN ? new NextResponse(p.get('hub.challenge')) : new NextResponse(null,{status:403}); }
export async function POST(request) { const body=await request.json(); console.log('Webhook Meta recebido', body.entry?.[0]?.id); return NextResponse.json({received:true}); }
