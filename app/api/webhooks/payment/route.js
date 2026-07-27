import { NextResponse } from 'next/server';
import { adminClient } from '../../supabase';
import { sendText } from '../../provider';

export async function POST(request) {
  try {
    if (!process.env.PAYMENT_WEBHOOK_SECRET || request.headers.get('x-payment-secret') !== process.env.PAYMENT_WEBHOOK_SECRET) return new NextResponse(null, { status:401 });
    const body = await request.json();
    if (body.event !== 'PAYMENT_APPROVED') return NextResponse.json({ received:true, ignored:true });
    if (!body.connection_id || !body.customer?.name || !body.customer?.phone) return NextResponse.json({ error:'connection_id, customer.name e customer.phone sao obrigatorios.' }, { status:400 });
    const db = adminClient();
    const { data:config, error:configError } = await db.from('connection_flow_configs').select('payment_flow_id, owner_id').eq('connection_id',body.connection_id).single();
    if(configError || !config?.payment_flow_id) return NextResponse.json({ error:'Nenhum fluxo de pagamento configurado para esta conexao.' }, { status:404 });
    const { data:flow, error:flowError } = await db.from('flows').select('id, owner_id').eq('id', config.payment_flow_id).eq('owner_id',config.owner_id).single();
    if (flowError || !flow) return NextResponse.json({ error:'Fluxo configurado nao encontrado.' }, { status:404 });
    const phone = String(body.customer.phone).replace(/\D/g, '');
    const musicRequest = body.music_request || body.custom_fields?.story || body.custom_fields?.music_style || null;
    const { data:lead, error } = await db.from('leads').insert({ owner_id:flow.owner_id, name:body.customer.name, phone, source:'payment', music_request:musicRequest, status:'generating', provider:'payment' }).select().single();
    if (error) throw error;
    const { data:connection } = await db.from('connections').select('*').eq('id',body.connection_id).eq('owner_id',flow.owner_id).maybeSingle();
    if (connection) await sendText(connection, phone, `Pagamento confirmado, ${body.customer.name}! Sua musica entrou na fila de criacao.`);
    return NextResponse.json({ received:true, execution_id:lead.id });
  } catch (error) { return NextResponse.json({ error:error.message }, { status:500 }); }
}
