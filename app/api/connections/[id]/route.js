import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../../supabase';

export async function PATCH(request, { params }) {
  try {
    const user=await requireUser(); const { id }=await params;
    const { provider }=await request.json();
    if(!['meta','uazapi'].includes(provider)) return NextResponse.json({error:'Tipo de conexão inválido.'},{status:400});
    const {data,error}=await adminClient().from('connections').update({provider,status:'disconnected'}).eq('id',id).eq('owner_id',user.id).select().single();
    if(error) throw error;
    return NextResponse.json(data);
  } catch(error) { return NextResponse.json({error:error.message},{status:500}); }
}
