-- O card de mídia do fluxo aceita vídeos MP4 de até 70 MB.
-- Mantemos o bucket privado e os tipos permitidos restritos.
update storage.buckets
set file_size_limit = 73400320,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'video/mp4']::text[]
where id = 'video-inputs';
