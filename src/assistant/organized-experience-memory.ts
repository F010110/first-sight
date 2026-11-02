import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {segmentExperience,type BoundaryEvent} from '../agent/experience-segments.js';

export type EvidenceView={direction:string;path:string;sha256:string};
export type ExperienceFact={memoryRef:string;observationId:string;atMs:number;sourceAtMs:number;availableAtMs:number;recordingId:string;text:string;views:EvidenceView[];rawResultJSON:string};
export type KnowledgeCutoff={eventAtMs:number;knownAtMs:number};
export type OrganizationClaim={id:string;kind:'event'|'entity'|'relation';predicate:string;subject:string;object:string|null;factRefs:string[];status:'candidate'|'supported'|'rejected'};
export type OrganizationRevision={knownAtMs:number;evidenceUntilMs:number;boundaries:BoundaryEvent[];claims:OrganizationClaim[];reason:string};
export type ExperienceQuery={text:string;order?:'relevance'|'earliest'|'latest';afterMs?:number;beforeMs?:number;limit?:number};

const vocabulary:Record<string,RegExp>={
 'rail-platform':/地铁站台|地下(?:车站|站台)|站台边缘|subway platform|train platform/i,
 'bus-stop':/公交(?:车)?候车亭|公交站|巴士站|bus stop|bus shelter/i,
 'seating':/长椅|座椅|座位|卡座|高脚凳|圆凳|bench|seating|chair|booth/i,
 'shop':/五金店|熟食店|当铺|洗衣店|店铺|商店|店内|店面|hardware|shop|store|laundromat|deli/i,
 'counter':/柜台|台面|吧台|counter|tabletop|bar counter/i,
 'stairs':/楼梯|阶梯|台阶|stairs|steps/i,
 'door':/木门|玻璃门|电梯门|门口|门洞|door|entrance/i,
 'noticeboard':/公告板|布告栏|布告板|告示板|软木板|noticeboard|bulletin/i,
 'laundry':/洗衣店|洗衣房|滚筒洗衣机|烘干机|laundromat|washing machines/i,
 'elevator':/电梯|轿厢|elevator|lift lobby/i,
 'food-service':/餐厅|就餐区|餐饮场所|吧台.*高脚凳|台球桌|restaurant|diner|pool table/i,
 'fuel':/加油站|加油泵|加油机|gas station|fuel pump/i,
 'rooftop':/屋顶露台|屋顶平台|rooftop|roof terrace/i,
};
const noise=/[的了是在和与有这那我们当前画面可见前方左右侧一处]/g;
function terms(text:string){
 const words=text.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]{2,}/g)??[];
 return [...new Set(words.flatMap(word=>/[\u4e00-\u9fff]/.test(word)?Array.from({length:Math.max(0,word.length-1)},(_,i)=>word.slice(i,i+2)).filter(t=>t.replace(noise,'').length>0):[word]))];
}
export function experienceFacets(text:string){return Object.entries(vocabulary).filter(([,r])=>r.test(text)).map(([name])=>name);}
function environment(text:string):'indoor'|'outdoor'|null{
 const inside=/室内|店内|房间|轿厢|走廊|门厅|地下(?:车站|站台)|站台环境|洗衣房|厨房|indoor|platform|corridor/i.exec(text);
 const outside=/城市街|城市路口|街道场景|街景|十字路口|小巷|屋顶露台|户外|室外场景|outdoor|street scene|rooftop/i.exec(text);
 if(!inside&&!outside)return null;
 if(!outside)return 'indoor';if(!inside)return 'outdoor';
 return inside.index<outside.index?'indoor':'outdoor';
}
function queryFacets(text:string){const facets=experienceFacets(text);if(/店|shop|store/i.test(text))facets.push('shop');if(/等车|候车|waiting for (?:a )?(?:train|bus)/i.test(text))facets.push('rail-platform','bus-stop');return [...new Set(facets)];}
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
const finite=(n:number)=>Number.isFinite(n)&&n>=0;

