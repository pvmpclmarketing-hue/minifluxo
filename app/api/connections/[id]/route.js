import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../../supabase';
import { encryptSecret, hashSecret } from '../../connection-secrets';
import { createUazInstance, disconnectUazInstance } from '../../uazapi';

export async function PATCH(request,{params}) {
  try {
    const user=await requireUser();const {id}=await params;const {provider}=await request.json();
    if(!['meta','uazapi'].includes(provider))return NextResponse.json({error:'Tipo de conexão inválido.'},{status:400});
    const db=adminClient();const {data:current,error:findError}=await db.from('connections').select('*').eq('id',id).eq('owner_id',user.id).single();if(findError)throw findError;
    const values={provider,status:'disconnected'};
    if(provider==='uazapi'&&!current.uazapi_token_cipher){const instance=await createUazInstance(current.instance_name||current.name);values.instance_name=instance.instanceName;values.uazapi_token_cipher=encryptSecret(instance.token);values.uazapi_token_hash=hashSecret(instance.token);}
    const {data,error}=await db.from('connections').update(values).eq('id',id).eq('owner_id',user.id).select().single();if(error)throw error;return NextResponse.json(data);
  }catch(error){return NextResponse.json({error:error.message},{status:500});}
}

export async function DELETE(_request,{params}) {
  try {
    const user=await requireUser();const {id}=await params;const db=adminClient();
    const {data:connection,error:findError}=await db.from('connections').select('*').eq('id',id).eq('owner_id',user.id).single();if(findError)throw findError;
    if(connection.provider==='uazapi')await disconnectUazInstance(db,connection);
    const {error}=await db.from('connections').delete().eq('id',id).eq('owner_id',user.id);if(error)throw error;
    return new NextResponse(null,{status:204});
  }catch(error){return NextResponse.json({error:error.message},{status:500});}
}
