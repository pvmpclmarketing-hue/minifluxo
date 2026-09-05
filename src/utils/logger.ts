export function jobLog(orderId:string,event:string,details:Record<string,unknown>={}){console.log(JSON.stringify({scope:'video-worker',orderId,event,at:new Date().toISOString(),...details}));}