/** Append-only evidence plus revisable interpretations. An episode is NOT a physical place. */
export class OrganizedExperienceMemory{
 private db:DatabaseSync;
 constructor(path:string,private readOnly=false){
  this.db=new DatabaseSync(path,{readOnly});
  if(readOnly){this.db.exec('PRAGMA query_only=ON; BEGIN');this.db.prepare('SELECT revision FROM organization_revisions LIMIT 1').all();return;}
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
   CREATE TABLE IF NOT EXISTS experience_facts(memory_ref TEXT PRIMARY KEY,observation_id TEXT NOT NULL UNIQUE,at_ms REAL NOT NULL UNIQUE,available_at_ms REAL NOT NULL,body TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS experience_fact_time ON experience_facts(at_ms,available_at_ms);
   CREATE TABLE IF NOT EXISTS organization_revisions(revision INTEGER PRIMARY KEY,known_at_ms REAL NOT NULL,evidence_until_ms REAL NOT NULL,body TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS organization_knowledge ON organization_revisions(known_at_ms,evidence_until_ms);`);
 }
 append(input:ExperienceFact){
  if(this.readOnly)throw Error('Organization reader cannot write');
  const allowed=['memoryRef','observationId','atMs','sourceAtMs','availableAtMs','recordingId','text','views','rawResultJSON'];
  if(Object.keys(input).some(k=>!allowed.includes(k))||!input.memoryRef||!input.observationId||!input.recordingId||!finite(input.atMs)||!finite(input.sourceAtMs)||!finite(input.availableAtMs)||typeof input.text!=='string'||!input.text.trim()||input.text.length>12000||typeof input.rawResultJSON!=='string'||!Array.isArray(input.views)||!input.views.length||input.views.length>3||input.views.some(v=>!v.path||!v.direction||!/^[a-f0-9]{64}$/.test(v.sha256)))throw Error('Invalid source fact');
  JSON.parse(input.rawResultJSON);
  const body=JSON.stringify(input),existing=this.db.prepare('SELECT body FROM experience_facts WHERE memory_ref=?').get(input.memoryRef) as {body:string}|undefined;
  if(existing){if(existing.body!==body)throw Error('Immutable fact changed');return;}
  this.db.prepare('INSERT INTO experience_facts VALUES(?,?,?,?,?)').run(input.memoryRef,input.observationId,input.atMs,input.availableAtMs,body);
 }
 facts(cutoff:KnowledgeCutoff){
  if(!finite(cutoff.eventAtMs)||!finite(cutoff.knownAtMs))throw Error('Use separate finite event and knowledge clocks');
  return (this.db.prepare('SELECT body FROM experience_facts WHERE at_ms<=? AND available_at_ms<=? ORDER BY at_ms').all(cutoff.eventAtMs,cutoff.knownAtMs) as {body:string}[]).map(r=>JSON.parse(r.body) as ExperienceFact);
 }
 revise(input:OrganizationRevision){
  if(this.readOnly)throw Error('Organization reader cannot revise');
  if(!finite(input.knownAtMs)||!finite(input.evidenceUntilMs)||!input.reason?.trim()||Object.keys(input).some(k=>!['knownAtMs','evidenceUntilMs','boundaries','claims','reason'].includes(k)))throw Error('Invalid organization revision');
  const facts=this.facts({eventAtMs:input.evidenceUntilMs,knownAtMs:input.knownAtMs});
  const byRef=new Map(facts.map(f=>[f.memoryRef,f]));
  const knownFrames=new Set(facts.flatMap(f=>f.views.map(v=>v.path)));
  if(input.boundaries.some(b=>b.source!=='automatic'))throw Error('Oracle boundaries are not allowed in organized memory');
  if(input.boundaries.some(b=>b.frames.some(frame=>!knownFrames.has(frame))))throw Error('Boundary cites unknown evidence');
  segmentExperience(facts.map(f=>({id:f.observationId,atMs:f.atMs,frames:f.views.map(v=>v.path)})),input.boundaries,1);
  const ids=new Set<string>();
  for(const claim of input.claims){
   if(Object.keys(claim).some(k=>!['id','kind','predicate','subject','object','factRefs','status'].includes(k))||!claim.id||ids.has(claim.id)||!['event','entity','relation'].includes(claim.kind)||!['candidate','supported','rejected'].includes(claim.status)||!claim.predicate?.trim()||!claim.subject?.trim()||claim.object!==null&&typeof claim.object!=='string'||!Array.isArray(claim.factRefs)||!claim.factRefs.length||new Set(claim.factRefs).size!==claim.factRefs.length||claim.factRefs.some(ref=>!byRef.has(ref)))throw Error('Claim needs distinct known source facts');
   if(claim.kind==='relation'&&claim.predicate==='same-instance'&&new Set(claim.factRefs.map(ref=>byRef.get(ref)!.observationId)).size<2)throw Error('Same-instance relation needs multiple observations');
   ids.add(claim.id);
  }
  const last=this.db.prepare('SELECT known_at_ms FROM organization_revisions ORDER BY revision DESC LIMIT 1').get() as {known_at_ms:number}|undefined;
  if(last&&input.knownAtMs<last.known_at_ms)throw Error('Revision knowledge cannot go backwards');
  return Number(this.db.prepare('INSERT INTO organization_revisions(known_at_ms,evidence_until_ms,body) VALUES(?,?,?)').run(input.knownAtMs,input.evidenceUntilMs,JSON.stringify(input)).lastInsertRowid);
 }
 view(cutoff:KnowledgeCutoff){
  const facts=this.facts(cutoff);
  const row=this.db.prepare('SELECT revision,body FROM organization_revisions WHERE known_at_ms<=? AND evidence_until_ms<=? ORDER BY revision DESC LIMIT 1').get(cutoff.knownAtMs,cutoff.eventAtMs) as {revision:number;body:string}|undefined;
  const interpretation=row?JSON.parse(row.body) as OrganizationRevision:null;
  const natural=facts.slice(1).flatMap((f,i)=>{
   const previous=facts[i]!;
   return f.recordingId!==previous.recordingId||f.sourceAtMs-previous.sourceAtMs>2500?[{id:`gap:${f.observationId}`,beforeObservationId:f.observationId,source:'automatic' as const,reason:'Recording boundary or source-clock gap; not a physical doorway',frames:f.views.map(v=>v.path)}]:[];
  });
  const boundaries=new Map([...natural,...(interpretation?.boundaries??[])].map(b=>[b.beforeObservationId,b]));
  const segmentation=segmentExperience(facts.map(f=>({id:f.observationId,atMs:f.atMs,frames:f.views.map(v=>v.path)})),[...boundaries.values()],row?.revision??1);
  const episodes=segmentation.segments.map(segment=>{
   const selected=facts.filter(f=>segment.observationIds.includes(f.observationId));
   const first=selected[0]!,last=selected.at(-1)!;
   return {episodeRef:`experience:${sha(first.observationId).slice(0,16)}:r${row?.revision??0}`,revision:row?.revision??0,startMs:first.atMs,endMs:last.atMs,
    recordingId:first.recordingId,factRefs:selected.map(f=>f.memoryRef),observationIds:segment.observationIds,
    facets:[...new Set(selected.flatMap(f=>experienceFacets(f.text)))],
    representativeRefs:[...new Set([first.memoryRef,selected[Math.floor((selected.length-1)/2)]!.memoryRef,last.memoryRef])],
    status:'candidate' as const,placeIdentity:null,open:segment===segmentation.segments.at(-1)};
  });
  return {cutoff,revision:row?.revision??0,facts,episodes,claims:interpretation?.claims??[],
   note:'Episode membership is a revisable interpretation, not GT place identity or certified visit order. Facts remain unchanged.'};
 }
 locate(query:ExperienceQuery,cutoff:KnowledgeCutoff){
  const limit=query.limit??8,order=query.order??'relevance';
  if(typeof query.text!=='string'||!query.text.trim()||query.text.length>500||!['relevance','earliest','latest'].includes(order)||!Number.isInteger(limit)||limit<1||limit>20||query.afterMs!==undefined&&!finite(query.afterMs)||query.beforeMs!==undefined&&!finite(query.beforeMs)||query.afterMs!==undefined&&query.beforeMs!==undefined&&query.afterMs>query.beforeMs)throw Error('Invalid experience query');
  const view=this.view(cutoff),keys=terms(query.text),facets=queryFacets(query.text);
  const facts=view.facts.filter(f=>(query.afterMs===undefined||f.atMs>=query.afterMs)&&(query.beforeMs===undefined||f.atMs<=query.beforeMs));
  const byRef=new Map(facts.map(f=>[f.memoryRef,f]));
  const candidates=view.episodes.flatMap(episode=>{
   const selected=episode.factRefs.flatMap(ref=>byRef.has(ref)?[byRef.get(ref)!]:[]);if(!selected.length)return [];
   const hits=selected.map(f=>({fact:f,score:keys.reduce((n,t)=>n+Number(f.text.toLowerCase().includes(t)),0)+experienceFacets(f.text).reduce((n,t)=>n+(facets.includes(t)?4:0),0)})).filter(h=>h.score>0);
   if(!hits.length)return [];
   // Boundaries determine context, but temporal anchors are matching observations, not unrelated earlier members.
   const matchingTimes=hits.map(h=>h.fact.atMs);
   const ranked=hits.sort((a,b)=>b.score-a.score||a.fact.atMs-b.fact.atMs);
   const anchor=order==='earliest'?[...hits].sort((a,b)=>a.fact.atMs-b.fact.atMs)[0]:order==='latest'?[...hits].sort((a,b)=>b.fact.atMs-a.fact.atMs)[0]:undefined;
   const evidence=[...(anchor?[anchor]:[]),...ranked.filter(h=>h!==anchor)].slice(0,3);
   return [{episodeRef:episode.episodeRef,startMs:episode.startMs,endMs:episode.endMs,matchStartMs:Math.min(...matchingTimes),matchEndMs:Math.max(...matchingTimes),
    score:Math.max(...hits.map(h=>h.score)),facets:episode.facets,evidence:evidence.map(h=>({memoryRef:h.fact.memoryRef,atMs:h.fact.atMs,text:h.fact.text})),
    status:episode.status,constraints:{order,afterMs:query.afterMs??null,beforeMs:query.beforeMs??null},
    unresolved:['Category/facet matches are candidate cues, not identity proof','Earliest match is not proof of first physical visit']}];
  });
  candidates.sort(order==='earliest'?(a,b)=>a.matchStartMs-b.matchStartMs||b.score-a.score:order==='latest'?(a,b)=>b.matchEndMs-a.matchEndMs||b.score-a.score:(a,b)=>b.score-a.score||a.matchStartMs-b.matchStartMs);
   return {revision:view.revision,candidates:candidates.slice(0,limit),totalCandidates:candidates.length,
    citationContract:'episodeRef is for memory.facts/memory.sequence only; cite evidence.memoryRef (memory-v...), never episodeRef',
    nextStep:'A facade match does not establish interior attributes or visit order. Expand memory.sequence around a candidate and inspect supporting facts.'};
  }
 sequence(episodeRef:string,cutoff:KnowledgeCutoff){
  const view=this.view(cutoff),index=view.episodes.findIndex(e=>e.episodeRef===episodeRef);
  if(index<0)throw Error('Unknown or stale experience reference');
  const anchor=view.episodes[index]!,byRef=new Map(view.facts.map(f=>[f.memoryRef,f]));
  const candidates=view.episodes.slice(Math.max(0,index-1),index+2).filter(e=>{
   if(e.recordingId!==anchor.recordingId)return false;
   if(e===anchor)return true;
   const earlier=e.startMs<anchor.startMs?e:anchor,later=e.startMs<anchor.startMs?anchor:e;
   return byRef.get(later.factRefs[0]!)!.sourceAtMs-byRef.get(earlier.factRefs.at(-1)!)!.sourceAtMs<=2500;
  }).map(e=>{
   const refs=[...new Set([...e.factRefs.slice(0,2),...e.representativeRefs,...e.factRefs.slice(-2)])];
   return {episodeRef:e.episodeRef,startMs:e.startMs,endMs:e.endMs,relative:e===anchor?'selected':e.startMs<anchor.startMs?'before':'after',facets:e.facets,
    evidence:refs.map(ref=>{const f=byRef.get(ref)!;return {memoryRef:f.memoryRef,observationId:f.observationId,atMs:f.atMs,text:f.text};})};
  });
  return {candidates,relation:'chronological-neighbors-only',confirmedEntry:false,confirmedSamePlace:false,
   note:'Adjacent description contexts are retrieval candidates, not verified transitions, visits or identity. Use original evidence to verify the target.'};
 }
 retrieveFacts(episodeRef:string,text:string,cutoff:KnowledgeCutoff,limit=6){
  const view=this.view(cutoff),episode=view.episodes.find(e=>e.episodeRef===episodeRef);
  if(!episode)throw Error('Unknown or stale experience reference');
  if(!text.trim()||text.length>500||!Number.isInteger(limit)||limit<1||limit>12)throw Error('Invalid fact query');
  const keys=terms(text),facets=queryFacets(text);
  return view.facts.filter(f=>episode.factRefs.includes(f.memoryRef)).map(f=>({fact:f,score:keys.reduce((n,t)=>n+Number(f.text.toLowerCase().includes(t)),0)+experienceFacets(f.text).reduce((n,t)=>n+(facets.includes(t)?4:0),0)})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||a.fact.atMs-b.fact.atMs).slice(0,limit).map(r=>r.fact);
 }
 events(predicate:string,cutoff:KnowledgeCutoff){
  if(!predicate.trim())throw Error('Event predicate required');const view=this.view(cutoff),byRef=new Map(view.facts.map(f=>[f.memoryRef,f]));
  return {events:view.claims.filter(c=>c.kind==='event'&&c.predicate===predicate&&c.status==='supported').map(c=>({...c,atMs:Math.min(...c.factRefs.map(ref=>byRef.get(ref)!.atMs))})).sort((a,b)=>a.atMs-b.atMs),
   orderScope:'supported-recorded-events-only',coverageComplete:false,unknownEventsPossible:true};
 }
 synchronize(facts:ExperienceFact[]){
  if(this.readOnly)throw Error('Organization reader cannot synchronize');
  if(!facts.length)return {added:0,revision:0};
  if(facts.length>5000)throw Error('Organizer fact bound exceeded');
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const prior=this.facts({eventAtMs:Number.MAX_SAFE_INTEGER,knownAtMs:Number.MAX_SAFE_INTEGER});
   const refs=new Set(facts.map(f=>f.memoryRef));
   if(prior.some(f=>!refs.has(f.memoryRef)))throw Error('Synchronization cannot forget committed history');
   for(const fact of facts)this.append(fact);
   const added=facts.length-prior.length;
   const cutoff={eventAtMs:Math.max(...facts.map(f=>f.atMs)),knownAtMs:Math.max(...facts.map(f=>f.availableAtMs))};
   const current=this.view(cutoff);let revision=current.revision;
   if(added){
    const boundaries=proposeExperienceBoundaries(facts).map(p=>p.boundary);
    revision=this.revise({knownAtMs:cutoff.knownAtMs,evidenceUntilMs:cutoff.eventAtMs,boundaries,claims:current.claims,reason:'Incremental committed-fact reconciliation; temporal candidates only, no new confirmed identities or entry events'});
   }
   this.db.exec('COMMIT');return {added,revision};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 close(){this.db.close();}
}

/** Low-cost text-change proposals. They are NOT certified doors, visits or physical places. */
export function proposeExperienceBoundaries(facts:ExperienceFact[]):Array<{boundary:BoundaryEvent;knownAtMs:number;evidenceUntilMs:number}>{
 const proposals:Array<{boundary:BoundaryEvent;knownAtMs:number;evidenceUntilMs:number}>=[];
 let anchors:ExperienceFact[]=[],pending:ExperienceFact[]=[],lastFact:ExperienceFact|undefined,knownSoFar=0;
 for(const fact of facts){
  knownSoFar=Math.max(knownSoFar,fact.availableAtMs);
  const previous=lastFact;lastFact=fact;
  if(previous&&(fact.recordingId!==previous.recordingId||fact.sourceAtMs-previous.sourceAtMs>2500)) {anchors=[fact];pending=[];continue;}
  const a=new Set(anchors.flatMap(f=>terms(f.text))),b=new Set(terms(fact.text));
  const common=[...b].filter(t=>a.has(t)).length,score=common/Math.max(1,Math.min(a.size,b.size));
  const previousScenes=anchors.map(f=>environment(f.text)),scene=environment(fact.text);
  const indoor=previousScenes.filter(s=>s==='indoor').length,outdoor=previousScenes.filter(s=>s==='outdoor').length;
  const referenceScene=indoor>=3&&indoor>outdoor?'indoor':outdoor>=3&&outdoor>indoor?'outdoor':null;
  const sustainedSceneCandidate=scene!==null&&referenceScene!==null&&scene!==referenceScene;
  const specific=new Set(['rail-platform','laundry','elevator','food-service','fuel','rooftop']);
  const currentSpecific=experienceFacets(fact.text).filter(f=>specific.has(f));
  const stableSpecific=currentSpecific.some(facet=>anchors.filter(f=>experienceFacets(f.text).includes(facet)).length>=3);
  // A view-dependent wording change alone need not split a coherent candidate episode.
  // This does NOT promote a shared category into same-place identity.
  if(anchors.length>=3&&b.size>=8&&((score<.35&&!stableSpecific)||sustainedSceneCandidate)){
   if(pending.length&&scene&&environment(pending[0]!.text)&&scene!==environment(pending[0]!.text))pending=[];
   pending.push(fact);
  }else{pending=[];anchors.push(fact);anchors=anchors.slice(-8);}
  if(pending.length===3){
   const first=pending[0]!;
   proposals.push({boundary:{id:`text-change:${first.observationId}`,beforeObservationId:first.observationId,source:'automatic',reason:'Three sustained description changes; candidate temporal context only, not a physical crossing',frames:[...new Set(pending.flatMap(f=>f.views.map(v=>v.path)))]},
    knownAtMs:knownSoFar,evidenceUntilMs:fact.atMs});
   anchors=[...pending];pending=[];
  }
 }
 return proposals;
}
