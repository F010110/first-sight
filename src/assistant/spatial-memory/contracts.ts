import type {SpatialJsonImage} from '../../agent/spatial-json-vlm.js';

/** Business memory contracts; independent of Pi transcripts and evaluation labels. */
export type Observation={id:string;atMs:number;sourceAtMs?:number;recordingId?:string;views:SpatialJsonImage[]};
export type Facts={summary:string;details:string[]};
export type Location={status:'new'|'known'|'unknown';placeId:string|null;name:string;reason:string;sourceIds:string[];contextRefs?:string[];boundary?:{regions:string[]};regionChangeEvidence?:string[];continuityCandidate?:{placeId:string;referenceId:string;reason:string}};
export type Relation={kind:'same-facility'|'different-region';referenceId:string;reason:string;sourceIds:string[]};
export type SpatialRevision={observationId:string;location:Location};
export type PlaceUpdate={key:string;value:string;status:'asserted'|'uncertain'|'retracted';reason:string;sourceIds:string[]};
export type Assessment={location:Location;hypotheses:string[];unresolved:string[];relations:Relation[];revisions?:SpatialRevision[];placeUpdates?:PlaceUpdate[]};
export type SkippedWindow={startMs:number;endExclusiveMs:number;recordingId?:string;observations:Array<{id:string;atMs:number;facts:Facts}>;reason:'busy-superseded'};
export type SpatialWindow={startMs:number;endExclusiveMs:number;observations:Array<{id:string;atMs:number;facts:Facts|null}>;missingFactIds?:string[];revisionOfVersion?:number;skippedBefore?:SkippedWindow[]};
export type StoredState={version:number;observationId:string;atMs:number;availableAtMs:number;facts:Facts|null;assessment:Assessment;locationDecision?:Location['status'];visitId:string|null;provisionalVisitId?:string|null;window?:SpatialWindow};
export type SpatialTimingEvent={type:'archived'|'window-sealed'|'perception-start'|'perception-end'|'evidence-wait-start'|'evidence-wait-end'|'judgment-start'|'state-committed';atMs:number;observationIds:string[];taskId?:string;version?:number;missingFactIds?:string[];repairOfVersion?:number};
export type AgentCheckpoint={sessionId:string;tipId:string;skillVersions:Record<string,string>};
export type ContinuityReference={observationId:string;placeId:string;name:string;uncertain:boolean};
export type JudgeInput={row:Observation;facts:Facts|null;context:WorkingContext;history:HistoryRecord[];previousRegion?:ContinuityReference;window?:SpatialWindow;windowViews?:SpatialJsonImage[];readPlace?:(id:string)=>unknown;evaluate?:(assessment:Assessment,evidence:JudgeEvidence)=>void;inspect:(ids:string[])=>Promise<SpatialJsonImage[]>;commit:(assessment:Assessment,evidence:JudgeEvidence)=>Promise<StoredState>;feedback?:string|null};
export interface SpatialReasoner{judge(input:JudgeInput):Promise<Assessment>;close():Promise<void>}
export type HistoryRecord={observationId:string;atMs:number;facts:Facts|null;location:Location;locationDecision?:Location['status'];version:number;visitId?:string|null;provisionalVisitId?:string|null;window?:SpatialWindow};
export type WorkingContext={current:{id:string;atMs:number};location:Location|null;recent:StoredState[];anchors:StoredState[];retrieved:HistoryRecord[];summary?:{policy:string;text:string;sourceIds:string[];throughAtMs:number};unresolved?:string[]};
export type SpatialAction=
 |{kind:'find';terms:string[];assessment:Assessment}
 |{kind:'read';afterMs?:number;beforeMs?:number;cursor?:number;assessment:Assessment}
 |{kind:'inspect';observationIds:string[];assessment:Assessment}
 |{kind:'commit';assessment:Assessment};
