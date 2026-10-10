-- O card de áudio do fluxo armazena mensagens de voz OGG/Opus no bucket privado.
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/ogg', 'video/mp4']::text[]
where id = 'video-inputs';
