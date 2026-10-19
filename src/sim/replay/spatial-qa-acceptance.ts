/** Bounded desktop QA acceptance. Expectations stay outside model inputs. */
import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {SpatialRetriever} from '../../agent/spatial-retrieve.js';
import {RequestAgent} from '../../agent/request-agent.js';

const [database,dataset,plan,output,paid]=process.argv.slice(2);
if(!database||!dataset||!plan||!output||paid!=='--confirm-paid')throw Error('Usage: database dataset plan NEW-output --confirm-paid');
const cases=JSON.parse(await readFile(plan,'utf8')) as Array<{id:string;question:string;asOfMs:number;recordingId:string;currentId:string}>;
if(!Array.isArray(cases)||cases.length<1||cases.length>4||new Set(cases.map(c=>c.id)).size!==cases.length)throw Error('QA limit 1..4 unique cases');
const observations=(await readFile(join(dataset,'observations.jsonl'),'utf8')).trim().split(/\r?\n/).map(l=>JSON.parse(l));
await mkdir(output,{recursive:false});await writeFile(join(output,'plan.json'),JSON.stringify(cases,null,2));
const retriever=new SpatialRetriever(resolve(database));const results=[];
try{
 for(const c of cases){
  if(!/^[a-z0-9-]+$/.test(c.id)||!c.question||c.question.length>1000||!Number.isFinite(c.asOfMs))throw Error('Invalid case');
  const current=observations.find(o=>o.id===c.currentId);if(!current)throw Error('Missing current frame');
  const session=retriever.session({recordingId:c.recordingId,asOfMs:c.asOfMs},6);
  const trace:unknown[]=[];const agent=new RequestAgent(null,session,event=>{trace.push(event);});agent.set('ask',c.question);
  try{const result=await agent.observe([{id:current.id,path:resolve(dataset,current.cameras.front),timestampMs:current.atMs}],null,null);results.push({id:c.id,result});}
  catch(error){results.push({id:c.id,error:String(error)});}
  await writeFile(join(output,c.id+'-trace.json'),JSON.stringify(trace,null,2));
  await writeFile(join(output,'results.json'),JSON.stringify(results,null,2));
  if('error' in results.at(-1)!)break;
 }
 await appendFile(join(output,'complete.json'),JSON.stringify({plannedCases:cases.length,processedCases:results.length,status:results.some(r=>'error' in r)?'stopped-on-error':'completed',maximumProviderCalls:cases.length*8,note:'Real RequestAgent retrieval/image/citation loop. Results require independent visual grading; no automatic accuracy claim.'},null,2));
}finally{retriever.close();}
