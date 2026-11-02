import {mkdir,writeFile,appendFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {spatialJsonVlm} from '../../agent/spatial-json-vlm.js';
import {createSpatialSession} from '../../assistant/harness/spatial-session.js';
import {pipelineSources,type PipelinePlan} from './spatial-evaluation-pipeline.js';

const [planArg,outArg,confirm,...flags]=process.argv.slice(2);
if(!planArg||!outArg||confirm!=='--confirm-paid')throw Error('Usage: run-fast-spatial-replay PLAN NEW-OUTPUT --confirm-paid [--concurrency=N] [--limit=N]');
const flag=(name:string)=>{const value=flags.find(f=>f.startsWith(`--${name}=`));return value?Number(value.split('=')[1]):undefined;};
const concurrency=flag('concurrency')??8,limit=flag('limit');
if(!Number.isInteger(concurrency)||concurrency<1||concurrency>24)throw Error('Concurrency must be 1-24');
const raw=await readFile(planArg),plan=JSON.parse(raw.toString()) as PipelinePlan;
const {selected,seeds}=await pipelineSources(plan),rows=limit?selected.slice(0,limit):selected;
if(limit!==undefined&&(!Number.isInteger(limit)||limit<1||limit>selected.length))throw Error('Invalid limit');
const out=resolve(outArg);await mkdir(out,{recursive:false});
await writeFile(join(out,'plan.json'),raw,{flag:'wx'});
await writeFile(join(out,'fast-manifest.json'),JSON.stringify({schema:'fast-spatial-replay-v1',planSHA256:createHash('sha256').update(raw).digest('hex'),concurrency,limit:limit??selected.length,prefixSources:seeds.length,scope:'Parallel independent per-frame perception for speed; ordered single-writer spatial commits; no history in perception. Benchmark/partial runs are not full-memory certification.'},null,2));
const spatial=join(out,'spatial'),session=await createSpatialSession(spatial,spatialJsonVlm(join(spatial,'requests'),plan.maxInferenceCalls,10,true,1600),{diagnosticEvidenceLedger:true,diagnosticPerView:true,diagnosticInitialSources:seeds,diagnosticTaskForObservation:id=>plan.probeIds.includes(id)?'核查是否有具体历史来源支持与当前观察的关联。最近窗口不是全部历史，可使用已声明的记忆工具自主浏览、搜索和细读。只有证据足够时才保存解释并引用来源；证据不足允许不提出关系，不默认同一地点或新地点。随后record_context结束本轮。':null});
const queue:Array<{row:any;promise:Promise<any>}>=[];
let next=0,settled=0,started=Date.now(),failed=false;
try{
 while(next<rows.length||queue.length){
  while(!failed&&queue.length<concurrency&&next<rows.length){const row=rows[next++]!;queue.push({row,promise:session.inspect(row)});}
  if(!queue.length)break;
  const item=queue.shift()!;
  try{
   const evidence=await item.promise;
   const checkpoint=await session.observe(item.row,evidence);
   settled++;await appendFile(join(out,'observations.jsonl'),JSON.stringify({id:item.row.id,status:'completed',checkpoint,error:null})+'\n');
   if(settled%10===0)console.log(JSON.stringify({stage:'fast-spatial',settled,planned:rows.length,elapsedSec:Math.round((Date.now()-started)/1000),concurrency}));
  }catch(error){
   failed=true;await appendFile(join(out,'observations.jsonl'),JSON.stringify({id:item.row.id,status:'failed',checkpoint:null,error:String(error)})+'\n');
   // Preserve already-extracted futures as not_run; do not skip the failed state.
   for(const pending of queue)await appendFile(join(out,'observations.jsonl'),JSON.stringify({id:pending.row.id,status:'not_run',checkpoint:null,error:'Earlier frame failed; ordered suffix stopped'})+'\n');
   throw error;
  }
 }
}finally{
 await session.close();
 await writeFile(join(out,'inference-complete.json'),JSON.stringify({completed:!failed,planned:rows.length,committed:settled,elapsedMs:Date.now()-started,concurrency}));
}
if(failed)process.exitCode=1;
else console.log(JSON.stringify({stage:'complete',settled,planned:rows.length,elapsedSec:Math.round((Date.now()-started)/1000),concurrency}));
