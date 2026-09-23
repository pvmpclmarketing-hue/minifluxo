import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../../supabase';
import { disconnectUazInstance } from '../../uazapi';

export async function PATCH(request,{params}) {
  try {
    const user=await requireUser();const {id}=await params;const {provider}=await request.json();
    if(provider!=='meta')return NextResponse.json({error:'As novas conexões devem usar a API Oficial.'},{status:400});
    const db=adminClient();const {data:current,error:findError}=await db.from('connections').select('*').eq('id',id).eq('owner_id',user.id).single();if(findError)throw findError;
    const values={provider:'meta',status:'disconnected'};
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
