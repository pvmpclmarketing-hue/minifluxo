import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../supabase';

export async function POST(request) {
  try {
    const user=await requireUser(); const body=await request.json();
    const provider=body.provider==='uazapi'?'uazapi':'meta';
    const name=String(body.name||'').trim();
    if(!name)return NextResponse.json({error:'Informe o nome da conexão.'},{status:400});
    let payload={owner_id:user.id,name,provider,instance_name:body.instance_name||null};
    if(provider==='uazapi'){
      // O QR da UazAPI é aberto no primeiro clique em "Conectar", como nas
      // conexões antigas. Não criamos uma instância administrativa antes disso.
      // Isso evita que um admin token expirado bloqueie o pareamento.
      payload={...payload,status:'disconnected'};
    }
    const {data,error}=await adminClient().from('connections').insert(payload).select().single();
    if(error)throw error;return NextResponse.json(data,{status:201});
  }catch(error){return NextResponse.json({error:error.message},{status:400});}
}
