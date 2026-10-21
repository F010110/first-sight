import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {SpatialRetriever,type RetrievalSession} from '../agent/spatial-retrieve.js';
import type {SpatialObservation} from '../agent/incremental-spatial-memory.js';
import type {SpatialContextView} from '../agent/spatial-working-context.js';
import {shortLocation} from './playback-timeline.js';

export interface MemorySnapshot {availableAtMs:number;observationIds:string[];context:SpatialContextView}
export interface PreparedObservation {observation:SpatialObservation;sha256:string[];availableAtMs:number}
/** Immutable producer artifact. Only snapshots visible at the requested time enter QA. */
export class PreparedMemory {
 private readonly db:DatabaseSync;
 private readonly retrieval:SpatialRetriever;
 private constructor(readonly root:string,private readonly rows:PreparedObservation[],private readonly snapshots:MemorySnapshot[],readonly fingerprint:string){
  this.db=new DatabaseSync(join(root,'memory.sqlite'),{readOnly:true});this.retrieval=new SpatialRetriever(join(root,'memory.sqlite'));
  const count=this.db.prepare('SELECT COUNT(*) AS n FROM observations WHERE pending=0').get() as {n:number};
  if(count.n!==rows.length){this.retrieval.close();this.db.close();throw Error('Prepared memory is incomplete');}
 }
 select(id:string){const row=this.rows.find(row=>row.observation.id===id);if(!row)throw Error('Observation not in prepared memory');return structuredClone(row);}
 selectAt(atMs:number){const row=[...this.rows].reverse().find(row=>row.observation.atMs<=atMs);if(!row)throw Error('No observation available at this time');return structuredClone(row);}
 /** Resolve public source addresses only, never evaluation evidence/labels. */
 requirements(text:string,current:SpatialObservation){
  const question=text.split('\n仅作指代背景')[0]!;
  const groups:Array<{address:string;ids:string[];afterMs:number;beforeMs:number}>=[];
  for(const match of question.matchAll(/(?<!\d)(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(?!\d)/g)){
   const [h,m,s]=match.slice(1,4).map(Number);if(h!>23||m!>59||s!>59)throw Error('Invalid public question time');
   const afterMs=(h!*3600+m!*60+s!)*1000+Math.round(Number(match[4]??0)*1000),beforeMs=afterMs+(match[4]?0:999);
   groups.push({address:match[0],afterMs,beforeMs,ids:this.rows.filter(row=>row.observation.atMs>=afterMs&&row.observation.atMs<=beforeMs&&row.observation.atMs<current.atMs).map(row=>row.observation.id)});
  }
  for(const match of question.matchAll(/第\s*(\d+)\s*段\s*([\d.]+)\s*秒/g)){
   const found=this.rows.filter(row=>row.observation.recordingId===`campus-episode-${Number(match[1])}`&&Math.abs((row.observation.sourceAtMs??-Infinity)-Number(match[2])*1000)<1&&row.observation.atMs<current.atMs);
   groups.push({address:match[0],ids:found.map(row=>row.observation.id),afterMs:found[0]?.observation.atMs??-1,beforeMs:found.at(-1)?.observation.atMs??-1});
  }
  return {groups,requiredIds:[...new Set([...question.includes('当前')?[current.id]:[],...groups.flatMap(group=>group.ids)])],unresolved:groups.some(group=>group.ids.length!==1)};
 }
 positionTimeline(){return this.snapshots.map(snapshot=>({atMs:snapshot.availableAtMs,episodeNumber:Number(snapshot.context.current?.recordingId?.match(/^campus-episode-(\d+)$/)?.[1]??0),name:shortLocation(snapshot.context.location?.reason??'',snapshot.context.location?.placeId??null)}));}
 context(atMs:number,current:SpatialObservation){
  if(current.atMs>atMs)throw Error('Current observation lies in the future');
  const snapshot=[...this.snapshots].reverse().find(row=>row.availableAtMs<=atMs);
  const context:SpatialContextView=snapshot?structuredClone(snapshot.context):{version:1,current:null,location:null,recent:[],anchors:[],retrieved:[],outputs:[],compression:{discarded:0,policy:'recent-and-place-anchors',rawMemoryDeleted:false}};
  // Advancing the camera never inherits a previous place as the current identity.
  if(context.current?.id!==current.id){context.location=null;context.retrieved=[];}
  context.recent=context.recent.filter(row=>row.atMs>=atMs-60000);context.anchors=context.anchors.filter(row=>row.atMs>=atMs-60000);context.outputs=context.outputs.filter(row=>row.atMs>=atMs-60000);
  context.current=structuredClone(current);return context;
 }
 session(atMs:number):RetrievalSession{
  return this.retrieval.session({asOfMs:atMs-1,judgmentUnavailableIds:this.rows.filter(row=>row.availableAtMs>atMs).map(row=>row.observation.id)},12,16);
 }
 async images(row:PreparedObservation){
  return Promise.all(row.observation.frames.map(async(path,index)=>{
   const bytes=await readFile(path);if(createHash('sha256').update(bytes).digest('hex')!==row.sha256[index])throw Error('Prepared original image changed');
   return {id:row.observation.id,mimeType:path.toLowerCase().endsWith('.png')?'image/png':'image/jpeg',data:bytes.toString('base64')};
  }));
 }
 close(){this.retrieval.close();this.db.close();}
 static async open(root:string){
  const manifest=JSON.parse(await readFile(join(root,'complete.json'),'utf8'));
  if(manifest.schema!=='prepared-spatial-memory-v1')throw Error('Unsupported prepared spatial memory');
  for(const [name,expected] of Object.entries(manifest.hashes as Record<string,string>)){
   if(!['memory.sqlite','observations.json','contexts.jsonl'].includes(name))throw Error('Invalid prepared memory file');
   if(createHash('sha256').update(await readFile(join(root,name))).digest('hex')!==expected)throw Error('Prepared memory integrity mismatch');
  }
  if(Object.keys(manifest.hashes).length!==3)throw Error('Incomplete prepared memory binding');
  const rows:PreparedObservation[]=JSON.parse(await readFile(join(root,'observations.json'),'utf8'));
  const raw=await readFile(join(root,'contexts.jsonl'),'utf8');const snapshots:MemorySnapshot[]=raw.trim()?raw.trim().split('\n').map(line=>JSON.parse(line)):[];
  let last=-Infinity;const ids=new Set<string>();
  for(const row of rows){if(!row.observation.id||ids.has(row.observation.id)||!Number.isFinite(row.observation.atMs)||row.observation.atMs<=last||!Number.isFinite(row.availableAtMs)||row.availableAtMs<row.observation.atMs||row.sha256.length!==row.observation.frames.length)throw Error('Invalid prepared observation');last=row.observation.atMs;ids.add(row.observation.id);}
  last=-Infinity;
  for(const snapshot of snapshots){
   if(!Number.isFinite(snapshot.availableAtMs)||snapshot.availableAtMs<last||snapshot.context.current&&snapshot.context.current.atMs>snapshot.availableAtMs)throw Error('Invalid context availability');
   if([...snapshot.context.recent,...snapshot.context.anchors,...snapshot.context.retrieved,...snapshot.context.outputs].some(row=>row.atMs>snapshot.availableAtMs))throw Error('Future fact in prepared Context');
   last=snapshot.availableAtMs;
  }
  return new PreparedMemory(root,rows,snapshots,manifest.hashes['memory.sqlite']);
 }
}
