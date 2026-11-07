import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {readFile,readdir,realpath,appendFile,mkdir} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,basename} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import type {AuditBundle} from '../sim/evaluation/holistic-memory-bundle.js';
import {groupedMemoryReport,readWindowVerdicts,type GroupRow} from '../sim/evaluation/grouped-memory-report.js';

const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const json=(res:ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(value));};
const send=(res:ServerResponse,status:number,type:string,body:string|Buffer)=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});res.end(body);};
class HttpError extends Error{constructor(readonly status:number,message:string){super(message);}}
const readBody=async(req:IncomingMessage)=>{let raw='';for await(const chunk of req){raw+=chunk.toString('utf8');if(Buffer.byteLength(raw)>32000)throw new HttpError(413,'Review body too large');}try{return JSON.parse(raw);}catch{throw new HttpError(400,'Invalid JSON');}};
const time=(ms:number)=>{const s=Math.floor(ms/1000);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};

type Review={targetType:'group'|'window'|'observation';targetId:string;verdict:'agree'|'disagree'|'unsure';note:string;at:string};
type Config={run:string;judge:string;reference:string;webRoot?:string};

/** Loopback-only, read-only review page for one completed run plus its judge output.
 * The only write is an append-only human-review journal outside the production DB. */
export async function createSpatialMemoryReviewServer(config:Config){
 const run=await realpath(config.run),judge=await realpath(config.judge),webRoot=resolve(config.webRoot??'web/memory-review');
 const receipt=JSON.parse((await readFile(join(run,'complete.json'))).toString());
 if(receipt?.completed!==true)throw Error('Require a completed run receipt');
 const bundleBytes=await readFile(join(judge,'bundle.json')),bundle=JSON.parse(bundleBytes.toString()) as AuditBundle;
 const referenceBytes=await readFile(config.reference),sample=JSON.parse(referenceBytes.toString());
 // The judge bundle may have applied the user-acceptance overlay in memory. Accept either the
 // exact reference bytes or the human-confirmed derivative that names the same source hashes,
 // then verify the per-observation annotations used by the judge are identical.
 const derived=Boolean(sample.humanConfirmed&&sample.humanConfirmed.sourceSampleSHA256===bundle.hashes?.reference&&(!bundle.hashes?.acceptance||sample.humanConfirmed.acceptanceSHA256===bundle.hashes.acceptance));
 if(bundle.hashes?.reference!==hash(referenceBytes)&&!derived)throw Error('Reference file does not match the judge bundle');
 const frameById=new Map<string,any>((sample.frames??[]).map((f:any)=>[f.id,f]));
 let checked=0;
 for(const r of bundle.reference as any[]){
  const f=frameById.get(r.id);if(!f)continue;
  const a=f.annotation;
  if(a.segmentId!==r.annotation.segmentId||a.placeId!==r.annotation.placeId||a.facilityId!==r.annotation.facilityId||a.description!==r.annotation.description)throw Error('Reference annotations differ from the judge bundle: '+r.id);
  checked++;
 }
 if(checked<bundle.reference.length)throw Error('Reference file is missing observations used by the judge');
 const dbBytes=await readFile(join(run,'spatial.sqlite'));
 if(bundle.hashes?.database!==hash(dbBytes))throw Error('Run database changed after the judge bundle was built');
 const reportBytes=await readFile(join(judge,'report.json')),report=JSON.parse(reportBytes.toString());
 if(report?.completed!==true)throw Error('Judge report is not completed');
 const verdicts=await readWindowVerdicts(judge);
 const grouped=groupedMemoryReport(bundle,{segments:sample.segments??[]},verdicts);
 const states=bundle.states;
 const stateByVersion=new Map<number,any>(states.map(s=>[s.version,s]));
 const observationById=new Map<string,any>(bundle.observations.map(o=>[o.id,o]));
 const referenceById=new Map<string,any>((bundle.reference as any[]).map(r=>[r.id,r]));
 const windowOf=new Map<string,number>();for(const s of states)for(const id of s.memberIds??[])windowOf.set(id,s.version);
 const segmentOf=new Map<string,string>();for(const id of observationById.keys()){const r=referenceById.get(id);if(r?.annotation?.segmentId)segmentOf.set(id,r.annotation.segmentId);}
 const segmentById=new Map<string,any>((sample.segments??[]).map((s:any)=>[s.id,s]));
 const placeById=new Map<string,any>(bundle.places.map((p:any)=>[p.id,p]));
 const visitById=new Map<string,any>(bundle.visits.map((v:any)=>[v.id,v]));
 const notes=(bundle.claims.filter(c=>c.id.startsWith('note:')).map(c=>c.value) as any[]);
 const revisions=(bundle.revisions??[]) as any[];
 const findings=(report.findings??[]) as any[];

 const comparisonByVersion=new Map<number,any>();
 const comparisonFiles=(await readdir(judge)).filter(n=>/^comparison-\d+\.json$/.test(n)).sort();
 for(const file of comparisonFiles){const raw=JSON.parse((await readFile(join(judge,file))).toString());for(const w of raw.windows??[])comparisonByVersion.set(w.version,w);}
 const groundingByVersion=new Map<number,any>();
 for(const file of (await readdir(judge)).filter(n=>/^grounding-\d+\.json$/.test(n)).sort()){const raw=JSON.parse((await readFile(join(judge,file))).toString());for(const w of raw.windows??[])groundingByVersion.set(w.version,w);}
 const sheetByVersion=new Map<number,any>();
 try{const manifest=JSON.parse((await readFile(join(judge,'sheets/manifest.json'))).toString()) as any[];for(const s of manifest)sheetByVersion.set(s.version,s);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}

 const originalsRoot=await realpath(join(run,'originals'));
 const sheetsRoot=await realpath(join(judge,'sheets')).catch(()=>null);
 const reviewDir=join(run,'web-review');await mkdir(reviewDir,{recursive:true});
 const reviewPath=join(reviewDir,'reviews.jsonl'),reviews:Review[]=[];
 for(const line of (await readFile(reviewPath,'utf8').catch(()=>'' )).split('\n')){if(!line.trim())continue;try{reviews.push(JSON.parse(line));}catch{throw Error('Invalid review journal line');}}
 const token=randomBytes(24).toString('hex');

 const groupOfVersion=new Map<number,GroupRow>();
 for(const group of grouped.groups)for(const w of group.windows)groupOfVersion.set(w.version,group);

 const compact=(s:any)=>{
  const cmp=comparisonByVersion.get(s.version),loc=s.assessment?.location??{};
  const counts=new Map<string,number>();for(const id of s.memberIds??[]){const seg=segmentOf.get(id);if(seg)counts.set(seg,(counts.get(seg)??0)+1);}
  const segmentId=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]??null;
  const group=groupOfVersion.get(s.version)??null;
  return {version:s.version,observationId:s.observationId,atMs:s.atMs,startMs:s.window?.startMs??null,endExclusiveMs:s.window?.endExclusiveMs??null,
   memberIds:s.memberIds??[],placeId:loc.placeId??null,placeName:loc.name??null,status:loc.status??null,boundary:loc.boundary??null,
   locationDecision:s.locationDecision??null,visitId:s.visitId??null,segmentId,
   identity:cmp?.identity?.verdict??null,currentReason:cmp?.currentReason?.verdict??null,windowScope:cmp?.windowScope?.verdict??null,
   group:{segmentId:group?.segmentId??null,score:group?.identityScore??null,referencePlace:group?.placeId??null}};
 };

 const windowDetail=(version:number)=>{
  const s=stateByVersion.get(version);if(!s)throw new HttpError(404,'Unknown window '+version);
  const loc=s.assessment?.location??{},cmp=comparisonByVersion.get(version)??null;
  const observations=(s.memberIds??[]).map((id:string)=>{
   const o=observationById.get(id),r=referenceById.get(id);
   return {id,atMs:o?.atMs??null,sourceAtMs:o?.sourceAtMs??null,facts:o?.facts??null,
    views:(o?.views??[]).map((v:any)=>({direction:v.direction,url:`/original/${encodeURIComponent(id)}/${encodeURIComponent(v.direction)}`,sha256:v.sha256})),
    reference:r?.annotation??null};
  });
  const place=loc.placeId?placeById.get(loc.placeId)??null:null,visit=s.visitId?visitById.get(s.visitId)??null:null;
  return {...compact(s),assessment:s.assessment,memoryReceipt:s.memoryReceipt??null,observations,
   grounding:groundingByVersion.get(version)??null,comparison:cmp,
   findings:findings.filter(f=>f.version===version),
   group:grouped.groups.find(g=>g.windows.some(w=>w.version===version)||g.crossWindows.some(w=>w.version===version))??null,
   place,visit,notes:place?notes.filter(n=>n.place_id===place.id):[],revisions:place?revisions.filter(r=>r.place_id===place.id):[],
   sheetUrl:sheetByVersion.has(version)?`/sheet/${version}`:null};
 };

 const overview=()=>({
  schema:'spatial-memory-review-page-v1',
  run:{id:basename(run),path:run,hashes:bundle.hashes,integrity:bundle.integrity,receipt:{observations:receipt.observations,spatialStates:receipt.spatialStates,skippedWindows:receipt.skippedWindows,skippedObservations:receipt.skippedObservations,coveredObservations:receipt.coveredObservations,windowMs:receipt.windowMs,mode:receipt.mode,extractionMode:receipt.extractionMode,realtimeEnforced:receipt.realtimeEnforced,elapsedMs:receipt.elapsedMs,realtime:receipt.realtime??null}},
  judge:{dir:judge,model:report.model,overall:report.scores,coverage:report.coverage,coverageScope:report.coverageScope,gate:report.gate,authority:report.authority||null,limitations:report.limitations??null},
  grouped:{summary:grouped.summary,coverage:grouped.coverage,transitions:grouped.transitions,merges:grouped.merges,splits:grouped.splits,revisits:grouped.revisits,note:grouped.note},
  groups:grouped.groups,segments:sample.segments??[],
  windows:states.map(compact),findings,
  skipped:bundle.observations.filter(o=>!windowOf.has(o.id)).map(o=>{const r=referenceById.get(o.id);return {id:o.id,atMs:o.atMs,sourceAtMs:o.sourceAtMs,reference:r?.annotation??null};}),
  places:bundle.places,visits:bundle.visits,notes,revisions,
  reviews,reviewToken:token,
  tools:[
   {name:'空间记忆审核（本页）',port:8892,command:'npm run review:memory',models:false},
   {name:'桌面助手 / 实时回放',port:8880,command:'npm run assistant:web',models:false},
   {name:'实时系统',port:8884,command:'npm run realtime',models:true},
   {name:'EgoLife 只读评测',port:8886,command:'npm run evaluation:web',models:false},
   {name:'标注审核（旧的 oracle 样本）',port:8891,command:'node dist/current/desktop/annotation-review-server.js ROOT',models:false},
   {name:'区域审核站（Python）',port:8879,command:'python sim/serve_review_site.py --directory run/review-site --port 8879',models:false},
   {name:'移动试玩',port:8765,command:'npm run trial:web',models:true}
  ]
 });

 const originalImage=async(obsId:string,direction:string)=>{
  const o=observationById.get(obsId),view=o?.views?.find((v:any)=>v.direction===direction);
  if(!view)throw new HttpError(404,'Unknown observation view');
  const path=join(originalsRoot,`${view.sha256}.png`);
  const real=await realpath(path).catch(()=>null);if(!real)throw new HttpError(404,'Original image missing');
  const rel=relative(originalsRoot,real);if(rel.startsWith('..')||isAbsolute(rel))throw new HttpError(403,'Original outside run');
  const bytes=await readFile(real);if(hash(bytes)!==view.sha256)throw new HttpError(409,'Original image hash changed');
  return bytes;
 };
 const sheetImage=async(version:number)=>{
  const sheet=sheetByVersion.get(version);if(!sheet||!sheetsRoot)throw new HttpError(404,'No judge sheet');
  const path=join(sheetsRoot,basename(sheet.path)),real=await realpath(path).catch(()=>null);if(!real)throw new HttpError(404,'Judge sheet missing');
  const rel=relative(sheetsRoot,real);if(rel.startsWith('..')||isAbsolute(rel))throw new HttpError(403,'Judge sheet outside judge dir');
  const bytes=await readFile(real);if(hash(bytes)!==sheet.sha256)throw new HttpError(409,'Judge sheet hash changed');
  return bytes;
 };

 const server=createServer((req,res)=>{void(async()=>{
  const host=req.headers.host??'';
  if(!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host))throw new HttpError(403,'Loopback host required');
  const url=new URL(req.url??'/',`http://${host}`),path=url.pathname;
  if(req.method==='POST'&&path==='/api/review'){
   if(req.headers.origin!==`http://${host}`||req.headers['x-review-token']!==token||!req.headers['content-type']?.startsWith('application/json'))throw new HttpError(403,'Same-origin review authorization required');
   const body=await readBody(req);
   if(!body||Object.keys(body).some(k=>!['targetType','targetId','verdict','note'].includes(k)))throw new HttpError(400,'Invalid review fields');
   const targetType=body.targetType,targetId=String(body.targetId??'');
   if(!['group','window','observation'].includes(targetType)||!['agree','disagree','unsure'].includes(body.verdict)||typeof body.note!=='string'||body.note.length>2000)throw new HttpError(400,'Invalid review');
   if(targetType==='group'&&!segmentById.has(targetId))throw new HttpError(404,'Unknown group');
   if(targetType==='window'&&!stateByVersion.has(Number(targetId)))throw new HttpError(404,'Unknown window');
   if(targetType==='observation'&&!observationById.has(targetId))throw new HttpError(404,'Unknown observation');
   const review:Review={targetType,targetId,verdict:body.verdict,note:body.note,at:new Date().toISOString()};
   await appendFile(reviewPath,JSON.stringify(review)+'\n');reviews.push(review);json(res,200,{review,reviews});return;
  }
  if(req.method!=='GET')throw new HttpError(405,'Read-only except explicit review saves');
  if(path==='/api/overview'){json(res,200,overview());return;}
  if(path.startsWith('/api/group/')){
   const id=decodeURIComponent(path.slice('/api/group/'.length));
   const group=grouped.groups.find(g=>g.segmentId===id);if(!group)throw new HttpError(404,'Unknown group');
   const segment=segmentById.get(id)??null;
   const skipped=(sample.frames??[]).filter((f:any)=>f.annotation?.segmentId===id&&!windowOf.has(f.id)).map((f:any)=>({id:f.id,atMs:f.atMs,sourceAtMs:f.sourceAtMs,reference:f.annotation}));
   json(res,200,{group,segment,skipped:skipped.map((x:any)=>({...x,detail:referenceById.get(x.id)?.annotation??x.reference})),windows:group.windows.map(w=>({...windowDetail(w.version),share:w.share,members:w.members})),crossWindows:group.crossWindows.map(w=>({...windowDetail(w.version),members:w.members}))});return;
  }
  if(path.startsWith('/api/window/')){const version=Number(path.slice('/api/window/'.length));if(!Number.isInteger(version))throw new HttpError(400,'Invalid window');json(res,200,windowDetail(version));return;}
  if(path==='/api/frames'){
   const observations=bundle.observations.map(o=>{
    const r=referenceById.get(o.id)?.annotation??null,version=windowOf.get(o.id)??null,state=version?stateByVersion.get(version):null,cmp=version?comparisonByVersion.get(version):null,loc=state?.assessment?.location??null;
    return {id:o.id,atMs:o.atMs,sourceAtMs:o.sourceAtMs,reference:r,version,skipped:version===null,
     placeId:loc?.placeId??null,placeName:loc?.name??null,status:loc?.status??null,reason:loc?.reason??null,
     identity:cmp?.identity?.verdict??null,currentReason:cmp?.currentReason?.verdict??null,windowScope:cmp?.windowScope?.verdict??null,
     identityReason:cmp?.identity?.reason??null,summary:(o.facts as any)?.summary??null,
     views:(o.views??[]).map((v:any)=>({direction:v.direction,url:`/original/${encodeURIComponent(o.id)}/${encodeURIComponent(v.direction)}`,sha256:v.sha256}))};
   });
   json(res,200,{observations});return;
  }
  if(path==='/api/export'){json(res,200,{...overview(),reviewToken:undefined});return;}
  if(path.startsWith('/original/')){const parts=path.split('/'),obsId=parts[2],dir=parts[3];if(!obsId||!dir)throw new HttpError(400,'Invalid original path');const bytes=await originalImage(decodeURIComponent(obsId),decodeURIComponent(dir));send(res,200,'image/png',bytes);return;}
  if(path.startsWith('/sheet/')){const version=Number(path.slice('/sheet/'.length));const bytes=await sheetImage(version);send(res,200,'image/png',bytes);return;}
  const assets:Record<string,[string,string]>={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
  const asset=assets[path];if(!asset)throw new HttpError(404,'Not found');
  send(res,200,asset[1],await readFile(join(webRoot,asset[0])));
 })().catch(error=>{if(!res.headersSent)json(res,error instanceof HttpError?error.status:500,{error:error instanceof HttpError?error.message:'Review service could not complete request'});else res.end();});});
 return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const arg=(name:string,fallback:string)=>process.argv.slice(2).find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
 const run=arg('run','run/unioncity-memory-full813-rt-w16-batchfix2-v1');
 const judge=arg('judge','run/unioncity-memory-full813-rt-w16-batchfix2-judge-accepted');
 const reference=arg('reference','run/gmod-annotated-rerender-v2-final/sample-human-confirmed.json');
 const port=Number(arg('port','8892'));
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid port');
 const server=await createSpatialMemoryReviewServer({run,judge,reference});
 server.listen(port,'127.0.0.1',()=>console.log(`空间记忆审核（只读，除人工审核记录外不写库）: http://127.0.0.1:${port}/`));
}
