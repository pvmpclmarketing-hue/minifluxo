import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

function resolveFfprobe(){
  // O pacote do Remotion inclui binários Linux para o renderer. Usá-los evita
  // depender de uma instalação global de FFmpeg na VM Always Free.
  const bundled=path.join(process.cwd(),'node_modules','@remotion','compositor-linux-x64-gnu','ffprobe');
  return existsSync(bundled)?bundled:'ffprobe';
}

export function ffprobeDuration(file:string){return new Promise<number>((resolve,reject)=>{const child=spawn(resolveFfprobe(),['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file]);let output='';child.stdout.on('data',data=>output+=data);child.on('error',()=>reject(new Error('FFmpeg/ffprobe não está disponível no worker.')));child.on('close',code=>code===0?resolve(Number(output.trim())):reject(new Error('Não foi possível ler a duração do áudio.')));});}
