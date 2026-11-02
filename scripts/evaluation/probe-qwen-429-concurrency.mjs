/** Bounded concurrency/429 probe. Small one-image requests; not an account-quota API. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';

const [imageArg,outArg,confirm,...flags]=process.argv.slice(2);
const maxFlag=flags.find(f=>f.startsWith('--max=')),max=maxFlag?Number(maxFlag.split('=')[1]):16;
if(!imageArg||!outArg||confirm!=='--confirm-paid'||!Number.isInteger(max)||max<2||max>24||flags.some(f=>!f.startsWith('--max=')))throw Error('Usage: probe-qwen-429-concurrency IMAGE NEW-OUT --confirm-paid [--max=16]');
if(!process.env.QWEN_API_KEY||!process.env.QWEN_BASE_URL)throw Error('Missing provider configuration');
const bytes=await readFile(resolve(imageArg));
if(bytes.length>2_000_000||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Expected bounded PNG');
const out=resolve(outArg);await mkdir(out,{recursive:false});
const payload=JSON.stringify({model:'qwen3.8-flash',enable_thinking:false,temperature:0,max_tokens:32,response_format:{type:'json_object'},messages:[{role:'user',content:[{type:'text',text:'只输出JSON：{"scene":"不超过10个汉字"}'},{type:'image_url',image_url:{url:'data:image/png;base64,'+bytes.toString('base64')}}]}]});
const levels=[],reserved=(32000*.1356+32*.4584)/1e6;let calls=0,estimatedUSD=0,peakSuccess=0,first429=null;
const targets=[...new Set([4,8,12,16,max].filter(n=>n<=max))].sort((a,b)=>a-b);
for(const concurrency of targets){
 let active=0;const started=performance.now();
 const results=await Promise.all(Array.from({length:concurrency},async()=>{
  calls++;estimatedUSD+=reserved;if(estimatedUSD>.30)throw Error('Probe estimated-reserve cap');
  active++;
  try{
   const begin=performance.now();
   const response=await fetch(process.env.QWEN_BASE_URL.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+process.env.QWEN_API_KEY,'Content-Type':'application/json'},body:payload,signal:AbortSignal.timeout(60000)});
   const text=await response.text(),headers={};
   for(const [k,v] of response.headers)if(/^(x-)?ratelimit|^retry-after$|^x-dashscope-(rpm|tpm|quota)/i.test(k))headers[k]=v;
   let usage=null;try{usage=JSON.parse(text).usage??null;}catch{}
   if(usage&&Number.isFinite(usage.prompt_tokens))estimatedUSD+=(usage.prompt_tokens*.1356+usage.completion_tokens*.4584)/1e6-reserved;
   return {status:response.status,elapsedMs:performance.now()-begin,quotaHeaders:headers,usage,errorText:response.ok?null:text.slice(0,300)};
  }catch(error){return {status:null,error:error instanceof Error?error.name:String(error)};}
  finally{active--;}
 }));
 const level={concurrency,wallMs:performance.now()-started,results};
 levels.push(level);
 const statuses=results.map(r=>r.status),ok=statuses.filter(s=>s===200).length;
 if(ok===concurrency)peakSuccess=Math.max(peakSuccess,concurrency);
 if(statuses.includes(429)&&!first429)first429={concurrency,statuses};
 await writeFile(join(out,'result.json'),JSON.stringify({schema:'qwen-429-probe-v1',model:'qwen3.8-flash',targets,calls,estimatedUSD,peakAllSuccess:peakSuccess,first429,levels,scope:'Small one-image requests in one short burst. All-200 is a tested lower bound, not an account maximum; 429 identifies a limit for this payload/time, not a permanent quota.'},null,2));
 console.log(JSON.stringify({stage:'probe',concurrency,statuses,calls}));
 if(first429)break;
 await new Promise(r=>setTimeout(r,3000));
}
console.log(JSON.stringify({out,calls,estimatedUSD,peakAllSuccess:peakSuccess,first429,levels:levels.map(l=>({concurrency:l.concurrency,statuses:l.results.map(r=>r.status)}))}));
