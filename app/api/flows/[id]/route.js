import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../../supabase';

export async function PATCH(request, { params }) {
  try {
    const user=await requireUser(); const {id}=await params; const body=await request.json();
    const {data,error}=await adminClient().from('flows').update({nodes:body.nodes||[],edges:body.edges||[],updated_at:new Date().toISOString()}).eq('id',id).eq('owner_id',user.id).select().single();
    if(error)throw error; return NextResponse.json(data);
  } catch(error) { return NextResponse.json({error:error.message},{status:500}); }
}
