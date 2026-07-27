import { createCipheriv, createHash, randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../../../supabase';

function encrypt(value) {
  const secret=process.env.FLOW_SECRETS_KEY;
  if (!secret) throw new Error('FLOW_SECRETS_KEY nao configurada no servidor.');
  const key=createHash('sha256').update(secret).digest();
  const iv=randomBytes(12); const cipher=createCipheriv('aes-256-gcm',key,iv);
  const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]); const tag=cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${data.toString('base64')}`;
}

async function ownedFlow(id,userId) {
  const {data,error}=await adminClient().from('flows').select('id').eq('id',id).eq('owner_id',userId).single();
  if(error || !data) throw new Error('Fluxo nao encontrado.');
}

export async function GET(_request,{params}) {
  try {
    const user=await requireUser(); const {id}=await params; await ownedFlow(id,user.id);
    const {data,error}=await adminClient().from('flow_credentials').select('gpt_key_cipher,kie_key_cipher,updated_at').eq('flow_id',id).eq('owner_id',user.id).maybeSingle();
    if(error) throw error;
    return NextResponse.json({gptConfigured:!!data?.gpt_key_cipher,kieConfigured:!!data?.kie_key_cipher,updatedAt:data?.updated_at || null});
  } catch(error) { return NextResponse.json({error:error.message},{status:500}); }
}

export async function PATCH(request,{params}) {
  try {
    const user=await requireUser(); const {id}=await params; await ownedFlow(id,user.id); const body=await request.json();
    const values={flow_id:id,owner_id:user.id,updated_at:new Date().toISOString()};
    if (typeof body.gptKey==='string' && body.gptKey.trim()) values.gpt_key_cipher=encrypt(body.gptKey.trim());
    if (typeof body.kieKey==='string' && body.kieKey.trim()) values.kie_key_cipher=encrypt(body.kieKey.trim());
    if (!values.gpt_key_cipher && !values.kie_key_cipher) return NextResponse.json({error:'Informe ao menos uma chave.'},{status:400});
    const {data:existing,error:findError}=await adminClient().from('flow_credentials').select('flow_id').eq('flow_id',id).eq('owner_id',user.id).maybeSingle();
    if(findError) throw findError;
    const query=existing ? adminClient().from('flow_credentials').update(values).eq('flow_id',id).eq('owner_id',user.id) : adminClient().from('flow_credentials').insert(values);
    const {error}=await query; if(error) throw error;
    return NextResponse.json({ok:true,gptConfigured:!!(body.gptKey?.trim() || existing),kieConfigured:!!(body.kieKey?.trim() || existing)});
  } catch(error) { return NextResponse.json({error:error.message},{status:500}); }
}
