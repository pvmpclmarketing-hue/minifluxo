import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../../../supabase';
import { tokenForConnection, uazCall } from '../../../uazapi';

const onlyDigits=value=>String(value||'').replace(/\D/g,'');
export async function POST(request,{params}) {
  try {
    const user=await requireUser();const {id}=await params;const {phone}=await request.json();const number=onlyDigits(phone);if(number.length<10)return NextResponse.json({error:'Informe o número do WhatsApp com DDI e DDD.'},{status:400});
    const db=adminClient();const {data:connection,error}=await db.from('connections').select('*').eq('id',id).eq('owner_id',user.id).single();if(error||connection.provider!=='uazapi')return NextResponse.json({error:'Conexão UazAPI não encontrada.'},{status:404});
    const payload=await uazCall(await tokenForConnection(db,connection),'/instance/connect',{phone:number});const code=payload.pairingCode||payload.pairing_code||payload.code||payload.instance?.pairingCode||payload.instance?.pairing_code||null;
    if(!code)throw new Error('A UazAPI não retornou um código de pareamento.');await db.from('connections').update({status:payload.connected?'connected':'connecting'}).eq('id',id);return NextResponse.json({code:String(code),phone:number});
  }catch(error){return NextResponse.json({error:error.message},{status:500});}
}
