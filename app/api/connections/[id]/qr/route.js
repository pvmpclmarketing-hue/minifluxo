import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../../../supabase';

export async function POST(_request, { params }) {
  try {
    const user=await requireUser(); const { id }=await params; const db=adminClient();
    const {data:connection,error}=await db.from('connections').select('*').eq('id',id).eq('owner_id',user.id).single();
    if(error || connection.provider!=='uazapi') return NextResponse.json({error:'Conexão UazAPI não encontrada.'},{status:404});
    const response=await fetch(`${process.env.UAZAPI_URL}/instance/connect`,{method:'POST',headers:{token:process.env.UAZAPI_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({browser:'auto'})});
    if(!response.ok) throw new Error(`UazAPI: ${response.status} ${await response.text()}`);
    const payload=await response.json(); await db.from('connections').update({status:payload.connected?'connected':'connecting'}).eq('id',id);
    return NextResponse.json({qr:payload.qrcode||payload.base64||payload.instance?.qrcode||null});
  } catch(error) { return NextResponse.json({error:error.message},{status:500}); }
}
