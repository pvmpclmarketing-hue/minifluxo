import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../../supabase';

export async function POST(request){
  try{
    const user=await requireUser();const body=await request.json();const shareCode=String(body.share_code||'').trim().toUpperCase();
    if(!/^FLW-[A-F0-9]{16}$/.test(shareCode))return NextResponse.json({error:'Informe um código de fluxo válido.'},{status:400});
    const db=adminClient();const {data:source,error:sourceError}=await db.from('flows').select('name,description,status,nodes,edges').eq('share_code',shareCode).maybeSingle();
    if(sourceError)throw sourceError;if(!source)return NextResponse.json({error:'Código de fluxo não encontrado.'},{status:404});
    const share_code=`FLW-${crypto.randomUUID().replace(/-/g,'').slice(0,16).toUpperCase()}`;
    const {data,error}=await db.from('flows').insert({owner_id:user.id,name:`${source.name} (cópia)`.slice(0,160),description:source.description,status:source.status,nodes:source.nodes||[],edges:source.edges||[],share_code}).select().single();
    if(error)throw error;return NextResponse.json(data,{status:201});
  }catch(error){return NextResponse.json({error:error.message||'Não foi possível copiar o fluxo.'},{status:500});}
}
