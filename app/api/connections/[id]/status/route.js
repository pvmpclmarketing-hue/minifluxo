import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../../../supabase';
import { configureGlobalUazWebhook, tokenForConnection, uazGet } from '../../../uazapi';

export async function GET(_request,{params}) {
  try {
    const user=await requireUser();const {id}=await params;const db=adminClient();
    const {data:connection,error}=await db.from('connections').select('*').eq('id',id).eq('owner_id',user.id).single();
    if(error)throw error;if(connection.provider!=='uazapi')return NextResponse.json(connection);
    await configureGlobalUazWebhook();
    const remote=await uazGet(await tokenForConnection(db,connection),'/instance/status');
    const connected=Boolean(remote.status?.connected||remote.connected||remote.loggedIn);
    const status=connected?'connected':connection.status==='connected'?'disconnected':connection.status;
    const {data:updated, error:updateError}=await db.from('connections').update({status}).eq('id',id).select().single();
    if(updateError)throw updateError;return NextResponse.json(updated);
  }catch(error){return NextResponse.json({error:error.message},{status:500});}
}
