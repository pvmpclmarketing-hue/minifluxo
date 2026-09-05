import type { MotionPreset, TimedCaption, TimelinePhoto, VideoTimeline } from './types';

const motions: MotionPreset[] = ['zoom_in','pan_left','zoom_out','pan_right','pan_up'];
export function secondsToFrames(seconds: number, fps = 30) { return Math.round(seconds * fps); }
export function buildPhotoTimeline(urls: string[], duration = 60): TimelinePhoto[] {
  if (urls.length < 4 || urls.length > 8) throw new Error('Envie entre 4 e 8 fotos.');
  const transition = 0.55;
  const available = duration - transition * (urls.length - 1);
  const weights = urls.map((_, index) => index === 0 || index === urls.length - 1 ? 1.16 : 1);
  const unit = available / weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;
  return urls.map((url, index) => {
    const visible = unit * weights[index];
    const start = Math.max(0, cursor - (index ? transition : 0));
    const end = Math.min(duration, cursor + visible);
    cursor += visible;
    return { url, start, end, motion: motions[index % motions.length], transition: index % 3 === 1 ? 'blur_dissolve' : index % 3 === 2 ? 'scale_dissolve' : 'crossfade' };
  });
}
export function splitLyrics(lyrics: string, duration = 60): TimedCaption[] {
  const words = lyrics.replace(/\[[^\]]+\]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const blocks: string[] = [];
  for (let index = 0; index < words.length;) { const count = Math.min(7, words.length - index); blocks.push(words.slice(index, index + count).join(' ')); index += count; }
  const start = 6;
  const slice = Math.max(1.6, (duration - start) / Math.max(blocks.length, 1));
  return blocks.map((text, index) => ({ text, start: Number((start + index * slice).toFixed(2)), end: Number(Math.min(duration, start + (index + 1) * slice).toFixed(2)) }));
}
export function createTimeline(input: {audioUrl:string; photos:string[]; lyrics:string; lyricsTimestamps?:TimedCaption[]|null; introText?:string|null; duration?:number}): VideoTimeline {
  const duration = Math.min(60, Math.max(1, input.duration ?? 60));
  return { width:1080, height:1920, fps:30, duration, audio:{url:input.audioUrl,start:0,volume:1}, photos:buildPhotoTimeline(input.photos,duration), lyrics:input.lyricsTimestamps?.length ? input.lyricsTimestamps : splitLyrics(input.lyrics,duration), introText:input.introText, style:{captionAnimation:'instagram'} };
}
