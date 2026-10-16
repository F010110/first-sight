import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { SpatialObservation } from './incremental-spatial-memory.js';
import type { TopologyNode } from './spatial-topology-service.js';

export type VisualFeatures={id:string;features:number[][]};
export type FeatureExtractor=(rows:SpatialObservation[])=>Promise<VisualFeatures[]>;
export function pythonFeatureExtractor(command:string,args:string[]):FeatureExtractor{
 return rows=>new Promise((resolve,reject)=>{
  const child=spawn(command,args,{stdio:['pipe','pipe','pipe']});let out='',err='';
  const timeout=setTimeout(()=>{child.kill();reject(Error('Feature extraction timeout'));},60000);
  child.stdout.on('data',c=>{out+=c;if(out.length>2_000_000){child.kill();reject(Error('Feature output budget exceeded'));}});
  child.stderr.on('data',c=>{err=(err+c).slice(-2000);});child.on('error',e=>{clearTimeout(timeout);reject(e);});
  child.on('close',code=>{clearTimeout(timeout);if(code!==0)reject(Error(`Feature extraction failed ${code}: ${err}`));else try{resolve(JSON.parse(out));}catch(e){reject(e);}});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(rows.map(r=>({id:r.id,frames:r.frames}))));
 });
}
function validate(features:number[][]):void{
 if(!Array.isArray(features)||features.length<1||features.length>4||features.some(v=>v.length!==72||v.some(n=>!Number.isFinite(n)||n<0||n>1)))throw Error('Invalid visual feature vector');
}
export function visualDistance(a:number[][],b:number[][]):number{
 const distance=(x:number[],y:number[])=>x.reduce((sum,v,i)=>sum+(v-y[i]!)**2,0)/x.length;
 const directed=(x:number[][],y:number[][])=>x.reduce((s,v)=>s+Math.min(...y.map(w=>distance(v,w))),0)/x.length;
 return (directed(a,b)+directed(b,a))/2;
}

/** Per-library sidecar: current assignments are resolved at query time, including revisions.
 * Streams all indexed observations: bounded heap/model context, NOT sublinear disk latency.
 */
export class SpatialVisualRecall{
 private db:DatabaseSync;
 constructor(indexPath:string,topologyPath:string,private extract:FeatureExtractor){
  this.db=new DatabaseSync(indexPath);this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS features(id TEXT PRIMARY KEY,version TEXT NOT NULL,raw TEXT NOT NULL)');
  this.db.exec('CREATE TABLE IF NOT EXISTS binding(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
  const bound=this.db.prepare("SELECT value FROM binding WHERE key='topology'").get() as {value:string}|undefined;
  if(bound&&bound.value!==resolve(topologyPath)){this.db.close();throw Error('Visual index belongs to another library path');}
  this.db.prepare("INSERT OR IGNORE INTO binding VALUES('topology',?)").run(resolve(topologyPath));
  this.db.prepare('ATTACH DATABASE ? AS topology').run(topologyPath);
 }
 close(){this.db.close();}
 async index(rows:SpatialObservation[]):Promise<void>{
  const missing=rows.filter(r=>!this.db.prepare('SELECT 1 FROM features WHERE id=? AND version=?').get(r.id,'rgb-layout-v1'));
  if(!missing.length)return;if(missing.length>100)throw Error('Index batch limit');
  const result=await this.extract(missing);
  if(result.length!==missing.length||new Set(result.map(r=>r.id)).size!==missing.length||result.some(r=>!missing.some(m=>m.id===r.id)))throw Error('Feature IDs do not match input');
  for(const row of result)validate(row.features);
  this.db.exec('BEGIN');try{for(const row of result)this.db.prepare('INSERT OR REPLACE INTO features VALUES(?,?,?)').run(row.id,'rgb-layout-v1',JSON.stringify(row.features));this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 async query(rows:SpatialObservation[],asOfMs:number,limit=2){
  if(!Number.isFinite(asOfMs)||!Number.isInteger(limit)||limit<1||limit>6||rows.length<1||rows.length>4)throw Error('Recall scope/budget invalid');
  const vectors=await this.extract(rows);if(vectors.length!==rows.length||new Set(vectors.map(v=>v.id)).size!==rows.length||vectors.some(v=>!rows.some(r=>r.id===v.id)))throw Error('Query feature IDs mismatch');for(const v of vectors)validate(v.features);
  const best=new Map<string,{placeId:string;observationId:string;score:number}>();let scanned=0;
  const iterator=this.db.prepare(`SELECT f.id,f.raw,a.place_id FROM features f JOIN topology.observations o ON o.id=f.id JOIN topology.assignments a ON a.observation_id=o.id JOIN topology.places p ON p.id=a.place_id WHERE f.version='rgb-layout-v1' AND o.at_ms<? AND p.status!='retired' ORDER BY o.seq`).iterate(asOfMs);
  for(const value of iterator){const row=value as {id:string;raw:string;place_id:string};if(rows.some(r=>r.id===row.id))continue;scanned++;
   const features=JSON.parse(row.raw) as number[][];validate(features);const score=Math.min(...vectors.map(v=>visualDistance(v.features,features)));
   const old=best.get(row.place_id);if(!old||score<old.score)best.set(row.place_id,{placeId:row.place_id,observationId:row.id,score});
   if(best.size>limit){const worst=[...best.values()].sort((a,b)=>b.score-a.score)[0]!;best.delete(worst.placeId);}
  }
  const hits=[...best.values()].sort((a,b)=>a.score-b.score).map(hit=>{
   const p=this.db.prepare('SELECT raw FROM topology.places WHERE id=?').get(hit.placeId) as {raw:string};
   const o=this.db.prepare('SELECT raw FROM topology.observations WHERE id=?').get(hit.observationId) as {raw:string};
   const node=JSON.parse(p.raw) as TopologyNode;
   return {...hit,node:{...node,representatives:[JSON.parse(o.raw) as SpatialObservation]}};
  });return {hits,scanned,method:'rgb-layout-v1',note:'Coarse visual candidates only; VLM must compare original evidence. No similarity threshold establishes identity.'};
 }
}
