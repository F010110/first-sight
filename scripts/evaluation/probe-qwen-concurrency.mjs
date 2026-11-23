/** Bounded 1/2/4 in-flight vision probe; NOT an account quota discovery API. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const [imageArg,outArg,confirm,ceiling]=process.argv.slice(2);
if(!imageArg||!outArg||confirm!=='--confirm-paid'||ceiling!==undefined&&ceiling!=='--max-concurrency=8')throw Error('Usage: probe-qwen-concurrency IMAGE NEW-OUT --confirm-paid [--max-concurrency=8]');
if(!process.env.QWEN_API_KEY||!process.env.QWEN_BASE_URL)throw Error('Missing provider configuration');
const bytes=await readFile(resolve(imageArg));if(bytes.length>2000000||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Expected bounded PNG');
const out=resolve(outArg);await mkdir(out,{recursive:false});
const payload=JSON.stringify({model:'qwen3.8-flash',enable_thinking:false,temperature:0,max_tokens:48,response_format:{type:'json_object'},messages:[{role:'user',content:[{type:'text',text:'仅输出JSON，scene用不超过10个汉字描述画面。'},{type:'image_url',image_url:{url:'data:image/png;base64,'+bytes.toString('base64')}}]}]});
const levels=[];let active=0,peak=0,calls=0,estimatedUSD=0;
for(const concurrency of ceiling?[1,2,4,8]:[1,2,4]){
 const results=await Promise.all(Array.from({length:concurrency},async()=>{
  if(++calls>(ceiling?15:7))throw Error('Probe call cap');
  const reserved=(128000*.1356+48*.4584)/1e6;estimatedUSD+=reserved;if(estimatedUSD>.15)throw Error('Probe USD0.15 reserve cap');
  active++;peak=Math.max(peak,active);const start=performance.now();
  try{
   const response=await fetch(process.env.QWEN_BASE_URL.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+process.env.QWEN_API_KEY,'Content-Type':'application/json'},body:payload,signal:AbortSignal.timeout(30000)});
   const headers={};for(const [k,v] of response.headers)if(/^(x-)?ratelimit|^retry-after$|^x-dashscope-(rpm|tpm|quota)/i.test(k))headers[k]=v;
   const body=await response.json();if(body.usage)estimatedUSD+=(body.usage.prompt_tokens*.1356+body.usage.completion_tokens*.4584)/1e6-reserved;
   return {status:response.status,elapsedMs:performance.now()-start,quotaHeaders:headers,usage:body.usage??null};
  }catch(error){return {status:null,elapsedMs:performance.now()-start,error:error instanceof Error?error.name:'unknown'};}
  finally{active--;}
 }));
 levels.push({concurrency,results});await writeFile(join(out,'result.json'),JSON.stringify({levels,peak,calls,estimatedUSD,officialAccountLimit:null,scope:'Small one-image requests only; successes are a tested lower bound, not a maximum or large-window SLO.'},null,2));
 if(results.some(r=>r.status!==200))break;
 await new Promise(r=>setTimeout(r,1500));
}
console.log(JSON.stringify({out,peak,calls,estimatedUSD,levels:levels.map(l=>({concurrency:l.concurrency,statuses:l.results.map(r=>r.status)})),officialAccountLimit:null}));
