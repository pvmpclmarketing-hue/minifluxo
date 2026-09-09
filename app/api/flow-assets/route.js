import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { adminClient, requireUser } from '../supabase';

export const dynamic = 'force-dynamic';

const mediaTypes = {
  'image/jpeg': { kind: 'image', extension: 'jpg' },
  'image/png': { kind: 'image', extension: 'png' },
  'video/mp4': { kind: 'video', extension: 'mp4' },
};

export async function POST(request) {
  try {
    const user = await requireUser();
    const { contentType } = await request.json();
    const media = mediaTypes[String(contentType || '').toLowerCase()];
    if (!media) return NextResponse.json({ error: 'Use JPG, PNG ou vídeo MP4.' }, { status: 400 });

    const path = `${user.id}/flow-media/${randomUUID()}.${media.extension}`;
    const { data, error } = await adminClient().storage.from('video-inputs').createSignedUploadUrl(path);
    if (error || !data?.token) throw error || new Error('Não foi possível preparar o upload.');
    return NextResponse.json({ path, token: data.token, mediaType: media.kind });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Não foi possível preparar o upload.' }, { status: 401 });
  }
}
