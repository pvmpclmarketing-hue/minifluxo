import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../../supabase';

export async function DELETE(_request,{params}){
  try{
    const user=await requireUser();const {id}=await params;
    const {error}=await adminClient().from('leads').delete().eq('id',id).eq('owner_id',user.id);
    if(error)throw error;return new NextResponse(null,{status:204});
  }catch(error){return NextResponse.json({error:error.message},{status:500});}
}
