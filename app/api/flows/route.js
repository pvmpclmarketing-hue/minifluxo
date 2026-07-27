import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../supabase';

export async function POST(request) {
  try {
    const user = await requireUser(); const body = await request.json();
    if (!body.name?.trim()) return NextResponse.json({ error:'Informe um nome para o fluxo.' }, { status:400 });
    const { data, error } = await adminClient().from('flows').insert({ owner_id:user.id, name:body.name.trim(), description:body.description?.trim() || null }).select().single();
    if (error) throw error; return NextResponse.json(data, { status:201 });
  } catch (error) { return NextResponse.json({ error:error.message }, { status:500 }); }
}
