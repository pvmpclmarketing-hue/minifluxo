export type MotionPreset = 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'pan_up';
export type TransitionPreset = 'crossfade' | 'blur_dissolve' | 'scale_dissolve';
export type CaptionAnimation = 'instagram' | 'word_by_word';

export type TimedCaption = { start: number; end: number; text: string; position?: 'center' };
export type TimelinePhoto = { url: string; start: number; end: number; motion: MotionPreset; transition: TransitionPreset };
export type VideoTimeline = {
  width: 1080; height: 1920; fps: 30; duration: number;
  audio: { url: string; start: number; volume: number };
  photos: TimelinePhoto[];
  lyrics: TimedCaption[];
  introText?: string | null;
  style: { captionAnimation: CaptionAnimation };
};
export type VideoOrder = {
  id: string; owner_id: string; order_id?: string | null; status: 'pending'|'processing'|'rendering'|'uploading'|'complete'|'failed';
  audio_url: string; photos: string[]; lyrics: string; lyrics_timestamps?: TimedCaption[] | null;
  intro_text?: string | null; output_url?: string | null; error?: string | null; attempts?: number; created_at?: string;
};
