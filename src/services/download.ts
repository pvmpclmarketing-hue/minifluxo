import { mkdir, writeFile } from 'node:fs/promises'; import path from 'node:path';

const DOWNLOAD_TIMEOUT_MS = 120_000;

export async function downloadAsset(url:string,targetDir:string,name:string){
  await mkdir(targetDir,{recursive:true});
  let response: Response;
  try {
    response = await fetch(url,{signal:AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)});
  } catch (error) {
    const message = error instanceof Error && error.name === 'TimeoutError'
      ? `O download de ${name} excedeu 120 segundos.`
      : `Falha ao baixar ${name}: ${error instanceof Error ? error.message : 'erro de rede'}`;
    throw new Error(message);
  }
  if(!response.ok)throw new Error(`Falha ao baixar ${name}: HTTP ${response.status}`);
  const contentType=response.headers.get('content-type')??'';
  if(!contentType.startsWith('image/')&&!contentType.startsWith('audio/'))throw new Error(`${name} não é um arquivo de mídia válido.`);
  const extension=contentType.includes('png')?'.png':contentType.includes('webp')?'.webp':contentType.includes('mpeg')?'.mp3':'.jpg';
  const output=path.join(targetDir,`${name}${extension}`);
  await writeFile(output,Buffer.from(await response.arrayBuffer()));
  return output;
}
