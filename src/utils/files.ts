import { rm } from 'node:fs/promises'; export const removeTemporaryJob=async(path:string)=>{await rm(path,{recursive:true,force:true});};