export type ReasonInput={current:Observation;facts:Facts;context:WorkingContext;toolResult:unknown;inspectedIds:string[];remainingCalls:number;feedback:string|null};
export interface SpatialModels{
 perceive(row:Observation):Promise<Facts>;
 perceiveWindow?(rows:Observation[],feedback?:string):Promise<Array<{id:string;facts:Facts}>>;
 reason?(input:ReasonInput,images:SpatialJsonImage[]):Promise<SpatialAction>;
}
export type JudgeEvidence={inspected:Set<string>;delivered:Set<string>};
export function validateFacts(value:Facts):Facts{
 if(!value||typeof value.summary!=='string'||!value.summary.trim()||value.summary.length>2400||!Array.isArray(value.details)||!value.details.length||value.details.length>24||value.details.some(s=>typeof s!=='string'||!s.trim()||s.length>1200))throw Error('Invalid independent facts');
 return structuredClone(value);
}
export function validateAssessment(a:Assessment,current:string,inspected:ReadonlySet<string>){
 const l=a?.location;
 if(!l||!['new','known','unknown'].includes(l.status)||typeof l.name!=='string'||l.name.length>240||typeof l.reason!=='string'||!l.reason.trim()||l.reason.length>1600||!Array.isArray(l.sourceIds)||!l.sourceIds.includes(current)||new Set(l.sourceIds).size!==l.sourceIds.length||l.sourceIds.some(id=>!inspected.has(id)))throw Error('Missing location or undelivered spatial evidence');
 if(l.status==='known'?(typeof l.placeId!=='string'||!l.placeId):l.placeId!==null)throw Error('Invalid location identity');
 if(l.status!=='unknown'&&!l.name.trim())throw Error('Known/new location needs a human-readable name');
  if(l.contextRefs!==undefined&&(!Array.isArray(l.contextRefs)||l.contextRefs.length>10||new Set(l.contextRefs).size!==l.contextRefs.length||l.contextRefs.some(r=>typeof r!=='string'||!r)))throw Error('Invalid working context references');
   if(l.boundary!==undefined&&(l.status!=='unknown'||l.placeId!==null||!Array.isArray(l.boundary.regions)||l.boundary.regions.length!==2||l.boundary.regions.some(r=>typeof r!=='string'||!r.trim())||new Set(l.boundary.regions).size!==2))throw Error('Boundary requires two candidate regions and no asserted current place');
   if(l.regionChangeEvidence!==undefined&&(!Array.isArray(l.regionChangeEvidence)||l.regionChangeEvidence.length>4||l.regionChangeEvidence.some(v=>typeof v!=='string'||!v.trim()||v.length>400)))throw Error('Invalid positive region change evidence');
   if(l.continuityCandidate!==undefined&&(l.status!=='unknown'||l.boundary!==undefined||!l.continuityCandidate.placeId||typeof l.continuityCandidate.placeId!=='string'||typeof l.continuityCandidate.referenceId!=='string'||!l.continuityCandidate.referenceId||typeof l.continuityCandidate.reason!=='string'||!l.continuityCandidate.reason.trim()||l.continuityCandidate.reason.length>400))throw Error('Continuity candidate is an explicitly uncertain association, not a known location or boundary');
 for(const list of [a.hypotheses,a.unresolved])if(!Array.isArray(list)||list.length>8||list.some(v=>typeof v!=='string'||!v.trim()||v.length>800))throw Error('Invalid active spatial state');
 if(!Array.isArray(a.relations)||a.relations.length>8)throw Error('Invalid relations');
 for(const r of a.relations)if(!['same-facility','different-region'].includes(r.kind)||r.referenceId===current||!inspected.has(r.referenceId)||typeof r.reason!=='string'||!r.reason.trim()||!Array.isArray(r.sourceIds)||!r.sourceIds.includes(current)||!r.sourceIds.includes(r.referenceId)||r.sourceIds.some(id=>!inspected.has(id)))throw Error('Uninspected relation evidence');
  if(a.revisions!==undefined){
  if(!Array.isArray(a.revisions)||a.revisions.length>3||new Set(a.revisions.map(r=>r.observationId)).size!==a.revisions.length)throw Error('Invalid revision list');
  for(const revision of a.revisions){if(revision.observationId===current||!inspected.has(revision.observationId)||!revision.location.sourceIds.includes(current)||revision.location.status==='new')throw Error('Historical reassignment requires current/target evidence and an existing identity or unknown');validateAssessment({location:revision.location,hypotheses:[],unresolved:[],relations:[]},revision.observationId,inspected);}
  }
  if(a.placeUpdates!==undefined){
   if(!Array.isArray(a.placeUpdates)||a.placeUpdates.length>8||new Set(a.placeUpdates.map(u=>u.key)).size!==a.placeUpdates.length||a.placeUpdates.length>0&&l.status==='unknown')throw Error('Place updates require a confirmed current place and unique keys');
   for(const u of a.placeUpdates)if(typeof u.key!=='string'||!u.key.trim()||u.key.length>120||typeof u.value!=='string'||!u.value.trim()||u.value.length>1200||!['asserted','uncertain','retracted'].includes(u.status)||typeof u.reason!=='string'||!u.reason.trim()||u.reason.length>800||!Array.isArray(u.sourceIds)||!u.sourceIds.length||new Set(u.sourceIds).size!==u.sourceIds.length||u.sourceIds.some(id=>!inspected.has(id))||!u.sourceIds.some(id=>l.sourceIds.includes(id)))throw Error('Invalid or undelivered place profile evidence');
  }
 return structuredClone(a);
}
