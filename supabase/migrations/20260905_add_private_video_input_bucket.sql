insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('video-inputs','video-inputs',false,31457280,array['image/jpeg','image/png','image/webp','audio/mpeg']::text[])
on conflict (id) do update set public=false,file_size_limit=31457280,allowed_mime_types=array['image/jpeg','image/png','image/webp','audio/mpeg']::text[];

-- Uploads do painel usam URL temporária assinada pelo backend autenticado.
-- Não há acesso direto da API pública ao bucket privado.
