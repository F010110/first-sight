/** Retry only transport failures. Semantic/HTTP/JSON failures are not retried. */
export function transientNetworkError(error:unknown):boolean{
 let current:unknown=error;
 for(let depth=0;depth<5&&current&&typeof current==='object';depth++){
   const e=current as {code?:string;cause?:unknown;name?:string};
   if(e.name==='TimeoutError')return true;
   if(['EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','UND_ERR_SOCKET','ECONNRESET','ECONNREFUSED','EPIPE','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(e.code??''))return true;
  current=e.cause;
 }
 return false;
}
export async function boundedNetworkRetry<T>(operation:(attempt:number)=>Promise<T>,onFailure:(error:unknown,attempt:number,retrying:boolean)=>Promise<void>,maxAttempts=3,delayMs=500):Promise<T>{
 if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>3)throw Error('Invalid network retry bound');
 for(let attempt=0;attempt<maxAttempts;attempt++){
  try{return await operation(attempt);}catch(error){const retrying=transientNetworkError(error)&&attempt+1<maxAttempts;await onFailure(error,attempt,retrying);if(!retrying)throw error;await new Promise(resolve=>setTimeout(resolve,delayMs*(attempt+1)));}
 }
 throw Error('Network retry exhausted');
}
