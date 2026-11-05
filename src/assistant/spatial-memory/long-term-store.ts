import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import type {Observation,Facts,Assessment,StoredState,HistoryRecord,WorkingContext,SpatialWindow,SkippedWindow} from './contracts.js';

/** New isolated schema: append-only spatial versions, not a transcript or fact-only ledger. */
export class SpatialLongTermStore{
 private db:DatabaseSync;
 constructor(root:string,private now=Date.now){
  mkdirSync(root,{recursive:true});this.db=new DatabaseSync(join(root,'spatial.sqlite'));
  const tables=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{name:string}>;
   if(tables.length&&!tables.some(t=>t.name==='spatial_schema')){this.db.close();throw Error('Refuse to initialize over a legacy database');}
   if(tables.some(t=>t.name==='spatial_schema')){
    const existing=this.db.prepare('SELECT version FROM spatial_schema').get() as {version:number}|undefined;
    if(existing?.version!==4){this.db.close();throw Error('Spatial schema-v4 requires a new database; legacy databases are preserved without migration');}
   }
  this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS spatial_schema(version INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS observations(seq INTEGER PRIMARY KEY,id TEXT NOT NULL UNIQUE,at_ms REAL NOT NULL UNIQUE,raw TEXT NOT NULL,facts TEXT,error TEXT);
   CREATE TABLE IF NOT EXISTS places(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS visits(id TEXT PRIMARY KEY,place_id TEXT NOT NULL REFERENCES places(id),start_version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS place_records(version INTEGER PRIMARY KEY REFERENCES states(version),place_id TEXT NOT NULL REFERENCES places(id),visit_id TEXT REFERENCES visits(id),at_ms REAL NOT NULL);
    CREATE INDEX IF NOT EXISTS place_records_order ON place_records(place_id,at_ms,version);
    CREATE INDEX IF NOT EXISTS visit_records_order ON place_records(visit_id,at_ms,version);
    CREATE TABLE IF NOT EXISTS place_notes(id TEXT PRIMARY KEY,place_id TEXT NOT NULL REFERENCES places(id),text TEXT NOT NULL,created_version INTEGER NOT NULL REFERENCES states(version),UNIQUE(place_id,text));
    CREATE TABLE IF NOT EXISTS place_note_sources(note_id TEXT NOT NULL REFERENCES place_notes(id),version INTEGER NOT NULL REFERENCES states(version),source_id TEXT NOT NULL REFERENCES observations(id),PRIMARY KEY(note_id,version,source_id));
    CREATE TABLE IF NOT EXISTS states(version INTEGER PRIMARY KEY,observation_id TEXT NOT NULL REFERENCES observations(id),at_ms REAL NOT NULL,available_ms REAL NOT NULL,raw TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS checkpoints(version INTEGER PRIMARY KEY REFERENCES states(version),raw TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS checkpoint_bindings(version INTEGER PRIMARY KEY REFERENCES states(version),raw TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS place_profile_revisions(place_id TEXT NOT NULL REFERENCES places(id),version INTEGER NOT NULL REFERENCES states(version),key TEXT NOT NULL,raw TEXT NOT NULL,PRIMARY KEY(place_id,version,key));
    CREATE TABLE IF NOT EXISTS skipped_windows(tail_id TEXT PRIMARY KEY REFERENCES observations(id),at_ms REAL NOT NULL,raw TEXT NOT NULL,consumed_version INTEGER REFERENCES states(version));
    CREATE TABLE IF NOT EXISTS skipped_members(observation_id TEXT PRIMARY KEY REFERENCES observations(id),tail_id TEXT NOT NULL REFERENCES skipped_windows(tail_id));
    CREATE TABLE IF NOT EXISTS window_members(observation_id TEXT PRIMARY KEY REFERENCES observations(id),version INTEGER NOT NULL REFERENCES states(version));
   CREATE TABLE IF NOT EXISTS relation_assertions(version INTEGER NOT NULL REFERENCES states(version),raw TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS revisions(version INTEGER NOT NULL REFERENCES states(version),observation_id TEXT NOT NULL REFERENCES observations(id),raw TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY,at_ms REAL NOT NULL,kind TEXT NOT NULL,raw TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS states_time ON states(at_ms,available_ms);`);
  const schema=this.db.prepare('SELECT version FROM spatial_schema').get() as any;
    if(schema&&schema.version!==4)throw Error('Incompatible spatial memory schema');
    if(!schema)this.db.prepare('INSERT INTO spatial_schema VALUES(4)').run();
 }
  close(){this.db.close();}
   supportsWindowRevisions(){return (this.db.prepare('SELECT version FROM spatial_schema').get() as any).version===4;}
  event(kind:string,value:unknown){this.db.prepare('INSERT INTO events(at_ms,kind,raw) VALUES(?,?,?)').run(this.now(),kind,JSON.stringify(value));}
  taskTimings():Array<Record<string,unknown>>{return (this.db.prepare("SELECT raw FROM events WHERE kind='spatial-task-timing' ORDER BY seq").all() as Array<{raw:string}>).map(r=>JSON.parse(r.raw));}
  lastTaskTiming(id:string):Record<string,unknown>|undefined{const r=this.db.prepare("SELECT raw FROM events WHERE kind='spatial-task-timing' AND json_extract(raw,'$.taskId')=? ORDER BY seq DESC LIMIT 1").get(id) as {raw:string}|undefined;return r?JSON.parse(r.raw):undefined;}
  archivedAt(id:string):number|undefined{const r=this.db.prepare("SELECT at_ms FROM events WHERE kind='spatial-observation-archived' AND json_extract(raw,'$.id')=? ORDER BY seq LIMIT 1").get(id) as {at_ms:number}|undefined;return r?.at_ms;}
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
  placeProfile(id:string,version=this.version(),knownAtMs=Number.MAX_SAFE_INTEGER,cutoffMs=Number.MAX_SAFE_INTEGER){
   const place=this.db.prepare('SELECT p.id,p.name,p.created_version FROM places p JOIN states s ON s.version=p.created_version WHERE p.id=? AND p.created_version<=? AND s.available_ms<=? AND s.at_ms<=?').get(id,version,knownAtMs,cutoffMs);if(!place)return null;
   const revisions=(this.db.prepare('SELECT p.version,p.raw FROM place_profile_revisions p JOIN states s ON s.version=p.version WHERE p.place_id=? AND p.version<=? AND s.available_ms<=? AND s.at_ms<=? ORDER BY p.version').all(id,version,knownAtMs,cutoffMs) as Array<{version:number;raw:string}>).map(r=>({version:r.version,...JSON.parse(r.raw)}));
   const latest=new Map<string,(typeof revisions)[number]>();for(const r of revisions)latest.set(r.key,r);
    const nameRevision=latest.get('__place_name');
    return {place:nameRevision?{...(place as object),name:nameRevision.value}:place,attributes:[...latest.values()].filter(u=>u.key!=='__place_name'),revisions:revisions.filter(u=>u.key!=='__place_name'),nameRevisions:revisions.filter(u=>u.key==='__place_name'),note:'Agent assertions with sources, not independent observations. Retracted values and original names remain in history.'};
  }
  /** Fixed organization, not an agent-generated tree. Pages contain full facts;
   * a window is the unit of location judgment, never four invented positions. */
  placeMemory(id:string,version=this.version(),knownAtMs=Number.MAX_SAFE_INTEGER,cursor=0,noteCursor=0,cutoffMs=Number.MAX_SAFE_INTEGER){
   if(!Number.isInteger(cursor)||cursor<0||!Number.isInteger(noteCursor)||noteCursor<0)throw Error('Invalid place memory cursor');
   const profile=this.placeProfile(id,version,knownAtMs,cutoffMs);if(!profile)return null;
   const history=this.history(version,cutoffMs,knownAtMs),records=history.filter(r=>r.location.placeId===id),page=records.slice(cursor,cursor+24);
   const visits:Array<{visitId:string|null;windows:HistoryRecord[]}>=[];
   for(const record of page){let visit=visits.find(v=>v.visitId===(record.visitId??null));if(!visit){visit={visitId:record.visitId??null,windows:[]};visits.push(visit);}const copy=structuredClone(record);if(copy.window)delete copy.window.skippedBefore;visit.windows.push(copy);}
   const notes=(this.db.prepare('SELECT n.id,n.text,n.created_version FROM place_notes n JOIN states s ON s.version=n.created_version WHERE n.place_id=? AND n.created_version<=? AND s.available_ms<=? AND s.at_ms<=? ORDER BY n.created_version,n.id LIMIT 25 OFFSET ?').all(id,version,knownAtMs,cutoffMs,noteCursor) as Array<{id:string;text:string;created_version:number}>);
   const notePage=notes.slice(0,24).map(n=>({...n,sources:this.db.prepare('SELECT x.version,x.source_id AS sourceId FROM place_note_sources x JOIN states s ON s.version=x.version WHERE x.note_id=? AND x.version<=? AND s.available_ms<=? AND s.at_ms<=? ORDER BY x.version,x.source_id').all(n.id,version,knownAtMs,cutoffMs)}));
   return {...profile,organization:'place-visits-windows-sources-v1',version,visits,notes:notePage,totalWindows:records.length,nextCursor:cursor+page.length<records.length?cursor+page.length:null,nextNoteCursor:notes.length>24?noteCursor+24:null,
    originalMembership:this.db.prepare('SELECT r.version,r.visit_id AS visitId,r.at_ms AS atMs FROM place_records r JOIN states s ON s.version=r.version WHERE r.place_id=? AND r.version<=? AND s.available_ms<=? AND s.at_ms<=? ORDER BY r.at_ms,r.version LIMIT 24 OFFSET ?').all(id,version,knownAtMs,cutoffMs,cursor),
    unassignedSkippedSourceIds:page.flatMap(r=>r.window?.skippedBefore?.flatMap(w=>w.observations.map(o=>o.id))??[]),
    note:'Visits/windows use the requested revision projection. Original membership is separate. Window members are original facts, not per-frame locations. Skipped sources have no assigned place. Notes are agent assertions, not independent observations.'};
  }
   pending():Observation[]{return (this.db.prepare('SELECT o.raw FROM observations o LEFT JOIN states s ON s.observation_id=o.id LEFT JOIN window_members w ON w.observation_id=o.id LEFT JOIN skipped_members k ON k.observation_id=o.id WHERE s.version IS NULL AND w.version IS NULL AND k.observation_id IS NULL ORDER BY o.seq').all() as any[]).map(r=>JSON.parse(r.raw));}
   skippedBefore(atMs:number):SkippedWindow[]{return (this.db.prepare('SELECT raw FROM skipped_windows WHERE consumed_version IS NULL AND at_ms<? ORDER BY at_ms').all(atMs) as Array<{raw:string}>).map(r=>{const w=JSON.parse(r.raw) as SkippedWindow;return {...w,observations:w.observations.map(o=>({...o,facts:this.facts(o.id)??o.facts}))};});}
   skipWindow(rows:Observation[]){
    const pending=this.pending();if(!rows.length||rows.some((r,i)=>pending[i]?.id!==r.id))throw Error('Only a complete pending source prefix may skip spatial inference');
    const window:SkippedWindow={startMs:rows[0]!.atMs,endExclusiveMs:(Math.floor(rows.at(-1)!.atMs/8000)+1)*8000,...rows[0]!.recordingId?{recordingId:rows[0]!.recordingId}:{},observations:rows.map(r=>({id:r.id,atMs:r.atMs,facts:this.facts(r.id)})),reason:'busy-superseded'};
    this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT INTO skipped_windows VALUES(?,?,?,NULL)').run(rows.at(-1)!.id,rows.at(-1)!.atMs,JSON.stringify(window));for(const row of rows)this.db.prepare('INSERT INTO skipped_members VALUES(?,?)').run(row.id,rows.at(-1)!.id);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
   }
 history(version:number,cutoffMs:number,knownAtMs:number):HistoryRecord[]{
   const latest=new Map<string,StoredState>();for(const row of this.db.prepare('SELECT raw FROM states WHERE version<=? AND at_ms<=? AND available_ms<=? ORDER BY version').all(version,cutoffMs,knownAtMs) as any[]){const state:StoredState=JSON.parse(row.raw);latest.set(state.observationId,state);}
   const records:HistoryRecord[]=[...latest.values()].sort((a,b)=>a.atMs-b.atMs).map(s=>({version:s.version,observationId:s.observationId,atMs:s.atMs,facts:s.facts,location:s.assessment.location,...s.locationDecision?{locationDecision:s.locationDecision}:{},visitId:s.visitId,provisionalVisitId:s.provisionalVisitId??null,...s.window?{window:s.window}:{}}));
  const revisions=this.db.prepare('SELECT r.observation_id,r.raw FROM revisions r JOIN states s ON s.version=r.version WHERE s.version<=? AND s.at_ms<=? AND s.available_ms<=? ORDER BY s.version').all(version,cutoffMs,knownAtMs) as Array<{observation_id:string;raw:string}>;
   for(const revision of revisions){const record=records.find(r=>r.observationId===revision.observation_id);if(record){const location=JSON.parse(revision.raw).location;if(location.placeId!==record.location.placeId){record.visitId=null;record.provisionalVisitId=null;}record.location=location;}}
  return records;
 }
   counts(){const n=(table:string)=>(this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n as number;const spatialStates=(this.db.prepare('SELECT COUNT(DISTINCT observation_id) AS n FROM states').get() as any).n as number;return {observations:n('observations'),spatialStates,stateVersions:n('states'),incompleteWindows:this.history(this.version(),Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER).filter(r=>r.window?.missingFactIds?.length).length,missingFacts:(this.db.prepare('SELECT COUNT(*) AS n FROM observations WHERE facts IS NULL').get() as any).n as number,coveredObservations:n('observations')-this.pending().length-n('skipped_members'),skippedWindows:n('skipped_windows'),skippedObservations:n('skipped_members'),deferredObservations:this.skippedBefore(Number.MAX_SAFE_INTEGER).reduce((n,w)=>n+w.observations.length,0),places:n('places'),visits:n('visits'),pending:this.pending().length};}
   /** Agent-facing add: one atomic operation chooses/creates identity, attaches
    * its visit/window/sources and appends simple evidence-backed note content. */
   add(row:Observation,a:Assessment,makeCheckpoint:(s:StoredState)=>WorkingContext,window?:SpatialWindow):StoredState{return this.commit(row,a,makeCheckpoint,window);}
   commit(row:Observation,a:Assessment,makeCheckpoint:(s:StoredState)=>WorkingContext,window?:SpatialWindow):StoredState{
  this.db.exec('BEGIN IMMEDIATE');try{
    const members=window?.observations.map(o=>o.id)??[row.id],pending=this.pending();
    const revising=window?.revisionOfVersion!==undefined,base=revising?this.state(window!.revisionOfVersion!):null;
    if(revising&&(!base||base.observationId!==row.id||JSON.stringify(base.window?.observations.map(o=>o.id))!==JSON.stringify(members)))throw Error('Invalid window revision target');
    if(!members.length||members.at(-1)!==row.id||!revising&&members.some((id,i)=>pending[i]?.id!==id))throw Error('Spatial commit must follow contiguous source order');
     if(window&&(window.endExclusiveMs<=row.atMs||window.startMs!==window.observations[0]!.atMs||window.observations.some(o=>{const raw=this.observation(o.id);return !raw||raw.atMs!==o.atMs||o.facts!==null&&JSON.stringify(this.facts(o.id))!==JSON.stringify(o.facts);})||JSON.stringify(window.missingFactIds??[])!==JSON.stringify(window.observations.filter(o=>o.facts===null).map(o=>o.id))))throw Error('Invalid window source binding');
     if(window&&!revising&&JSON.stringify(window.skippedBefore??[])!==JSON.stringify(this.skippedBefore(window.startMs)))throw Error('Skipped source binding mismatch');
    const facts=window?window.observations.at(-1)!.facts:this.facts(row.id);if(!facts&&!window)throw Error('No independent facts');
    const version=this.version()+1,assessment=structuredClone(a),location=assessment.location,locationDecision=a.location.status;
   if(location.status==='new'){location.placeId=randomUUID();location.status='known';this.db.prepare('INSERT INTO places VALUES(?,?,?)').run(location.placeId,location.name,version);}
     if(location.status==='known'&&!this.db.prepare('SELECT id FROM places WHERE id=?').get(location.placeId))throw Error('Unknown persistent place');
     let renamePrevious:string|null=null;
     if(assessment.placeRename){
      const rename=assessment.placeRename;
      if(locationDecision!=='known'||!location.placeId||rename.name!==location.name||!rename.name.trim()||!rename.sourceIds.includes(row.id)||rename.sourceIds.some(id=>!this.facts(id)))throw Error('Place rename requires an existing confirmed identity and durable current evidence');
      renamePrevious=(this.placeProfile(location.placeId,version-1,Number.MAX_SAFE_INTEGER,row.atMs) as any).place.name;
     }
    if(location.continuityCandidate&&!this.db.prepare('SELECT id FROM places WHERE id=?').get(location.continuityCandidate.placeId))throw Error('Unknown provisional continuity place');
    const previous=revising?base:this.state(version-1),sameRecording=previous?this.observation(previous.observationId)?.recordingId===row.recordingId:false;
    let visitId:string|null=null,createdVisit=false;
    if(location.placeId){
     const previousPlace=previous?.assessment.location.placeId??previous?.assessment.location.continuityCandidate?.placeId;
     visitId=previousPlace===location.placeId&&sameRecording&&row.atMs-previous!.atMs<=60000?(previous!.visitId??previous!.provisionalVisitId??randomUUID()):randomUUID();
     if(visitId&&!this.db.prepare('SELECT id FROM visits WHERE id=?').get(visitId)){this.db.prepare('INSERT INTO visits VALUES(?,?,?)').run(visitId,location.placeId,version);createdVisit=true;}
    }
    let provisionalVisitId:string|null=null;
    if(location.continuityCandidate){const reference=this.history(version-1,row.atMs-0.000001,Number.MAX_SAFE_INTEGER).find(r=>r.observationId===location.continuityCandidate!.referenceId);provisionalVisitId=reference?.visitId??reference?.provisionalVisitId??null;}
     const plannedNotes=new Map<string,{id:string;text:string;sourceIds:Set<string>;isNew:boolean}>();
     for(const n of assessment.memoryNotes??[]){
      if(!location.placeId||!n.text.trim()||!n.sourceIds.length||n.sourceIds.some(id=>!this.facts(id)))throw Error('Cannot add a place note without a confirmed place and durable evidence');
      const text=n.text.trim();let plan=plannedNotes.get(text);if(!plan){const existing=this.db.prepare('SELECT id FROM place_notes WHERE place_id=? AND text=?').get(location.placeId,text) as {id:string}|undefined;plan={id:existing?.id??randomUUID(),text,sourceIds:new Set(),isNew:!existing};plannedNotes.set(text,plan);}for(const id of n.sourceIds)plan.sourceIds.add(id);
     }
     const state:StoredState={version,observationId:row.id,atMs:row.atMs,availableAtMs:this.now(),facts,assessment,locationDecision,visitId,provisionalVisitId,...window?{window:structuredClone(window)}:{},memoryReceipt:{operation:'add',version,placeId:location.placeId,visitId,createdPlace:locationDecision==='new',createdVisit,observationIds:members,grouped:location.placeId!==null,noteIds:[...plannedNotes.values()].map(n=>n.id),notesAdded:[...plannedNotes.values()].filter(n=>n.isNew).length,attributeRevisions:assessment.placeUpdates?.length??0}};
    if(assessment.placeRename)state.memoryReceipt!.renamedPlace=renamePrevious!==assessment.placeRename.name;
    const context=makeCheckpoint(structuredClone(state));
    this.db.prepare('INSERT INTO states VALUES(?,?,?,?,?)').run(version,row.id,row.atMs,state.availableAtMs,JSON.stringify(state));
    if(location.placeId)this.db.prepare('INSERT INTO place_records VALUES(?,?,?,?)').run(version,location.placeId,visitId,row.atMs);
    for(const n of plannedNotes.values()){if(n.isNew)this.db.prepare('INSERT INTO place_notes VALUES(?,?,?,?)').run(n.id,location.placeId,n.text,version);for(const source of n.sourceIds)this.db.prepare('INSERT INTO place_note_sources VALUES(?,?,?)').run(n.id,version,source);}
    if(window&&!revising)this.db.prepare('UPDATE skipped_windows SET consumed_version=? WHERE consumed_version IS NULL AND at_ms<?').run(version,window.startMs);
    for(const update of assessment.placeUpdates??[]){
     if(update.key==='__place_name')throw Error('Reserved place name revision key');
     if(!location.placeId||!update.sourceIds.length||update.sourceIds.some(id=>!this.facts(id)))throw Error('Place profile requires an existing place and durable facts');
     if(update.status==='retracted'&&!this.db.prepare('SELECT key FROM place_profile_revisions WHERE place_id=? AND key=?').get(location.placeId,update.key))throw Error('Cannot retract an absent place attribute');
      this.db.prepare('INSERT INTO place_profile_revisions VALUES(?,?,?,?)').run(location.placeId,version,update.key,JSON.stringify(update));
     }
     if(assessment.placeRename){
      const rename=assessment.placeRename;
      if(state.memoryReceipt!.renamedPlace)this.db.prepare('INSERT INTO place_profile_revisions VALUES(?,?,?,?)').run(location.placeId,version,'__place_name',JSON.stringify({key:'__place_name',value:rename.name,status:'asserted',reason:rename.reason,sourceIds:rename.sourceIds,previousName:renamePrevious}));
     }
    if(window&&!revising)for(const id of members)this.db.prepare('INSERT INTO window_members VALUES(?,?)').run(id,version);
    this.db.prepare('INSERT INTO checkpoints VALUES(?,?)').run(version,JSON.stringify(context));
    this.db.prepare('INSERT INTO checkpoint_bindings VALUES(?,?)').run(version,JSON.stringify({policy:'spatial-checkpoint-v2',inputIds:members,knowledgeCutoffMs:row.atMs,availableAtMs:state.availableAtMs,contextSHA256:createHash('sha256').update(JSON.stringify(context)).digest('hex'),sourceHashes:members.flatMap(id=>this.observation(id)!.views.map(v=>v.sha256)),compaction:context.summary??null}));
   for(const relation of assessment.relations)this.db.prepare('INSERT INTO relation_assertions VALUES(?,?)').run(version,JSON.stringify(relation));
   for(const revision of assessment.revisions??[]){if(!this.db.prepare('SELECT observation_id FROM states WHERE observation_id=? AND version<?').get(revision.observationId,version))throw Error('Revision target is not committed history');if(revision.location.status==='known'&&!this.db.prepare('SELECT id FROM places WHERE id=?').get(revision.location.placeId))throw Error('Unknown revised identity');this.db.prepare('INSERT INTO revisions VALUES(?,?,?)').run(version,revision.observationId,JSON.stringify(revision));}
   this.db.exec('COMMIT');return state;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
}
