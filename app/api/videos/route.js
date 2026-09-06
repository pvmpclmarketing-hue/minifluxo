import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../supabase';
import { buildPhotoTimeline } from '../../../lib/video-timeline';

export const dynamic='force-dynamic';
const shotstackBase=()=>`https://api.shotstack.io/edit/${process.env.SHOTSTACK_ENVIRONMENT||'stage'}`;

function buildEdit({ audioUrl, photos, introText }) {
  const timeline = buildPhotoTimeline(photos);
  const tracks = [{
    clips: timeline.map(photo => ({
      asset: { type: 'image', src: photo.src },
      start: photo.start,
      length: photo.length,
      fit: 'crop',
      scale: photo.motionStrength,
      position: 'center',
      transition: photo.transition ? { in: 'fade', out: 'fade' } : undefined,
    })),
  }];

  if (introText) {
    tracks.push({ clips: [{
      asset: { type: 'title', text: introText, style: 'minimal', size: 'x-large', color: '#ffffff' },
      start: 0.4,
      length: 4,
      position: 'center',
      transition: { in: 'fade', out: 'fade' },
    }] });
  }

  return {
    timeline: { background: '#09090b', soundtrack: { src: audioUrl, effect: 'fadeInFadeOut', volume: 1 }, tracks },
    output: { format: 'mp4', resolution: 'hd', aspectRatio: '9:16' },
  };
}
async function signedInputUrls(db,audioUrl,photos){const sign=async value=>{if(!value.startsWith('storage://video-inputs/'))return value;const path=value.slice('storage://video-inputs/'.length);const {data,error}=await db.storage.from('video-inputs').createSignedUrl(path,60*60*12);if(error||!data?.signedUrl)throw error||new Error('Não foi possível acessar um arquivo enviado.');return data.signedUrl;};return{audioUrl:await sign(audioUrl),photos:await Promise.all(photos.map(sign))};}

export async function GET(){try{const user=await requireUser();const {data,error}=await adminClient().from('video_orders').select('*').eq('owner_id',user.id).order('created_at',{ascending:false}).limit(100);if(error)throw error;return NextResponse.json(data);}catch(error){return NextResponse.json({error:error.message||'Não autenticado.'},{status:401});}}
export async function POST(request){let order;try{if(!process.env.SHOTSTACK_API_KEY||!process.env.SHOTSTACK_WEBHOOK_SECRET)throw new Error('A integração Shotstack ainda não foi configurada no servidor.');const user=await requireUser();const body=await request.json();const photos=Array.isArray(body.photos)?body.photos.map(value=>String(value).trim()).filter(Boolean):[];const prefix=`storage://video-inputs/${user.id}/`;if(!body.audio_url||photos.length<3||photos.length>8||!body.lyrics?.trim())return NextResponse.json({error:'Informe um MP3, a letra e entre 3 e 8 fotos.'},{status:400});if(!String(body.audio_url).startsWith(prefix)||photos.some(url=>!url.startsWith(prefix)))return NextResponse.json({error:'Os arquivos precisam ser enviados pela sua conta antes de criar o vídeo.'},{status:400});const db=adminClient();const {data,error}=await db.from('video_orders').insert({owner_id:user.id,order_id:body.order_id||null,audio_url:String(body.audio_url).trim(),photos,lyrics:String(body.lyrics).trim(),lyrics_timestamps:Array.isArray(body.lyrics_timestamps)?body.lyrics_timestamps:null,intro_text:body.intro_text?.trim()||null,status:'pending'}).select().single();if(error)throw error;order=data;const inputs=await signedInputUrls(db,order.audio_url,order.photos);const callback=`${process.env.APP_URL||'https://minifluxo.vercel.app'}/api/webhooks/shotstack?order=${order.id}&token=${encodeURIComponent(process.env.SHOTSTACK_WEBHOOK_SECRET)}`;const response=await fetch(`${shotstackBase()}/render`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json','x-api-key':process.env.SHOTSTACK_API_KEY},body:JSON.stringify({...buildEdit({audioUrl:inputs.audioUrl,photos:inputs.photos,introText:order.intro_text}),callback})});const payload=await response.json();if(!response.ok||!payload?.success)throw new Error(payload?.message||'A Shotstack recusou a criação do clipe.');const {data:updated,error:updateError}=await db.from('video_orders').update({status:'rendering',error:null,updated_at:new Date().toISOString()}).eq('id',order.id).select().single();if(updateError)throw updateError;return NextResponse.json(updated,{status:201});}catch(error){if(order?.id)await adminClient().from('video_orders').update({status:'failed',error:error.message||'Falha ao enviar para a Shotstack.',updated_at:new Date().toISOString()}).eq('id',order.id);return NextResponse.json({error:error.message||'Não foi possível criar o vídeo.'},{status:500});}}
