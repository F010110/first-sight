import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Observation,Facts,Assessment,StoredState,HistoryRecord,WorkingContext} from './contracts.js';

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
   CREATE TABLE IF NOT EXISTS states(version INTEGER PRIMARY KEY,observation_id TEXT UNIQUE NOT NULL REFERENCES observations(id),at_ms REAL NOT NULL,available_ms REAL NOT NULL,raw TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS checkpoints(version INTEGER PRIMARY KEY REFERENCES states(version),raw TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS relation_assertions(version INTEGER NOT NULL REFERENCES states(version),raw TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS revisions(version INTEGER NOT NULL REFERENCES states(version),observation_id TEXT NOT NULL REFERENCES observations(id),raw TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY,at_ms REAL NOT NULL,kind TEXT NOT NULL,raw TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS states_time ON states(at_ms,available_ms);`);
  const schema=this.db.prepare('SELECT version FROM spatial_schema').get() as any;
  if(schema&&schema.version!==1)throw Error('Incompatible spatial memory schema');
  if(!schema)this.db.prepare('INSERT INTO spatial_schema VALUES(1)').run();
 }
 close(){this.db.close();}
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
 pending():Observation[]{return (this.db.prepare('SELECT o.raw FROM observations o LEFT JOIN states s ON s.observation_id=o.id WHERE s.version IS NULL ORDER BY o.seq').all() as any[]).map(r=>JSON.parse(r.raw));}
 history(version:number,cutoffMs:number,knownAtMs:number):HistoryRecord[]{
  const records:HistoryRecord[]=(this.db.prepare('SELECT raw FROM states WHERE version<=? AND at_ms<=? AND available_ms<=? ORDER BY version').all(version,cutoffMs,knownAtMs) as any[]).map(r=>{const s:StoredState=JSON.parse(r.raw);return {version:s.version,observationId:s.observationId,atMs:s.atMs,facts:s.facts,location:s.assessment.location};});
  const revisions=this.db.prepare('SELECT r.observation_id,r.raw FROM revisions r JOIN states s ON s.version=r.version WHERE s.version<=? AND s.at_ms<=? AND s.available_ms<=? ORDER BY s.version').all(version,cutoffMs,knownAtMs) as Array<{observation_id:string;raw:string}>;
  for(const revision of revisions){const record=records.find(r=>r.observationId===revision.observation_id);if(record)record.location=JSON.parse(revision.raw).location;}
  return records;
 }
 counts(){const n=(table:string)=>(this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n as number;return {observations:n('observations'),spatialStates:n('states'),places:n('places'),visits:n('visits'),pending:this.pending().length};}
 commit(row:Observation,a:Assessment,makeCheckpoint:(s:StoredState)=>WorkingContext):StoredState{
  this.db.exec('BEGIN IMMEDIATE');try{
   const next=this.pending()[0];if(next?.id!==row.id)throw Error('Spatial commit must follow contiguous source order');
   const facts=this.facts(row.id);if(!facts)throw Error('No independent facts');
   const version=this.version()+1,assessment=structuredClone(a),location=assessment.location;
   if(location.status==='new'){location.placeId=randomUUID();this.db.prepare('INSERT INTO places VALUES(?,?,?)').run(location.placeId,location.name,version);}
   if(location.status==='known'&&!this.db.prepare('SELECT id FROM places WHERE id=?').get(location.placeId))throw Error('Unknown persistent place');
   const previous=this.state(version-1),sameRecording=previous?this.observation(previous.observationId)?.recordingId===row.recordingId:false;
   let visitId:string|null=null;
   if(location.placeId){visitId=previous?.assessment.location.placeId===location.placeId&&sameRecording&&row.atMs-previous.atMs<=60000?previous.visitId:randomUUID();if(visitId&&!this.db.prepare('SELECT id FROM visits WHERE id=?').get(visitId))this.db.prepare('INSERT INTO visits VALUES(?,?,?)').run(visitId,location.placeId,version);}
   const state:StoredState={version,observationId:row.id,atMs:row.atMs,availableAtMs:this.now(),facts,assessment,visitId};
   const context=makeCheckpoint(structuredClone(state));
   this.db.prepare('INSERT INTO states VALUES(?,?,?,?,?)').run(version,row.id,row.atMs,state.availableAtMs,JSON.stringify(state));
   this.db.prepare('INSERT INTO checkpoints VALUES(?,?)').run(version,JSON.stringify(context));
   for(const relation of assessment.relations)this.db.prepare('INSERT INTO relation_assertions VALUES(?,?)').run(version,JSON.stringify(relation));
   for(const revision of assessment.revisions??[]){if(!this.db.prepare('SELECT observation_id FROM states WHERE observation_id=? AND version<?').get(revision.observationId,version))throw Error('Revision target is not committed history');if(revision.location.status==='known'&&!this.db.prepare('SELECT id FROM places WHERE id=?').get(revision.location.placeId))throw Error('Unknown revised identity');this.db.prepare('INSERT INTO revisions VALUES(?,?,?)').run(version,revision.observationId,JSON.stringify(revision));}
   this.db.exec('COMMIT');return state;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
}
