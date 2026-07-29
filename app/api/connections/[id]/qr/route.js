import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../../../supabase';
import { configureGlobalUazWebhook, tokenForConnection, uazCall } from '../../../uazapi';

export async function POST(_request,{params}) {
  try {
    const user=await requireUser();const {id}=await params;const db=adminClient();const {data:connection,error}=await db.from('connections').select('*').eq('id',id).eq('owner_id',user.id).single();
    if(error||connection.provider!=='uazapi')return NextResponse.json({error:'Conexão UazAPI não encontrada.'},{status:404});
    await configureGlobalUazWebhook();
    const payload=await uazCall(await tokenForConnection(db,connection),'/instance/connect',{browser:'auto'});
    await db.from('connections').update({status:payload.connected?'connected':'connecting'}).eq('id',id);
    return NextResponse.json({qr:payload.qrcode||payload.base64||payload.instance?.qrcode||payload.instance?.base64||null});
  }catch(error){return NextResponse.json({error:error.message},{status:500});}
}
