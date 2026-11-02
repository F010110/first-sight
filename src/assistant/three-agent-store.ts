import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import type {SpatialObservation} from '../agent/incremental-spatial-memory.js';

export type Lane='current'|'memory';
export type Work={id:number;observationId:string;lane:Lane;token:string;attempt:number;receivedAtMs?:number};
export type Finding={text:string;sourceIds:string[];basis?:'visual'|'memory'|'mixed';memoryRefs?:string[]};
export type AgentResult={facts:Finding[];summary:string;sourceIds:string[];memoryRefs?:string[]};
export function evidenceBasis(fact:Pick<Finding,'sourceIds'|'memoryRefs'>){
 const direct=fact.sourceIds.length>0,indirect=(fact.memoryRefs??[]).length>0;
 if(!direct&&!indirect)throw Error('Finding has no evidence');
 return direct?(indirect?'mixed':'visual'):'memory';
}

/** Durable raw-evidence index and leased, fenced work. Not a model-owned database API. */
export class ThreeAgentStore{
  private db:DatabaseSync;
  private extractionBatchMax=4;private extractionWaitMs=6000;
  configureExtraction(batchMax:number,maxWaitMs:number,protocol?:string){
   if(!Number.isInteger(batchMax)||batchMax<1||batchMax>4||!Number.isFinite(maxWaitMs)||maxWaitMs<0||maxWaitMs>6000)throw Error('Invalid extraction batching');
   if(protocol){
    const value=JSON.stringify({batchMax,maxWaitMs,protocol});
    const previous=this.db.prepare("SELECT value FROM settings WHERE key='extraction-policy'").get() as {value:string}|undefined;
    if(previous&&previous.value!==value||!previous&&this.db.prepare('SELECT id FROM extraction_windows LIMIT 1').get())throw Error('Extraction protocol or batching changed; use a new root');
    this.db.prepare("INSERT OR IGNORE INTO settings VALUES('extraction-policy',?)").run(value);
   }
   this.extractionBatchMax=batchMax;this.extractionWaitMs=maxWaitMs;
  }
  extractionPolicy(){return {batchMax:this.extractionBatchMax,maxWaitMs:this.extractionWaitMs};}
 constructor(path:string,private now=Date.now){
  this.db=new DatabaseSync(path);
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
   CREATE TABLE IF NOT EXISTS observations(id TEXT PRIMARY KEY,at_ms REAL NOT NULL UNIQUE,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY,lane TEXT NOT NULL,observation_id TEXT NOT NULL,status TEXT NOT NULL,token TEXT,lease_until REAL,attempt INTEGER NOT NULL DEFAULT 0,error TEXT,UNIQUE(lane,observation_id));
   CREATE TABLE IF NOT EXISTS results(task_id INTEGER PRIMARY KEY,lane TEXT NOT NULL,observation_id TEXT NOT NULL,source_at_ms REAL NOT NULL,available_at_ms REAL NOT NULL,version INTEGER,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
   INSERT OR IGNORE INTO meta VALUES('memory_version',0);`);
  const columns=(table:string)=>(this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name:string}>).map(r=>r.name);
  if(!columns('observations').includes('received_at_ms'))this.db.exec('ALTER TABLE observations ADD COLUMN received_at_ms REAL NOT NULL DEFAULT 0');
  if(!columns('results').includes('evidence_until_ms')){this.db.exec('ALTER TABLE results ADD COLUMN evidence_until_ms REAL');this.db.exec('UPDATE results SET evidence_until_ms=source_at_ms');}
   this.db.exec('CREATE TABLE IF NOT EXISTS efficiency_events(id INTEGER PRIMARY KEY,at_ms REAL NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL)');
   this.db.exec(`CREATE TABLE IF NOT EXISTS extraction_windows(id INTEGER PRIMARY KEY,status TEXT NOT NULL,token TEXT NOT NULL,lease_until REAL NOT NULL,evidence_until_ms REAL NOT NULL,error TEXT);
    CREATE TABLE IF NOT EXISTS extraction_members(window_id INTEGER NOT NULL,task_id INTEGER NOT NULL,PRIMARY KEY(window_id,task_id));
    CREATE TABLE IF NOT EXISTS extracted_evidence(task_id INTEGER PRIMARY KEY,window_id INTEGER NOT NULL,body TEXT NOT NULL,evidence_until_ms REAL NOT NULL,available_at_ms REAL NOT NULL);`);
   this.db.exec('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
   this.db.exec("CREATE TABLE IF NOT EXISTS relationship_reviews(observation_id TEXT PRIMARY KEY,status TEXT NOT NULL,reason TEXT NOT NULL,token TEXT,lease_until REAL,body TEXT,error TEXT)");
   this.db.exec("CREATE TABLE IF NOT EXISTS relationship_attempts(id TEXT PRIMARY KEY,observation_id TEXT NOT NULL,status TEXT NOT NULL,token TEXT,lease_until REAL,body TEXT,error TEXT)");
 }
  archive(row:SpatialObservation,continuousCurrent=true){
  if(!row.id||!Number.isFinite(row.atMs)||!Array.isArray(row.frames)||!row.frames.length||row.frames.length>3||row.frames.some(p=>typeof p!=='string'||!p))throw Error('Invalid observation');
  const previous=this.db.prepare('SELECT body FROM observations WHERE id=?').get(row.id) as {body:string}|undefined;
  if(previous){if(previous.body!==JSON.stringify(row))throw Error('Observation ID changed');return;}
  const latest=this.db.prepare('SELECT MAX(at_ms) AS t FROM observations').get() as {t:number|null};
  if(latest.t!==null&&row.atMs<=latest.t)throw Error('Noncausal archive');
  this.db.exec('BEGIN IMMEDIATE');
  try{
    this.db.prepare('INSERT INTO observations(id,at_ms,body,received_at_ms) VALUES(?,?,?,?)').run(row.id,row.atMs,JSON.stringify(row),this.now());
   // Supersession is explicit; the raw observation and memory task remain intact.
   this.db.prepare("UPDATE tasks SET status='superseded',error='newer-current-observation' WHERE lane='current' AND status='pending'").run();
    for(const lane of continuousCurrent?['current','memory']:['memory'])this.db.prepare("INSERT INTO tasks(lane,observation_id,status) VALUES(?,?,'pending')").run(lane,row.id);
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
  private memoryBatchPlan(maxWaitMs:number,flush:boolean,parallel=false){
   const batchMax=parallel?this.extractionBatchMax:4;
  if(!parallel&&!this.ready('memory'))return [];
  const candidates=this.db.prepare(`SELECT t.id,t.observation_id,t.attempt,o.body,o.received_at_ms FROM tasks t JOIN observations o ON o.id=t.observation_id WHERE t.lane='memory' AND (t.status='pending' OR (t.status='${parallel?'extracting':'running'}' AND t.lease_until<=?)) ORDER BY t.id LIMIT 5`).all(this.now()) as Array<{id:number;observation_id:string;attempt:number;body:string;received_at_ms:number}>;
  const selected:typeof candidates=[];let boundary=false;let previous:SpatialObservation|undefined;
  for(const item of candidates){
   const row=JSON.parse(item.body) as SpatialObservation;
   if(previous&&(row.recordingId!==previous.recordingId||(row.sourceAtMs??row.atMs)-(previous.sourceAtMs??previous.atMs)>2500)){boundary=true;break;}
    selected.push(item);previous=row;if(selected.length===batchMax)break;
  }
    return selected.length&&(selected.length===batchMax||boundary||flush||this.now()-selected[0]!.received_at_ms>=maxWaitMs)?selected:[];
  }
  configureMemoryMode(mode:'parallel-v1'|'serial-v1'){
   const previous=this.db.prepare("SELECT value FROM settings WHERE key='memory-mode'").get() as {value:string}|undefined;
   if(previous&&previous.value!==mode)throw Error('Memory pipeline mode changed; use a new root rather than mixing writers');
   if(!previous&&this.db.prepare("SELECT id FROM tasks WHERE lane='memory' AND status='running' AND lease_until>? LIMIT 1").get(this.now()))throw Error('Existing memory writer has an active lease');
   this.db.prepare("INSERT OR IGNORE INTO settings VALUES('memory-mode',?)").run(mode);
  }
  requestCurrent(id:string){
   if(this.latest()?.id!==id)throw Error('Not latest observation');
   this.db.prepare("UPDATE tasks SET status='superseded',error='newer-explicit-inspection' WHERE lane='current' AND status='pending'").run();
   this.db.prepare("INSERT OR IGNORE INTO tasks(lane,observation_id,status) VALUES('current',?,'pending')").run(id);
  }
  useOnDemandCurrent(){this.db.prepare("UPDATE tasks SET status='superseded',error='continuous-current-disabled' WHERE lane='current' AND status='pending'").run();}
  ensureReview(id:string,reason:string){this.observation(id);this.db.prepare("INSERT OR IGNORE INTO relationship_reviews(observation_id,status,reason) VALUES(?,'pending',?)").run(id,reason);this.metric('relationship-status',this.reviewStatus());}
  reviewStatus(){return {unresolvedWindows:(this.db.prepare("SELECT COUNT(*) AS n FROM relationship_reviews WHERE status='pending'").get() as {n:number}).n,questionScopedAttempts:this.db.prepare('SELECT status,COUNT(*) AS count FROM relationship_attempts GROUP BY status').all()};}
  claimReview(id:string,key='default'){
   this.ensureReview(id,'question-requested');const token=randomUUID();
   const job=id+':'+key;this.db.prepare("INSERT OR IGNORE INTO relationship_attempts(id,observation_id,status) VALUES(?,?,'pending')").run(job,id);
   const claimed=this.db.prepare("UPDATE relationship_attempts SET status='running',token=?,lease_until=? WHERE id=? AND (status='pending' OR (status='running' AND lease_until<=?))").run(token,this.now()+180000,job,this.now());
   return claimed.changes===1?token:null;
  }
  finishReview(id:string,token:string,result:AgentResult,key='default'){this.validate(result,this.observation(id).atMs);if(!result.sourceIds.includes(id))throw Error('Review missing current evidence');const updated=this.db.prepare("UPDATE relationship_attempts SET status='done',body=?,token=NULL WHERE id=? AND token=? AND status='running' AND lease_until>?").run(JSON.stringify(result),id+':'+key,token,this.now()).changes===1;this.metric('relationship-status',this.reviewStatus());return updated;}
  failReview(id:string,token:string,error:unknown,key='default'){this.db.prepare("UPDATE relationship_attempts SET status='failed',error=?,token=NULL WHERE id=? AND token=?").run(String(error),id+':'+key,token);this.metric('relationship-status',this.reviewStatus());}
  review(id:string,key='default'){const r=this.db.prepare('SELECT status,body,error FROM relationship_attempts WHERE id=?').get(id+':'+key) as {status:string;body:string|null;error:string|null}|undefined;return r?{status:r.status,result:r.body?JSON.parse(r.body) as AgentResult:null,error:r.error}:null;}
  evidenceSnapshot(asOf:number){
   return (this.db.prepare('SELECT t.observation_id,o.at_ms,e.body,e.evidence_until_ms FROM extracted_evidence e JOIN tasks t ON t.id=e.task_id JOIN observations o ON o.id=t.observation_id WHERE e.evidence_until_ms<=? ORDER BY o.at_ms').all(asOf) as Array<{observation_id:string;at_ms:number;body:string;evidence_until_ms:number}>).map(r=>({id:r.observation_id,atMs:r.at_ms,evidenceUntilMs:r.evidence_until_ms,result:JSON.parse(r.body) as AgentResult}));
  }
 memoryBatchReady(maxWaitMs=6000,flush=false){return this.memoryBatchPlan(maxWaitMs,flush).length>0;}
 claimMemoryBatch(maxWaitMs=6000,flush=false):Work[]{
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const plan=this.memoryBatchPlan(maxWaitMs,flush);const token=randomUUID();
   const work=plan.map(r=>{
    this.db.prepare("UPDATE tasks SET status='running',token=?,lease_until=?,attempt=attempt+1 WHERE id=?").run(token,this.now()+180000,r.id);
    return {id:r.id,observationId:r.observation_id,lane:'memory' as const,token,attempt:r.attempt+1,receivedAtMs:r.received_at_ms};
   });
   this.db.exec('COMMIT');return work;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 observation(id:string){const r=this.db.prepare('SELECT body FROM observations WHERE id=?').get(id) as {body:string}|undefined;if(!r)throw Error('Unknown evidence');return JSON.parse(r.body) as SpatialObservation;}
 latest(asOf=Infinity){const r=this.db.prepare('SELECT body FROM observations WHERE at_ms<=? ORDER BY at_ms DESC LIMIT 1').get(asOf) as {body:string}|undefined;return r?JSON.parse(r.body) as SpatialObservation:null;}
 recent(asOf:number,limit=6){
  if(!Number.isInteger(limit)||limit<1||limit>12)throw Error('Invalid raw fallback limit');
  return (this.db.prepare('SELECT body FROM observations WHERE at_ms<=? ORDER BY at_ms DESC LIMIT ?').all(asOf,limit) as Array<{body:string}>).map(r=>JSON.parse(r.body) as SpatialObservation);
 }
 claim(lane:Lane,leaseMs=180000):Work|null{
  this.db.exec('BEGIN IMMEDIATE');
  try{
   this.db.prepare("UPDATE tasks SET status='pending',token=NULL WHERE status='running' AND lease_until<=?").run(this.now());
   if(lane==='current')this.db.exec("UPDATE tasks SET status='superseded',error='recovered-newer-current' WHERE lane='current' AND status='pending' AND id<(SELECT MAX(id) FROM tasks WHERE lane='current' AND status='pending')");
   // A single writer per lane, including independently opened store connections.
   if(this.db.prepare("SELECT id FROM tasks WHERE lane=? AND status='running' LIMIT 1").get(lane)){this.db.exec('COMMIT');return null;}
   const row=this.db.prepare("SELECT id,observation_id,attempt FROM tasks WHERE lane=? AND status='pending' ORDER BY id LIMIT 1").get(lane) as {id:number;observation_id:string;attempt:number}|undefined;
   if(!row){this.db.exec('COMMIT');return null;}
   const token=randomUUID();
   this.db.prepare("UPDATE tasks SET status='running',token=?,lease_until=?,attempt=attempt+1 WHERE id=?").run(token,this.now()+leaseMs,row.id);
   this.db.exec('COMMIT');return {id:row.id,observationId:row.observation_id,lane,token,attempt:row.attempt+1};
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
  renew(work:Work){
   this.db.prepare("UPDATE extraction_windows SET lease_until=? WHERE token=? AND status IN ('running','associating')").run(this.now()+180000,work.token);
   return this.db.prepare("UPDATE tasks SET lease_until=? WHERE id=? AND token=? AND status IN ('running','extracting')").run(this.now()+180000,work.id,work.token).changes===1;
  }
  parallelReady(flush=false){
   const first=this.db.prepare("SELECT status,lease_until FROM extraction_windows WHERE status IN ('running','ready','associating') ORDER BY id LIMIT 1").get() as {status:string;lease_until:number}|undefined;
   if(first&&(first.status==='ready'||first.lease_until<=this.now()))return true;
   const active=(this.db.prepare("SELECT COUNT(*) AS n FROM extraction_windows WHERE status='running' AND lease_until>?").get(this.now()) as {n:number}).n;
    return active<2&&this.preparedWindows()<3&&this.memoryBatchPlan(this.extractionWaitMs,flush,true).length>0;
  }
  preparedWindows(){return (this.db.prepare("SELECT COUNT(*) AS n FROM extraction_windows WHERE status='ready'").get() as {n:number}).n;}
  pendingExtractionCount(){return (this.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE lane='memory' AND status='pending'").get() as {n:number}).n;}
  claimExtraction(flush=false):{windowId:number;work:Work[]}|null{
   this.db.exec('BEGIN IMMEDIATE');
   try{
    this.db.prepare("UPDATE tasks SET status='extracted' WHERE status='running' AND id IN (SELECT m.task_id FROM extraction_members m JOIN extraction_windows w ON w.id=m.window_id WHERE w.status='associating' AND w.lease_until<=?)").run(this.now());
    this.db.prepare("UPDATE extraction_windows SET status='ready' WHERE status='associating' AND lease_until<=?").run(this.now());
    const active=this.db.prepare("SELECT COUNT(*) AS n FROM extraction_windows WHERE status='running' AND lease_until>?").get(this.now()) as {n:number};
    if(active.n>=2){this.db.exec('COMMIT');return null;}
    const expired=this.db.prepare("SELECT id FROM extraction_windows WHERE status='running' AND lease_until<=? ORDER BY id LIMIT 1").get(this.now()) as {id:number}|undefined;
    const token=randomUUID();let windowId:number;let members:Array<{id:number;observation_id:string;attempt:number;received_at_ms:number}>;
    if(expired){
     windowId=expired.id;
     members=this.db.prepare('SELECT t.id,t.observation_id,t.attempt,o.received_at_ms FROM extraction_members m JOIN tasks t ON t.id=m.task_id JOIN observations o ON o.id=t.observation_id WHERE m.window_id=? ORDER BY t.id').all(windowId) as typeof members;
     this.db.prepare("UPDATE extraction_windows SET token=?,lease_until=? WHERE id=?").run(token,this.now()+180000,windowId);
    }else{
      const plan=this.memoryBatchPlan(this.extractionWaitMs,flush,true);if(!plan.length){this.db.exec('COMMIT');return null;}
     const end=this.observation(plan.at(-1)!.observation_id).atMs;
     windowId=Number(this.db.prepare("INSERT INTO extraction_windows(status,token,lease_until,evidence_until_ms) VALUES('running',?,?,?)").run(token,this.now()+180000,end).lastInsertRowid);
     members=plan;for(const m of members)this.db.prepare('INSERT INTO extraction_members VALUES(?,?)').run(windowId,m.id);
    }
    const work=members.map(m=>{this.db.prepare("UPDATE tasks SET status='extracting',token=?,lease_until=?,attempt=attempt+1 WHERE id=?").run(token,this.now()+180000,m.id);return {id:m.id,observationId:m.observation_id,lane:'memory' as const,token,attempt:m.attempt+1,receivedAtMs:m.received_at_ms};});
    this.db.exec('COMMIT');return {windowId,work};
   }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  saveExtraction(windowId:number,work:Work[],output:Array<{observationId:string;result?:AgentResult;error?:string}>){
   const window=this.db.prepare("SELECT id,evidence_until_ms FROM extraction_windows WHERE id=? AND token=? AND status='running' AND lease_until>?").get(windowId,work[0]!.token,this.now()) as {id:number;evidence_until_ms:number}|undefined;
   if(!window)throw Error('Expired extraction lease');
   if(!Array.isArray(output)||new Set(output.map(r=>r.observationId)).size!==output.length||output.some(r=>!work.some(w=>w.observationId===r.observationId)))throw Error('Invalid extraction coverage');
   this.db.exec('BEGIN IMMEDIATE');
   try{
    if(!this.db.prepare("SELECT id FROM extraction_windows WHERE id=? AND token=? AND status='running' AND lease_until>?").get(windowId,work[0]!.token,this.now()))throw Error('Expired extraction lease');
    for(const w of work){
     const item=output.find(r=>r.observationId===w.observationId);
     try{
      if(!item?.result||item.error)throw Error(item?.error??'Missing extraction');
      this.validate(item.result,this.observation(w.observationId).atMs);
      if((item.result.memoryRefs??[]).length||!item.result.facts.some(f=>evidenceBasis(f)==='visual'&&f.sourceIds.includes(w.observationId)))throw Error('Extraction must be independent direct evidence');
      this.db.prepare('INSERT INTO extracted_evidence VALUES(?,?,?,?,?)').run(w.id,windowId,JSON.stringify(item.result),window.evidence_until_ms,this.now());
      this.db.prepare("UPDATE tasks SET status='extracted',token=NULL WHERE id=? AND token=?").run(w.id,w.token);
      this.metric('extraction-committed',{id:w.observationId,sourceAtMs:this.observation(w.observationId).atMs,windowId});
     }catch(error){this.db.prepare("UPDATE tasks SET status='failed',error=?,token=NULL WHERE id=? AND token=?").run(String(error),w.id,w.token);this.metric('extraction-failed',{id:w.observationId,error:String(error)});}
    }
    this.db.prepare("UPDATE extraction_windows SET status='ready' WHERE id=?").run(windowId);this.db.exec('COMMIT');
   }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  failExtraction(windowId:number,work:Work[],error:unknown){
   this.db.prepare("UPDATE extraction_windows SET status='failed',error=? WHERE id=? AND token=? AND status='running'").run(String(error),windowId,work[0]!.token);
   for(const w of work)this.db.prepare("UPDATE tasks SET status='failed',error=?,token=NULL WHERE id=? AND token=? AND status='extracting'").run(String(error),w.id,w.token);
  }
  claimAssociation(){
   this.db.exec('BEGIN IMMEDIATE');
   try{
    this.db.prepare("UPDATE tasks SET status='extracted' WHERE status='running' AND id IN (SELECT m.task_id FROM extraction_members m JOIN extraction_windows w ON w.id=m.window_id WHERE w.status='associating' AND w.lease_until<=?)").run(this.now());
    this.db.prepare("UPDATE extraction_windows SET status='ready' WHERE status='associating' AND lease_until<=?").run(this.now());
    const next=this.db.prepare("SELECT id,status,evidence_until_ms FROM extraction_windows WHERE status IN ('running','ready','associating') ORDER BY id LIMIT 1").get() as {id:number;status:string;evidence_until_ms:number}|undefined;
    if(!next||next.status!=='ready'){this.db.exec('COMMIT');return null;}
    const rows=this.db.prepare("SELECT t.id,t.observation_id,t.attempt,e.body FROM extraction_members m JOIN tasks t ON t.id=m.task_id JOIN extracted_evidence e ON e.task_id=t.id WHERE m.window_id=? AND t.status='extracted' ORDER BY t.id").all(next.id) as Array<{id:number;observation_id:string;attempt:number;body:string}>;
    const token=randomUUID();this.db.prepare("UPDATE extraction_windows SET status=?,token=?,lease_until=? WHERE id=?").run(rows.length?'associating':'done',token,this.now()+180000,next.id);
    const work=rows.map(r=>{this.db.prepare("UPDATE tasks SET status='running',token=?,lease_until=? WHERE id=?").run(token,this.now()+180000,r.id);return {id:r.id,observationId:r.observation_id,lane:'memory' as const,token,attempt:r.attempt};});
    this.db.exec('COMMIT');return {windowId:next.id,work,evidenceUntilMs:next.evidence_until_ms,extracted:rows.map(r=>({observationId:r.observation_id,result:JSON.parse(r.body) as AgentResult}))};
   }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  finishAssociation(windowId:number,token:string){this.db.prepare("UPDATE extraction_windows SET status='done' WHERE id=? AND token=? AND status='associating'").run(windowId,token);}
 ready(lane:Lane){
  if(this.db.prepare("SELECT id FROM tasks WHERE lane=? AND status='running' AND lease_until>? LIMIT 1").get(lane,this.now()))return false;
  return !!this.db.prepare("SELECT id FROM tasks WHERE lane=? AND (status='pending' OR (status='running' AND lease_until<=?)) LIMIT 1").get(lane,this.now());
 }
 version(){return (this.db.prepare("SELECT value FROM meta WHERE key='memory_version'").get() as {value:number}).value;}
 memoryEvidence(ref:string,asOf:number){
  const match=/^memory-v([1-9][0-9]*)$/.exec(ref);
  if(!match)throw Error('Invalid memory reference');
   const row=this.db.prepare("SELECT observation_id,source_at_ms,evidence_until_ms,body FROM results WHERE lane='memory' AND version=?").get(Number(match[1])) as {observation_id:string;source_at_ms:number;evidence_until_ms:number;body:string}|undefined;
  if(!row)throw Error('Unknown memory reference');
   if(row.evidence_until_ms>=asOf)throw Error('Future or self memory reference');
  return {memoryRef:ref,observationId:row.observation_id,sourceAtMs:row.source_at_ms,result:JSON.parse(row.body) as AgentResult};
 }
 validate(result:AgentResult,asOf:number){
  if(!result||typeof result.summary!=='string'||!result.summary.trim()||result.summary.length>2400||!Array.isArray(result.facts)||result.facts.length>12||!Array.isArray(result.sourceIds)||!result.sourceIds.length)throw Error('Invalid agent result');
   const ids=new Set(result.sourceIds);
   for(const id of ids)if(this.observation(id).atMs>asOf)throw Error('Future evidence');
   const memoryRefs=result.memoryRefs??[];
   if(!Array.isArray(memoryRefs)||memoryRefs.length>8||new Set(memoryRefs).size!==memoryRefs.length)throw Error('Invalid memory reference list');
   const memories=new Set(memoryRefs);
   for(const ref of memories)this.memoryEvidence(ref,asOf);
   for(const fact of result.facts){
    if(!fact||typeof fact.text!=='string'||!fact.text.trim()||fact.text.length>1200||!Array.isArray(fact.sourceIds)||fact.sourceIds.some(id=>!ids.has(id)))throw Error('Invalid fact citation');
    const refs=fact.memoryRefs??[];
    if(!Array.isArray(refs)||refs.some(ref=>!memories.has(ref)))throw Error('Invalid fact memory citation');
    const basis=evidenceBasis(fact);
    if(fact.basis!==undefined&&fact.basis!==basis)throw Error('Evidence basis does not match citations');
   }
 }
  commit(work:Work,result:AgentResult,baseVersion:number,evidenceUntilMs?:number){
   const observation=this.observation(work.observationId);const cutoff=evidenceUntilMs??observation.atMs;
   if(!Number.isFinite(cutoff)||cutoff<observation.atMs||work.lane==='current'&&cutoff!==observation.atMs)throw Error('Invalid evidence window');
   this.validate(result,cutoff);
   if(result.sourceIds.some(id=>this.observation(id).atMs>observation.atMs))throw Error('Future within-window observation cited');
  if(!result.sourceIds.includes(observation.id)||work.lane==='current'&&(result.sourceIds.some(id=>id!==observation.id)||(result.memoryRefs??[]).length))throw Error('Current evidence missing or contaminated');
  if(!result.facts.some(f=>evidenceBasis(f)==='visual'&&f.sourceIds.includes(observation.id)))throw Error('Current direct inspection missing');
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const task=this.db.prepare("SELECT id FROM tasks WHERE id=? AND token=? AND status='running' AND lease_until>?").get(work.id,work.token,this.now());
   if(!task)throw Error('Expired or replaced lease');
   if(work.lane==='memory'&&this.version()!==baseVersion)throw Error('Memory version conflict');
   const version=work.lane==='memory'?baseVersion+1:null;
    this.db.prepare('INSERT INTO results(task_id,lane,observation_id,source_at_ms,available_at_ms,version,body,evidence_until_ms) VALUES(?,?,?,?,?,?,?,?)').run(work.id,work.lane,observation.id,observation.atMs,this.now(),version,JSON.stringify(result),cutoff);
   if(version!==null)this.db.prepare("UPDATE meta SET value=? WHERE key='memory_version'").run(version);
   this.db.prepare("UPDATE tasks SET status='done',token=NULL WHERE id=?").run(work.id);this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 fail(work:Work,error:unknown){this.db.prepare("UPDATE tasks SET status='failed',error=?,token=NULL WHERE id=? AND token=? AND status='running'").run(String(error).slice(0,2000),work.id,work.token);}
 supersede(work:Work){this.db.prepare("UPDATE tasks SET status='superseded',error='not-fresh-at-start',token=NULL WHERE id=? AND token=? AND status='running'").run(work.id,work.token);}
 snapshot(asOf:number){
   const results=this.db.prepare('SELECT lane,observation_id,source_at_ms,available_at_ms,version,body,evidence_until_ms FROM results WHERE evidence_until_ms<=? ORDER BY task_id').all(asOf) as Array<{lane:Lane;observation_id:string;source_at_ms:number;available_at_ms:number;version:number|null;body:string;evidence_until_ms?:number}>;
   const pending=this.db.prepare("SELECT COUNT(*) AS n FROM tasks t JOIN observations o ON o.id=t.observation_id LEFT JOIN results r ON r.task_id=t.id WHERE t.lane='memory' AND (t.status!='done' OR r.evidence_until_ms>?) AND o.at_ms<=?").get(asOf,asOf) as {n:number};
   return {asOfMs:asOf,version:this.version(),pendingMemory:pending.n,completeness:pending.n?'partial':'processed-not-verified',memoryLayer:'observation-facts-not-confirmed-identities',relationshipReviews:this.reviewStatus(),evidence:this.evidenceSnapshot(asOf),results:results.map(r=>({...r,memoryRef:r.lane==='memory'?`memory-v${r.version}`:null,result:JSON.parse(r.body) as AgentResult,body:undefined}))};
 }
  status(){return this.db.prepare('SELECT lane,status,COUNT(*) AS count FROM tasks GROUP BY lane,status').all();}
  metric(kind:string,value:unknown){this.db.prepare('INSERT INTO efficiency_events(at_ms,kind,body) VALUES(?,?,?)').run(this.now(),kind,JSON.stringify(value));}
  efficiencyEvents(){return (this.db.prepare('SELECT at_ms,kind,body FROM efficiency_events ORDER BY id').all() as Array<{at_ms:number;kind:string;body:string}>).map(r=>({atMs:r.at_ms,kind:r.kind,value:JSON.parse(r.body)}));}
  progress(){
   const aggregate=this.db.prepare("SELECT COUNT(*) AS archived,MAX(o.at_ms) AS latestRawAtMs,SUM(CASE WHEN t.status='done' THEN 1 ELSE 0 END) AS completed,MIN(CASE WHEN t.status!='done' THEN o.at_ms END) AS firstIncomplete,MIN(CASE WHEN t.status!='done' THEN o.received_at_ms END) AS oldestReceived FROM observations o JOIN tasks t ON t.observation_id=o.id AND t.lane='memory'").get() as {archived:number;latestRawAtMs:number|null;completed:number;firstIncomplete:number|null;oldestReceived:number|null};
   const prefix=this.db.prepare("SELECT MAX(o.at_ms) AS through FROM observations o JOIN tasks t ON t.observation_id=o.id AND t.lane='memory' WHERE t.status='done' AND (? IS NULL OR o.at_ms<?)").get(aggregate.firstIncomplete,aggregate.firstIncomplete) as {through:number|null};
   const extraction=this.db.prepare("SELECT COUNT(*) AS completed,MIN(CASE WHEN e.task_id IS NULL THEN o.at_ms END) AS firstIncomplete FROM observations o JOIN tasks t ON t.observation_id=o.id AND t.lane='memory' LEFT JOIN extracted_evidence e ON e.task_id=t.id").get() as {completed:number;firstIncomplete:number|null};
   const extractedCount=(this.db.prepare('SELECT COUNT(*) AS n FROM extracted_evidence').get() as {n:number}).n;
   const extractedPrefix=this.db.prepare("SELECT MAX(o.at_ms) AS through FROM observations o JOIN tasks t ON t.observation_id=o.id AND t.lane='memory' JOIN extracted_evidence e ON e.task_id=t.id WHERE (? IS NULL OR o.at_ms<?)").get(extraction.firstIncomplete,extraction.firstIncomplete) as {through:number|null};
   return {...aggregate,contiguousThroughAtMs:prefix.through,semanticLagMs:prefix.through===null||aggregate.latestRawAtMs===null?null:aggregate.latestRawAtMs-prefix.through,unfinished:aggregate.archived-aggregate.completed,oldestUnfinishedAgeMs:aggregate.oldestReceived===null?0:Math.max(0,this.now()-aggregate.oldestReceived),extractedObservations:extractedCount,extractionThroughAtMs:extractedPrefix.through,extractionLagMs:extractedPrefix.through===null||aggregate.latestRawAtMs===null?null:aggregate.latestRawAtMs-extractedPrefix.through};
  }
 close(){this.db.close();}
}
