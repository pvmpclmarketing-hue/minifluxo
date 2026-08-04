import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../../supabase';

export async function PATCH(request, { params }) {
  try {
    const user=await requireUser(); const {id}=await params; const body=await request.json();
    const update={updated_at:new Date().toISOString()};
    if(Object.prototype.hasOwnProperty.call(body,'nodes')) update.nodes=body.nodes||[];
    if(Object.prototype.hasOwnProperty.call(body,'edges')) update.edges=body.edges||[];
    if(Object.prototype.hasOwnProperty.call(body,'name')) {
      const name=String(body.name||'').trim();
      if(!name) return NextResponse.json({error:'Informe um nome para o fluxo.'},{status:400});
      update.name=name;
      update.description=String(body.description||'').trim()||null;
    }
    const {data,error}=await adminClient().from('flows').update(update).eq('id',id).eq('owner_id',user.id).select().single();
    if(error)throw error; return NextResponse.json(data);
  } catch(error) { return NextResponse.json({error:error.message},{status:500}); }
}

export async function DELETE(request, { params }) {
  try {
    const user=await requireUser(); const {id}=await params;
    const {data,error}=await adminClient().from('flows').delete().eq('id',id).eq('owner_id',user.id).select('id').maybeSingle();
    if(error) throw error;
    if(!data) return NextResponse.json({error:'Fluxo não encontrado.'},{status:404});
    return NextResponse.json({id:data.id});
  } catch(error) { return NextResponse.json({error:error.message},{status:500}); }
}
