import { NextResponse } from 'next/server';
export async function POST(request) { if(process.env.KIE_WEBHOOK_SECRET && request.headers.get('x-kie-signature')!==process.env.KIE_WEBHOOK_SECRET)return new NextResponse(null,{status:401}); const body=await request.json(); console.log('Callback Kie recebido',body.task_id||body.taskId); return NextResponse.json({received:true}); }
