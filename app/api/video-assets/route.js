import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { adminClient, requireUser } from '../supabase';
export const dynamic='force-dynamic';
const allowed=new Set(['image/jpeg','image/png','image/webp','audio/mpeg','audio/mp3']);
export async function POST(request){try{const user=await requireUser();const {name,contentType,kind}=await request.json();if(!name||!allowed.has(contentType)||!['photo','audio'].includes(kind))return NextResponse.json({error:'Arquivo não suportado. Use JPG, PNG, WEBP ou MP3.'},{status:400});const extension=String(name).split('.').pop()?.toLowerCase()||'bin';const path=`${user.id}/${kind}/${randomUUID()}.${extension}`;const {data,error}=await adminClient().storage.from('video-inputs').createSignedUploadUrl(path);if(error)throw error;return NextResponse.json({path,token:data.token});}catch(error){return NextResponse.json({error:error.message||'Não foi possível preparar o upload.'},{status:401});}}
