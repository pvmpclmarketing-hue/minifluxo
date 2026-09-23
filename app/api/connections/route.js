import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../supabase';

export async function POST(request) {
  try {
    const user=await requireUser(); const body=await request.json();
    if(body.provider!=='meta'||!body.name)return NextResponse.json({error:'Crie apenas conexões da API Oficial.'},{status:400});
    const payload={owner_id:user.id,name:body.name,provider:'meta',instance_name:body.instance_name||null};
    const {data,error}=await adminClient().from('connections').insert(payload).select().single();
    if(error)throw error;return NextResponse.json(data,{status:201});
  }catch(error){return NextResponse.json({error:error.message},{status:400});}
}
