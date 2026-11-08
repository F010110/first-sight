import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {validateFacts,type Facts,type Observation} from './contracts.js';

export type ArchivedEvidence={sequence:number;observation:Observation;archivedAtMs:number;facts:Facts|null;factsAvailableAtMs:number|null;archivedRevision?:number;factsRevision?:number|null};

/** Independent ingest journal. No spatial version or agent completion is required. */
export class ObservationArchive{
 private db:DatabaseSync;
 constructor(private root:string,private maxBytes:number,private now=Date.now){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error('Archive requires a finite byte budget');
  mkdirSync(join(root,'originals'),{recursive:true});
  this.db=new DatabaseSync(join(root,'observations.sqlite'));
  const tables=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{name:string}>;
  if(tables.length&&!tables.some(t=>t.name==='observation_archive_schema')){this.db.close();throw Error('Refuse to initialize an unversioned/foreign observation archive');}
  if(tables.length&&(this.db.prepare('SELECT version FROM observation_archive_schema').get() as any)?.version!==2){this.db.close();throw Error('Unsupported observation archive schema');}
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS observation_archive_schema(version INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS evidence(seq INTEGER PRIMARY KEY,id TEXT UNIQUE NOT NULL,at_ms REAL NOT NULL,available_ms REAL NOT NULL,raw TEXT NOT NULL,facts TEXT,facts_ms REAL,bytes INTEGER NOT NULL,archived_revision INTEGER NOT NULL,facts_revision INTEGER);
   CREATE TABLE IF NOT EXISTS coverage_gaps(seq INTEGER NOT NULL,lane TEXT NOT NULL,reason TEXT NOT NULL,available_ms REAL NOT NULL,PRIMARY KEY(seq,lane));
   CREATE TABLE IF NOT EXISTS work(seq INTEGER NOT NULL,lane TEXT NOT NULL,status TEXT NOT NULL,job TEXT,PRIMARY KEY(seq,lane));
   CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,lane TEXT NOT NULL,status TEXT NOT NULL,raw TEXT NOT NULL,error TEXT);
   CREATE TABLE IF NOT EXISTS runtime_config(id INTEGER PRIMARY KEY,raw TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS gap_resolutions(seq INTEGER NOT NULL,lane TEXT NOT NULL,available_ms REAL NOT NULL,PRIMARY KEY(seq,lane));
   CREATE TABLE IF NOT EXISTS archive_stats(id INTEGER PRIMARY KEY,bytes INTEGER NOT NULL,revision INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS work_lane_status ON work(lane,status);
   CREATE INDEX IF NOT EXISTS jobs_lane_status ON jobs(lane,status);
   INSERT OR IGNORE INTO archive_stats VALUES(1,0,0);`);
  if(!tables.length)this.db.prepare('INSERT INTO observation_archive_schema VALUES(2)').run();
 }
 append(input:Observation):ArchivedEvidence{
  if(!input.id||!Number.isFinite(input.atMs)||input.atMs<0||input.views.length!==3||new Set(input.views.map(v=>v.direction)).size!==3||input.views.some(v=>v.id!==input.id||!['front','left','right'].includes(v.direction)))throw Error('Invalid source-bound observation');
  const prior=this.db.prepare('SELECT * FROM evidence WHERE id=?').get(input.id) as any;
  if(prior){
   const old:Observation=JSON.parse(prior.raw);
   if(old.atMs!==input.atMs||old.recordingId!==input.recordingId||old.sourceAtMs!==input.sourceAtMs||old.views.some((v,i)=>v.sha256!==input.views[i]?.sha256||v.direction!==input.views[i]?.direction))throw Error('Immutable observation changed');
   return this.decode(prior);
  }
  const last=this.db.prepare('SELECT at_ms FROM evidence ORDER BY seq DESC LIMIT 1').get() as any;
  if(last&&input.atMs<=last.at_ms)throw Error('Nonchronological observation');
  const buffers=input.views.map(v=>{const bytes=readFileSync(v.path);if(createHash('sha256').update(bytes).digest('hex')!==v.sha256)throw Error('Original source hash mismatch');return bytes;});
  const bytes=buffers.reduce((n,b)=>n+b.length,Buffer.byteLength(JSON.stringify(input)));
  const used=(this.db.prepare('SELECT bytes FROM archive_stats WHERE id=1').get() as any).bytes as number;
  if(used+bytes>this.maxBytes)throw Error('Observation archive capacity exhausted; capture must report storage overload');
  // Only public evidence fields cross into either model lane. Never propagate
  // reference annotations or incidental caller metadata from the input object.
  const row:Observation={id:input.id,atMs:input.atMs,...input.sourceAtMs!==undefined?{sourceAtMs:input.sourceAtMs}:{},...input.recordingId!==undefined?{recordingId:input.recordingId}:{},views:input.views.map(v=>({id:v.id,direction:v.direction,path:v.path,sha256:v.sha256}))};
  for(let i=0;i<row.views.length;i++){
   const view=row.views[i]!,path=join(this.root,'originals',view.sha256+'.image');
   try{writeFileSync(path,buffers[i]!,{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;if(createHash('sha256').update(readFileSync(path)).digest('hex')!==view.sha256)throw Error('Archived source changed');}
   view.path=path;
  }
  this.db.exec('SAVEPOINT archive_append');try{this.db.prepare('UPDATE archive_stats SET bytes=bytes+?,revision=revision+1 WHERE id=1').run(bytes);this.db.prepare('INSERT INTO evidence(id,at_ms,available_ms,raw,bytes,archived_revision) VALUES(?,?,?,?,?,?)').run(row.id,row.atMs,this.now(),JSON.stringify(row),bytes,this.revision());this.db.exec('RELEASE archive_append');}catch(error){this.db.exec('ROLLBACK TO archive_append; RELEASE archive_append');throw error;}
  return this.latest()!;
 }
 saveFacts(id:string,value:Facts){
  const facts=validateFacts(value),old=this.db.prepare('SELECT facts,available_ms FROM evidence WHERE id=?').get(id) as any;
  if(!old)throw Error('Unknown observation');
  if(old.facts){if(old.facts!==JSON.stringify(facts))throw Error('Independent facts changed');return;}
  this.db.exec('SAVEPOINT facts_append');try{this.db.prepare('UPDATE archive_stats SET revision=revision+1 WHERE id=1').run();this.db.prepare('UPDATE evidence SET facts=?,facts_ms=?,facts_revision=? WHERE id=?').run(JSON.stringify(facts),Math.max(this.now(),old.available_ms),this.revision(),id);this.db.exec('RELEASE facts_append');}catch(error){this.db.exec('ROLLBACK TO facts_append; RELEASE facts_append');throw error;}
 }
 gap(sequence:number,lane:'perception'|'spatial',reason:string){
  if(!this.db.prepare('SELECT 1 FROM evidence WHERE seq=?').get(sequence)||!reason.trim())throw Error('Invalid coverage gap');
  this.db.prepare('INSERT OR IGNORE INTO coverage_gaps VALUES(?,?,?,?)').run(sequence,lane,reason,this.now());
 }
 revision(){return (this.db.prepare('SELECT revision FROM archive_stats WHERE id=1').get() as any).revision as number;}
 latest(knownAtMs=Number.MAX_SAFE_INTEGER,knownRevision=Number.MAX_SAFE_INTEGER):ArchivedEvidence|null{const row=this.db.prepare('SELECT * FROM evidence WHERE available_ms<=? AND archived_revision<=? ORDER BY seq DESC LIMIT 1').get(knownAtMs,knownRevision);if(!row)return null;const value=this.decode(row);if((value.factsRevision??0)>knownRevision||value.factsAvailableAtMs!==null&&value.factsAvailableAtMs>knownAtMs){value.facts=null;value.factsAvailableAtMs=null;}return value;}
 byIds(ids:string[]):ArchivedEvidence[]{return ids.map(id=>{const row=this.db.prepare('SELECT * FROM evidence WHERE id=?').get(id);if(!row)throw Error('Unknown observation '+id);return this.decode(row);});}
 bySequence(sequence:number):ArchivedEvidence{const row=this.db.prepare('SELECT * FROM evidence WHERE seq=?').get(sequence);if(!row)throw Error('Unknown sequence');return this.decode(row);}
 configure(config:unknown){const raw=JSON.stringify(config),existing=this.db.prepare('SELECT raw FROM runtime_config WHERE id=1').get() as any;if(existing&&existing.raw!==raw)throw Error('Layered recovery configuration changed');if(!existing)this.db.prepare('INSERT INTO runtime_config VALUES(1,?)').run(raw);}
 /** Per-observation admission is durable, before any in-memory task is constructed. */
 admit(sequence:number,lane:'perception'|'spatial',budget:{maxObservations:number;maxBytes:number;maxSpanMs:number}):boolean{
  const prior=this.db.prepare('SELECT status FROM work WHERE seq=? AND lane=?').get(sequence,lane) as any;if(prior)return prior.status!=='gap';
  const current=this.bySequence(sequence);
  const pending=this.db.prepare("SELECT e.seq,e.at_ms,e.bytes FROM work w JOIN evidence e ON e.seq=w.seq WHERE w.lane=? AND w.status IN ('buffered','pending','running') ORDER BY e.seq").all(lane) as any[];
  const bytes=(this.db.prepare('SELECT bytes FROM evidence WHERE seq=?').get(sequence) as any).bytes;
  const accepted=pending.length<budget.maxObservations&&pending.reduce((n,r)=>n+r.bytes,bytes)<=budget.maxBytes&&(!pending.length||current.observation.atMs-pending[0].at_ms<=budget.maxSpanMs);
  this.db.prepare('INSERT INTO work VALUES(?,?,?,NULL)').run(sequence,lane,accepted?'buffered':'gap');
  if(!accepted)this.gap(sequence,lane,lane+'-overload');return accepted;
 }
 buffered(lane:string):ArchivedEvidence[]{return (this.db.prepare("SELECT e.* FROM evidence e JOIN work w ON w.seq=e.seq WHERE w.lane=? AND w.status='buffered' ORDER BY e.seq").all(lane) as any[]).map(r=>this.decode(r));}
 makeJob(lane:'perception'|'spatial',rows:ArchivedEvidence[]){
  if(!rows.length)return;
  const id=lane+':'+rows.map(r=>r.sequence).join(':');
  this.db.exec('SAVEPOINT make_job');try{
   this.db.prepare("INSERT INTO jobs VALUES(?,?,'pending',?,NULL)").run(id,lane,JSON.stringify(rows.map(r=>r.sequence)));
   for(const row of rows){const result=this.db.prepare("UPDATE work SET status='pending',job=? WHERE seq=? AND lane=? AND status='buffered'").run(id,row.sequence,lane);if(result.changes!==1)throw Error('Job source already claimed');}
   this.db.exec('RELEASE make_job');return id;
  }catch(error){this.db.exec('ROLLBACK TO make_job; RELEASE make_job');throw error;}
 }
 jobs(lane:string,status='pending'):Array<{id:string;sequences:number[]}>{return (this.db.prepare('SELECT id,raw FROM jobs WHERE lane=? AND status=? ORDER BY rowid').all(lane,status) as any[]).map(r=>({id:r.id,sequences:JSON.parse(r.raw)}));}
 jobStatus(id:string,status:'running'|'done'|'failed',error?:string){
  this.db.exec('SAVEPOINT job_status');try{
   const job=this.db.prepare('SELECT lane,raw FROM jobs WHERE id=?').get(id) as any;if(!job)throw Error('Unknown job');
   this.db.prepare('UPDATE jobs SET status=?,error=? WHERE id=?').run(status,error??null,id);this.db.prepare('UPDATE work SET status=? WHERE job=?').run(status,id);
   if(status==='done')for(const seq of JSON.parse(job.raw))this.db.prepare('INSERT OR IGNORE INTO gap_resolutions VALUES(?,?,?)').run(seq,job.lane,this.now());
   if(status==='failed')for(const seq of JSON.parse(job.raw))this.gap(seq,job.lane,error??'task-failed');
   this.db.exec('RELEASE job_status');
  }catch(e){this.db.exec('ROLLBACK TO job_status; RELEASE job_status');throw e;}
 }
 workStatus(sequence:number,lane:string):string|null{return (this.db.prepare('SELECT status FROM work WHERE seq=? AND lane=?').get(sequence,lane) as any)?.status??null;}
 reject(sequence:number,lane:'perception'|'spatial',reason:string){this.db.prepare("INSERT INTO work VALUES(?,?,'gap',NULL) ON CONFLICT(seq,lane) DO UPDATE SET status='gap' WHERE work.status='buffered'").run(sequence,lane);this.gap(sequence,lane,reason);}
 recoverJobs(){this.db.exec("UPDATE jobs SET status='pending' WHERE status='running'; UPDATE work SET status='pending' WHERE status='running'");}
 retryFailed(lane:'perception'|'spatial',budget:{maxObservations:number;maxBytes:number;maxSpanMs:number;maxTasks:number},maxAttempts=2){
  // Explicit operator action, not an unlimited background retry loop.
  this.db.exec('CREATE TABLE IF NOT EXISTS job_retries(id TEXT PRIMARY KEY,n INTEGER NOT NULL)');
  this.db.exec('SAVEPOINT retry_jobs');try{
   const failed=this.jobs(lane,'failed');
   const pending=this.db.prepare("SELECT e.seq,e.at_ms,e.bytes FROM evidence e JOIN work w ON w.seq=e.seq WHERE w.lane=? AND w.status IN ('buffered','pending','running')").all(lane) as any[];
   const revived=failed.flatMap(job=>job.sequences.map(seq=>this.db.prepare('SELECT seq,at_ms,bytes FROM evidence WHERE seq=?').get(seq) as any)),all=[...pending,...revived];
   if(all.length>budget.maxObservations||all.reduce((n,r)=>n+r.bytes,0)>budget.maxBytes||all.length&&Math.max(...all.map(r=>r.at_ms))-Math.min(...all.map(r=>r.at_ms))>budget.maxSpanMs||failed.length+this.jobs(lane).length+this.jobs(lane,'running').length>budget.maxTasks)throw Error('Retry would exceed durable backlog capacity; use a separate explicitly scoped repair run');
   for(const job of failed){const n=(this.db.prepare('SELECT n FROM job_retries WHERE id=?').get(job.id) as any)?.n??0;if(n>=maxAttempts)throw Error('Durable retry budget exhausted');this.db.prepare('INSERT INTO job_retries VALUES(?,1) ON CONFLICT(id) DO UPDATE SET n=n+1').run(job.id);this.db.prepare("UPDATE jobs SET status='pending' WHERE id=?").run(job.id);this.db.prepare("UPDATE work SET status='pending' WHERE job=?").run(job.id);}
   this.db.exec('RELEASE retry_jobs');
  }catch(error){this.db.exec('ROLLBACK TO retry_jobs; RELEASE retry_jobs');throw error;}
 }
 validateRecoveryBudget(lane:'perception'|'spatial',budget:{maxObservations:number;maxBytes:number;maxSpanMs:number;maxTasks:number}){
  const p=this.workProgress(lane);if(p.pending>budget.maxObservations||p.bytes>budget.maxBytes||p.spanMs>budget.maxSpanMs||this.jobs(lane).length+this.jobs(lane,'running').length>budget.maxTasks)throw Error('Recovered backlog exceeds configured budget');
 }
 workProgress(lane:string){
  const first=this.db.prepare("SELECT MIN(e.seq) AS seq FROM evidence e LEFT JOIN work w ON w.seq=e.seq AND w.lane=? WHERE COALESCE(w.status,'')!='done'").get(lane) as any;
  const totals=this.db.prepare("SELECT COUNT(*) AS n,COALESCE(SUM(e.bytes),0) AS bytes,COALESCE(MAX(e.at_ms)-MIN(e.at_ms),0) AS span,MIN(e.at_ms) AS oldest FROM evidence e JOIN work w ON w.seq=e.seq WHERE w.lane=? AND w.status IN ('buffered','pending','running')").get(lane) as any;
  const count=(status:string)=>(this.db.prepare('SELECT COUNT(*) AS n FROM work WHERE lane=? AND status=?').get(lane,status) as any).n as number;
  return {throughSequence:first.seq?first.seq-1:this.latest()?.sequence??0,pending:totals.n as number,bytes:totals.bytes as number,spanMs:totals.span as number,oldestAtMs:totals.oldest as number|null,failed:count('failed'),gaps:count('gap')};
 }
 read(afterSequence=0,limit=64,knownAtMs=Number.MAX_SAFE_INTEGER,knownRevision=Number.MAX_SAFE_INTEGER):ArchivedEvidence[]{
  if(!Number.isInteger(limit)||limit<1||limit>256||!Number.isInteger(afterSequence)||afterSequence<0||!Number.isFinite(knownAtMs))throw Error('Invalid observation page');
  return this.db.prepare('SELECT * FROM evidence WHERE seq>? AND available_ms<=? AND archived_revision<=? ORDER BY seq LIMIT ?').all(afterSequence,knownAtMs,knownRevision,limit).map(row=>{
   const value=this.decode(row);if((value.factsRevision??0)>knownRevision||value.factsAvailableAtMs!==null&&value.factsAvailableAtMs>knownAtMs){value.facts=null;value.factsAvailableAtMs=null;}return value;
  });
 }
 findFacts(terms:string[],cursor:number,knownAtMs:number,knownRevision:number,sourceCutoffMs:number){
  if(!Array.isArray(terms)||!terms.length||terms.length>6||terms.some(t=>typeof t!=='string'||!t.trim()||t.length>80)||!Number.isInteger(cursor)||cursor<0)throw Error('Invalid literal fact search');
  const where='available_ms<=? AND archived_revision<=? AND at_ms<=? AND facts_ms<=? AND facts_revision<=? AND ('+terms.map(()=>"instr(lower(facts),lower(?))>0").join(' OR ')+')';
  const args=[knownAtMs,knownRevision,sourceCutoffMs,knownAtMs,knownRevision,...terms];
  const total=(this.db.prepare('SELECT COUNT(*) AS n FROM evidence WHERE '+where).get(...args) as any).n as number;
  const rows=this.db.prepare('SELECT * FROM evidence WHERE '+where+' ORDER BY seq LIMIT 24 OFFSET ?').all(...args,cursor).map(r=>this.decode(r));
  return {rows,total,nextCursor:cursor+rows.length<total?cursor+rows.length:null};
 }
 gaps(){return this.db.prepare('SELECT g.seq AS sequence,g.lane,g.reason,g.available_ms AS availableAtMs,r.available_ms AS resolvedAtMs FROM coverage_gaps g LEFT JOIN gap_resolutions r ON r.seq=g.seq AND r.lane=g.lane ORDER BY g.seq,g.lane').all();}
 progress(){
  const count=(this.db.prepare('SELECT COUNT(*) AS n FROM evidence').get() as any).n as number;
  const firstMissing=this.db.prepare('SELECT seq FROM evidence WHERE facts IS NULL ORDER BY seq LIMIT 1').get() as any;
  const factsThroughSequence=firstMissing?firstMissing.seq-1:count,latest=this.latest(),factsTail=factsThroughSequence?this.bySequence(factsThroughSequence):null;
  return {evidenceRevision:this.revision(),archivedThroughSequence:count,archivedThroughAtMs:latest?.observation.atMs??null,archivedAvailableAtMs:latest?.archivedAtMs??null,factsThroughSequence,factsThroughAtMs:factsTail?.observation.atMs??null,factsAvailableAtMs:factsTail?.factsAvailableAtMs??null};
 }
 close(){this.db.close();}
 private decode(row:any):ArchivedEvidence{return {sequence:row.seq,observation:JSON.parse(row.raw),archivedAtMs:row.available_ms,facts:row.facts?JSON.parse(row.facts):null,factsAvailableAtMs:row.facts_ms??null,archivedRevision:row.archived_revision,factsRevision:row.facts_revision??null};}
}
