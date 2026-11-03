import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import type {Observation,Facts,Assessment,StoredState,HistoryRecord,WorkingContext,SpatialWindow} from './contracts.js';

/** New isolated schema: append-only spatial versions, not a transcript or fact-only ledger. */
export class SpatialLongTermStore{
 private db:DatabaseSync;
 constructor(root:string,private now=Date.now){
  mkdirSync(root,{recursive:true});this.db=new DatabaseSync(join(root,'spatial.sqlite'));
  const tables=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{name:string}>;
  if(tables.length&&!tables.some(t=>t.name==='spatial_schema')){this.db.close();throw Error('Refuse to initialize over a legacy database');}
  this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS spatial_schema(version INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS observations(seq INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,at_ms REAL NOT NULL UNIQUE,raw TEXT NOT NULL,facts TEXT,error TEXT);
   CREATE TABLE IF NOT EXISTS places(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_version INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS visits(id TEXT PRIMARY KEY,place_id TEXT NOT NULL REFERENCES places(id),start_version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS states(version INTEGER PRIMARY KEY,observation_id TEXT NOT NULL REFERENCES observations(id),at_ms REAL NOT NULL,available_ms REAL NOT NULL,raw TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS checkpoints(version INTEGER PRIMARY KEY REFERENCES states(version),raw TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS checkpoint_bindings(version INTEGER PRIMARY KEY REFERENCES states(version),raw TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS window_members(observation_id TEXT PRIMARY KEY REFERENCES observations(id),version INTEGER NOT NULL REFERENCES states(version));
   CREATE TABLE IF NOT EXISTS relation_assertions(version INTEGER NOT NULL REFERENCES states(version),raw TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS revisions(version INTEGER NOT NULL REFERENCES states(version),observation_id TEXT NOT NULL REFERENCES observations(id),raw TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY,at_ms REAL NOT NULL,kind TEXT NOT NULL,raw TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS states_time ON states(at_ms,available_ms);`);
  const schema=this.db.prepare('SELECT version FROM spatial_schema').get() as any;
   if(schema&&![1,2].includes(schema.version))throw Error('Incompatible spatial memory schema');
   if(!schema)this.db.prepare('INSERT INTO spatial_schema VALUES(2)').run();
 }
  close(){this.db.close();}
  supportsWindowRevisions(){return (this.db.prepare('SELECT version FROM spatial_schema').get() as any).version===2;}
 event(kind:string,value:unknown){this.db.prepare('INSERT INTO events(at_ms,kind,raw) VALUES(?,?,?)').run(this.now(),kind,JSON.stringify(value));}
 archive(row:Observation){
  const prior=this.observation(row.id);if(prior){if(JSON.stringify(prior)!==JSON.stringify(row))throw Error('Immutable observation changed');return;}
  const latest=this.db.prepare('SELECT at_ms FROM observations ORDER BY seq DESC LIMIT 1').get() as any;
  if(latest&&row.atMs<=latest.at_ms)throw Error('Nonchronological observation');
  this.db.prepare('INSERT INTO observations(id,at_ms,raw) VALUES(?,?,?)').run(row.id,row.atMs,JSON.stringify(row));
 }
 observation(id:string):Observation|null{const r=this.db.prepare('SELECT raw FROM observations WHERE id=?').get(id) as any;return r?JSON.parse(r.raw):null;}
 latestObservation():Observation|null{const r=this.db.prepare('SELECT raw FROM observations ORDER BY seq DESC LIMIT 1').get() as any;return r?JSON.parse(r.raw):null;}
 facts(id:string):Facts|null{const r=this.db.prepare('SELECT facts FROM observations WHERE id=?').get(id) as any;return r?.facts?JSON.parse(r.facts):null;}
 saveFacts(id:string,facts:Facts){const before=this.facts(id);if(before){if(JSON.stringify(before)!==JSON.stringify(facts))throw Error('Independent facts changed');return;}if(!this.observation(id))throw Error('Unknown facts source');this.db.prepare('UPDATE observations SET facts=? WHERE id=?').run(JSON.stringify(facts),id);}
 fail(id:string,error:unknown){this.db.prepare('UPDATE observations SET error=? WHERE id=?').run(String(error),id);this.event('failure',{id,error:String(error)});}
 version(){return (this.db.prepare('SELECT COALESCE(MAX(version),0) AS n FROM states').get() as any).n as number;}
 state(version:number):StoredState|null{const r=this.db.prepare('SELECT raw FROM states WHERE version=?').get(version) as any;return r?JSON.parse(r.raw):null;}
 checkpoint(version:number):WorkingContext|null{const r=this.db.prepare('SELECT raw FROM checkpoints WHERE version=?').get(version) as any;return r?JSON.parse(r.raw):null;}
  pending():Observation[]{return (this.db.prepare('SELECT o.raw FROM observations o LEFT JOIN states s ON s.observation_id=o.id LEFT JOIN window_members w ON w.observation_id=o.id WHERE s.version IS NULL AND w.version IS NULL ORDER BY o.seq').all() as any[]).map(r=>JSON.parse(r.raw));}
 history(version:number,cutoffMs:number,knownAtMs:number):HistoryRecord[]{
   const latest=new Map<string,StoredState>();for(const row of this.db.prepare('SELECT raw FROM states WHERE version<=? AND at_ms<=? AND available_ms<=? ORDER BY version').all(version,cutoffMs,knownAtMs) as any[]){const state:StoredState=JSON.parse(row.raw);latest.set(state.observationId,state);}
   const records:HistoryRecord[]=[...latest.values()].sort((a,b)=>a.atMs-b.atMs).map(s=>({version:s.version,observationId:s.observationId,atMs:s.atMs,facts:s.facts,location:s.assessment.location,...s.locationDecision?{locationDecision:s.locationDecision}:{},visitId:s.visitId,provisionalVisitId:s.provisionalVisitId??null,...s.window?{window:s.window}:{}}));
  const revisions=this.db.prepare('SELECT r.observation_id,r.raw FROM revisions r JOIN states s ON s.version=r.version WHERE s.version<=? AND s.at_ms<=? AND s.available_ms<=? ORDER BY s.version').all(version,cutoffMs,knownAtMs) as Array<{observation_id:string;raw:string}>;
   for(const revision of revisions){const record=records.find(r=>r.observationId===revision.observation_id);if(record){const location=JSON.parse(revision.raw).location;if(location.placeId!==record.location.placeId){record.visitId=null;record.provisionalVisitId=null;}record.location=location;}}
  return records;
 }
  counts(){const n=(table:string)=>(this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n as number;const spatialStates=(this.db.prepare('SELECT COUNT(DISTINCT observation_id) AS n FROM states').get() as any).n as number;return {observations:n('observations'),spatialStates,stateVersions:n('states'),incompleteWindows:this.history(this.version(),Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER).filter(r=>r.window?.missingFactIds?.length).length,missingFacts:(this.db.prepare('SELECT COUNT(*) AS n FROM observations WHERE facts IS NULL').get() as any).n as number,coveredObservations:n('observations')-this.pending().length,places:n('places'),visits:n('visits'),pending:this.pending().length};}
  commit(row:Observation,a:Assessment,makeCheckpoint:(s:StoredState)=>WorkingContext,window?:SpatialWindow):StoredState{
  this.db.exec('BEGIN IMMEDIATE');try{
    const members=window?.observations.map(o=>o.id)??[row.id],pending=this.pending();
    const revising=window?.revisionOfVersion!==undefined,base=revising?this.state(window!.revisionOfVersion!):null;
    if(revising&&(!base||base.observationId!==row.id||JSON.stringify(base.window?.observations.map(o=>o.id))!==JSON.stringify(members)))throw Error('Invalid window revision target');
    if(!members.length||members.at(-1)!==row.id||!revising&&members.some((id,i)=>pending[i]?.id!==id))throw Error('Spatial commit must follow contiguous source order');
    if(window&&(window.endExclusiveMs<=row.atMs||window.startMs!==window.observations[0]!.atMs||window.observations.some(o=>{const raw=this.observation(o.id);return !raw||raw.atMs!==o.atMs||o.facts!==null&&JSON.stringify(this.facts(o.id))!==JSON.stringify(o.facts);})||JSON.stringify(window.missingFactIds??[])!==JSON.stringify(window.observations.filter(o=>o.facts===null).map(o=>o.id))))throw Error('Invalid window source binding');
    const facts=window?window.observations.at(-1)!.facts:this.facts(row.id);if(!facts&&!window)throw Error('No independent facts');
    const version=this.version()+1,assessment=structuredClone(a),location=assessment.location,locationDecision=a.location.status;
   if(location.status==='new'){location.placeId=randomUUID();location.status='known';this.db.prepare('INSERT INTO places VALUES(?,?,?)').run(location.placeId,location.name,version);}
    if(location.status==='known'&&!this.db.prepare('SELECT id FROM places WHERE id=?').get(location.placeId))throw Error('Unknown persistent place');
    if(location.continuityCandidate&&!this.db.prepare('SELECT id FROM places WHERE id=?').get(location.continuityCandidate.placeId))throw Error('Unknown provisional continuity place');
    const previous=revising?base:this.state(version-1),sameRecording=previous?this.observation(previous.observationId)?.recordingId===row.recordingId:false;
    let visitId:string|null=null;
    if(location.placeId){
     const previousPlace=previous?.assessment.location.placeId??previous?.assessment.location.continuityCandidate?.placeId;
     visitId=previousPlace===location.placeId&&sameRecording&&row.atMs-previous!.atMs<=60000?(previous!.visitId??previous!.provisionalVisitId??randomUUID()):randomUUID();
     if(visitId&&!this.db.prepare('SELECT id FROM visits WHERE id=?').get(visitId))this.db.prepare('INSERT INTO visits VALUES(?,?,?)').run(visitId,location.placeId,version);
    }
    let provisionalVisitId:string|null=null;
    if(location.continuityCandidate){const reference=this.history(version-1,row.atMs-0.000001,Number.MAX_SAFE_INTEGER).find(r=>r.observationId===location.continuityCandidate!.referenceId);provisionalVisitId=reference?.visitId??reference?.provisionalVisitId??null;}
     const state:StoredState={version,observationId:row.id,atMs:row.atMs,availableAtMs:this.now(),facts,assessment,locationDecision,visitId,provisionalVisitId,...window?{window:structuredClone(window)}:{}};
   const context=makeCheckpoint(structuredClone(state));
    this.db.prepare('INSERT INTO states VALUES(?,?,?,?,?)').run(version,row.id,row.atMs,state.availableAtMs,JSON.stringify(state));
    if(window&&!revising)for(const id of members)this.db.prepare('INSERT INTO window_members VALUES(?,?)').run(id,version);
    this.db.prepare('INSERT INTO checkpoints VALUES(?,?)').run(version,JSON.stringify(context));
    this.db.prepare('INSERT INTO checkpoint_bindings VALUES(?,?)').run(version,JSON.stringify({policy:'spatial-checkpoint-v2',inputIds:members,knowledgeCutoffMs:row.atMs,availableAtMs:state.availableAtMs,contextSHA256:createHash('sha256').update(JSON.stringify(context)).digest('hex'),sourceHashes:members.flatMap(id=>this.observation(id)!.views.map(v=>v.sha256)),compaction:context.summary??null}));
   for(const relation of assessment.relations)this.db.prepare('INSERT INTO relation_assertions VALUES(?,?)').run(version,JSON.stringify(relation));
   for(const revision of assessment.revisions??[]){if(!this.db.prepare('SELECT observation_id FROM states WHERE observation_id=? AND version<?').get(revision.observationId,version))throw Error('Revision target is not committed history');if(revision.location.status==='known'&&!this.db.prepare('SELECT id FROM places WHERE id=?').get(revision.location.placeId))throw Error('Unknown revised identity');this.db.prepare('INSERT INTO revisions VALUES(?,?,?)').run(version,revision.observationId,JSON.stringify(revision));}
   this.db.exec('COMMIT');return state;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
}
