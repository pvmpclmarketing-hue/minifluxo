import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

function key(){const secret=process.env.FLOW_SECRETS_KEY;if(!secret)throw new Error('FLOW_SECRETS_KEY não configurada no servidor.');return createHash('sha256').update(secret).digest();}
export function encryptSecret(value){const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key(),iv);const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${encrypted.toString('base64')}`;}
export function decryptSecret(value){const [iv,tag,encrypted]=String(value||'').split('.');if(!iv||!tag||!encrypted)throw new Error('Token da instância UazAPI não encontrado.');const decipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(iv,'base64'));decipher.setAuthTag(Buffer.from(tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(encrypted,'base64')),decipher.final()]).toString('utf8');}
