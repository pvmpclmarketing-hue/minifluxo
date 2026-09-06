alter table public.lyric_video_orders
  drop constraint if exists lyric_video_orders_timing_source_check;

alter table public.lyric_video_orders
  add constraint lyric_video_orders_timing_source_check
  check (timing_source in ('provided', 'estimated', 'transcribed'));
