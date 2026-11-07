import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {AuditBundle} from './holistic-memory-bundle.js';

/** Per-window judge verdicts (comparison-*.json). No new model calls are made here. */
export type Verdict='supported'|'uncertain'|'contradicted';
export type WindowVerdict={version:number;identity:{verdict:Verdict};currentReason:{verdict:Verdict};windowScope:{verdict:Verdict}};
export type VerdictCounts={supported:number;uncertain:number;contradicted:number};

export type GroupWindow={version:number;identity:Verdict;currentReason:Verdict;windowScope:Verdict;share:number;members:number;placeId:string|null;placeName:string|null;segments:string[]};
export type GroupRow={
 segmentId:string;placeId:string;title:string;kind:string;
 startIndex:number;endIndex:number;startMs:number|null;endMs:number|null;
 planned:number;judged:number;skipped:number;covered:number;uncovered:number;
 windows:GroupWindow[];crossWindows:Array<{version:number;members:number;identity:Verdict}>;
 identity:VerdictCounts;evidence:VerdictCounts;scope:VerdictCounts;
 identityScore:number|null;evidenceScore:number|null;
 agentPlaces:Array<{placeId:string;name:string;windows:number}>;
 split:boolean;merged:boolean;mergedWith:string[];contradictedVersions:number[];uncertainVersions:number[];
};
export type MergeEvent={placeId:string;name:string;windows:number;segments:string[];referencePlaces:string[]};
export type SplitEvent={segmentId:string;referencePlace:string;agentPlaces:string[]};
export type RevisitEvent={referencePlace:string;runs:Array<{segmentId:string;firstIndex:number;lastIndex:number;agentPlaces:string[]}>;verdict:'reused'|'different'|'unscored'};
export type TransitionEvent={fromPlace:string;toPlace:string;boundaryIndex:number;boundaryMs:number;agentChangeIndex:number|null;lagMs:number|null;withinOneWindow:boolean;insideWindow:boolean};
/** One reference place visit is one group: human place labels plus temporal continuity. */
export type GroupedReport={
 schema:'grouped-memory-report-v1';
 run:string;reference:{authority:unknown;limitations:unknown};
 coverage:{plannedStates:number;judgedStates:number;skippedStates:number;plannedObservations:number;judgedObservations:number;skippedObservations:number;fullCoverage:boolean;coverageScope:'full'|'partial-explicit-gaps'};
 summary:{groups:number;scoredGroups:number;meanGroupScore:number|null;medianGroupScore:number|null;distribution:Record<string,number>;windowIdentity:VerdictCounts;windowEvidence:VerdictCounts;windowScope:VerdictCounts};
 groups:GroupRow[];merges:MergeEvent[];splits:SplitEvent[];revisits:RevisitEvent[];transitions:{boundaries:number;matchedWithinOneWindow:number;insideWindow:number;events:TransitionEvent[]};
 note:string;
};

const counts=(values:Verdict[]):VerdictCounts=>({supported:values.filter(v=>v==='supported').length,uncertain:values.filter(v=>v==='uncertain').length,contradicted:values.filter(v=>v==='contradicted').length});
const score=(c:VerdictCounts):number|null=>{const n=c.supported+c.uncertain+c.contradicted;return n?Math.round(100*(c.supported+.5*c.uncertain)/n):null;};
const median=(values:number[])=>{if(!values.length)return null;const s=[...values].sort((a,b)=>a-b),m=s.length>>1;return s.length%2?s[m]!:(s[m-1]!+s[m]!)/2;};
const unique=<T,>(values:T[])=>[...new Set(values)];
const time=(ms:number)=>{const s=Math.floor(ms/1000);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};

export function groupedMemoryReport(bundle:AuditBundle,sample:any,verdicts:WindowVerdict[]):GroupedReport{
 const annotations=new Map<string,any>((bundle.reference as any[]).map(r=>[r.id,r.annotation]));
 const meta=new Map<string,any>((sample?.segments??bundle.segments??[]).map((s:any)=>[s.id,s]));
 const planned=bundle.observations.map(o=>o.id),plannedIndex=new Map(planned.map((id,i)=>[id,i]));
 if(verdicts.length!==bundle.states.length||new Set(verdicts.map(v=>v.version)).size!==verdicts.length)throw Error('Need one judge verdict per judged window');
 const verdictByVersion=new Map(verdicts.map(v=>[v.version,v]));
 for(const s of bundle.states)if(!verdictByVersion.has(s.version))throw Error('Missing judge verdict for window '+s.version);
 const windowOf=new Map<string,number>();
 for(const s of bundle.states)for(const id of s.memberIds??[])windowOf.set(id,s.version);
 const skipped=new Set(planned.filter(id=>!windowOf.has(id)));
 const segmentOf=new Map<string,string>();
 for(const id of planned){const seg=annotations.get(id)?.segmentId;if(typeof seg!=='string')throw Error('Missing reference segment for '+id);segmentOf.set(id,seg);}
 const plannedSegments=new Set(planned.map(id=>segmentOf.get(id)!));
 if([...plannedSegments].some(id=>!meta.has(id)))throw Error('Reference sample is missing a planned segment');

 // One window belongs to the segment holding most of its members; a 50/50 window goes to
 // the segment at the window end, because the claim states where the observer now is.
 const assignment=new Map<number,{segmentId:string;share:number;segments:string[]}>();
 for(const s of bundle.states){
  const ids=s.memberIds as string[],tally=new Map<string,number>();
  for(const id of ids){const seg=segmentOf.get(id);if(seg)tally.set(seg,(tally.get(seg)??0)+1);}
  if(!tally.size)throw Error('Window has no reference members: '+s.version);
  const sorted=[...tally.entries()].sort((a,b)=>b[1]-a[1]);
  let chosen=sorted[0]![0];
  if(sorted.length>1&&sorted[1]![1]===sorted[0]![1])chosen=segmentOf.get(ids[ids.length-1]!)!;
  assignment.set(s.version,{segmentId:chosen,share:(tally.get(chosen)??0)/ids.length,segments:sorted.map(e=>e[0])});
 }

 const groups:GroupRow[]=[];
 for(const [segmentId,segment] of meta){
  if(!plannedSegments.has(segmentId))continue;
  const observations=planned.filter(id=>segmentOf.get(id)===segmentId);
  const windows=bundle.states.filter(s=>assignment.get(s.version)!.segmentId===segmentId).map(s=>{
   const v=verdictByVersion.get(s.version)!;const loc=s.assessment?.location??{};
   return {version:s.version,identity:v.identity.verdict,currentReason:v.currentReason.verdict,windowScope:v.windowScope.verdict,
    share:assignment.get(s.version)!.share,members:s.memberIds.filter((id:string)=>segmentOf.get(id)===segmentId).length,placeId:loc.placeId??null,placeName:loc.name??null,segments:assignment.get(s.version)!.segments};
  });
  const places=new Map<string,{placeId:string;name:string;windows:number}>();
  for(const w of windows){if(!w.placeId)continue;const e=places.get(w.placeId)??{placeId:w.placeId,name:w.placeName??w.placeId,windows:0};e.windows++;places.set(w.placeId,e);}
  const identity=counts(windows.map(w=>w.identity)),evidence=counts(windows.map(w=>w.currentReason)),scope=counts(windows.map(w=>w.windowScope));
  const covered=windows.reduce((n,w)=>n+w.members,0);
  const crossWindows=bundle.states.filter(s=>assignment.get(s.version)!.segmentId!==segmentId&&s.memberIds.some((id:string)=>segmentOf.get(id)===segmentId)).map(s=>({version:s.version,members:s.memberIds.filter((id:string)=>segmentOf.get(id)===segmentId).length,identity:verdictByVersion.get(s.version)!.identity.verdict}));
  groups.push({segmentId,placeId:segment.placeId,title:segment.title??segment.placeId,kind:segment.kind??'',
   startIndex:segment.startIndex,endIndex:segment.endIndex,startMs:segment.startMs??null,endMs:segment.endMs??null,
   planned:observations.length,judged:observations.filter(id=>!skipped.has(id)).length,skipped:observations.filter(id=>skipped.has(id)).length,covered:covered,uncovered:observations.filter(id=>!skipped.has(id)).length-covered,
   windows,crossWindows,identity,evidence,scope,identityScore:score(identity),evidenceScore:score(evidence),
   agentPlaces:[...places.values()].sort((a,b)=>b.windows-a.windows),split:places.size>1,merged:false,mergedWith:[],
   contradictedVersions:windows.filter(w=>w.identity==='contradicted').map(w=>w.version),
   uncertainVersions:windows.filter(w=>w.identity==='uncertain').map(w=>w.version)});
 }
 groups.sort((a,b)=>a.startIndex-b.startIndex);
 const scored=groups.filter(g=>g.identityScore!==null);

 // A candidate place spanning several reference places is a merge; spanning the same
 // reference place at a different time is a revisit and is scored separately.
 const placesById=new Map<string,{placeId:string;name:string;windows:number;segments:Set<string>;places:Set<string>}>();
 for(const s of bundle.states){
  const loc=s.assessment?.location??{};if(!loc.placeId)continue;
  const group=assignment.get(s.version)!;const referencePlace=meta.get(group.segmentId)?.placeId??group.segmentId;
  const e=placesById.get(loc.placeId)??{placeId:loc.placeId,name:loc.name??loc.placeId,windows:0,segments:new Set<string>(),places:new Set<string>()};
  e.windows++;e.segments.add(group.segmentId);e.places.add(referencePlace);placesById.set(loc.placeId,e);
 }
 const merges:MergeEvent[]=[...placesById.values()].filter(p=>p.places.size>1).map(p=>({placeId:p.placeId,name:p.name,windows:p.windows,segments:[...p.segments],referencePlaces:[...p.places]})).sort((a,b)=>b.windows-a.windows);
 const splits:SplitEvent[]=groups.filter(g=>g.split).map(g=>({segmentId:g.segmentId,referencePlace:g.placeId,agentPlaces:g.agentPlaces.map(p=>p.name)}));
 // Mark the group whose dominant agent place is also used for other reference places.
 for(const group of groups){const dominant=group.agentPlaces[0];const merge=dominant&&merges.find(m=>m.placeId===dominant.placeId);if(merge){group.merged=true;group.mergedWith=merge.referencePlaces;}}

 // Reference revisits are repeated (non-adjacent) runs of the same place label.
 const runsByPlace=new Map<string,Array<{segmentId:string;firstIndex:number;lastIndex:number}>>();
 for(const id of planned){const a=annotations.get(id);if(!a)continue;const runs=runsByPlace.get(a.placeId)??[];const last=runs[runs.length-1];
  if(last&&last.segmentId===a.segmentId){last.lastIndex=plannedIndex.get(id)!;}else runs.push({segmentId:a.segmentId,firstIndex:plannedIndex.get(id)!,lastIndex:plannedIndex.get(id)!});runsByPlace.set(a.placeId,runs);}
 const revisits:RevisitEvent[]=[];
 for(const [referencePlace,runs] of runsByPlace){
  if(runs.length<2)continue;
  const detail=runs.map(run=>{
   const row=groups.find(g=>g.segmentId===run.segmentId);
   const names=(row?.agentPlaces??[]).map(p=>p.name);
   return {...run,agentPlaces:names};
  });
  const dominant=detail.map(d=>d.agentPlaces[0]??null);
  const verdict=dominant.some(d=>d===null)?'unscored':(dominant.every(d=>d===dominant[0])?'reused':'different');
  revisits.push({referencePlace,runs:detail,verdict});
 }

 const windowStarts=new Set(bundle.states.map(s=>plannedIndex.get(s.memberIds[0])!).filter(v=>v!==undefined));
 const changes:number[]=[];
 for(let v=1;v<bundle.states.length;v++){
  const before=bundle.states[v-1].assessment?.location?.placeId??null;
  const after=bundle.states[v].assessment?.location?.placeId??null;
  if(before===null||after===null||before===after)continue;
  changes.push(plannedIndex.get(bundle.states[v].memberIds[0])!);
 }
 const transitionsList:TransitionEvent[]=[];
 for(let i=1;i<groups.length;i++){
  const previous=groups[i-1]!,current=groups[i]!;
  const boundaryIndex=planned.findIndex(id=>segmentOf.get(id)===current.segmentId);
  if(boundaryIndex<0)continue;
  let nearest:number|null=null;
  for(const at of changes)if(nearest===null||Math.abs(at-boundaryIndex)<Math.abs(nearest-boundaryIndex))nearest=at;
  transitionsList.push({fromPlace:previous.placeId,toPlace:current.placeId,boundaryIndex,boundaryMs:bundle.observations[boundaryIndex]?.atMs??boundaryIndex*2000,
   agentChangeIndex:nearest,lagMs:nearest===null?null:(nearest-boundaryIndex)*2000,withinOneWindow:nearest!==null&&Math.abs(nearest-boundaryIndex)<=8,insideWindow:!windowStarts.has(boundaryIndex)});
 }
 const allIdentity=counts(groups.flatMap(g=>g.windows.map(w=>w.identity)));
 const allEvidence=counts(groups.flatMap(g=>g.windows.map(w=>w.currentReason)));
 const allScope=counts(groups.flatMap(g=>g.windows.map(w=>w.windowScope)));
 const scores=scored.map(g=>g.identityScore!);
 const distribution:{[k:string]:number}={};
 const bucket=(v:number)=>v===100?'100':v>=75?'75-99':v>=50?'50-74':v>0?'1-49':'0';
 for(const v of scores)distribution[bucket(v)]=(distribution[bucket(v)]??0)+1;
 const coverage=bundle.scope?.coverage??{};
 const judgedObservations=planned.length-skipped.size;
 return {schema:'grouped-memory-report-v1',run:bundle.run,
  reference:{authority:bundle.scope?.referenceAuthority,limitations:bundle.scope?.referenceLimitations},
  coverage:{plannedStates:bundle.states.length+Number(coverage.skippedWindows??0),judgedStates:bundle.states.length,skippedStates:Number(coverage.skippedWindows??0),
   plannedObservations:planned.length,judgedObservations,skippedObservations:skipped.size,fullCoverage:Boolean(coverage.fullCoverage),
   coverageScope:coverage.fullCoverage?'full':'partial-explicit-gaps'},
  summary:{groups:groups.length,scoredGroups:scored.length,meanGroupScore:scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length*10)/10:null,
   medianGroupScore:median(scores),distribution,windowIdentity:allIdentity,windowEvidence:allEvidence,windowScope:allScope},
  groups,merges,splits,revisits,
  transitions:{boundaries:transitionsList.length,matchedWithinOneWindow:transitionsList.filter(t=>t.withinOneWindow).length,
   insideWindow:transitionsList.filter(t=>t.insideWindow).length,events:transitionsList},
  note:'Group score = per-window judge identity verdicts (supported 1, uncertain 0.5, contradicted 0), aggregated over the human-confirmed place visit. It is not the 0-4 holistic score: the holistic gate caps a dimension after any confirmed contradiction, while a group score is the accuracy share inside one visit. Merge/split granularity is reported, not scored. Skipped windows are coverage gaps, not zero scores.'};
}

export async function readWindowVerdicts(dir:string):Promise<WindowVerdict[]>{
 const files=(await readdir(dir)).filter(name=>/^comparison-\d+\.json$/.test(name)).sort();
 if(!files.length)throw Error('No comparison-*.json in '+dir);
 const byVersion=new Map<number,WindowVerdict>();
 for(const file of files){const raw=JSON.parse((await readFile(join(dir,file))).toString());
  if(!Array.isArray(raw?.windows))throw Error('Invalid comparison file '+file);
  for(const w of raw.windows){
   if(!Number.isInteger(w?.version)||!['supported','uncertain','contradicted'].includes(w?.identity?.verdict)||!['supported','uncertain','contradicted'].includes(w?.currentReason?.verdict)||!['supported','uncertain','contradicted'].includes(w?.windowScope?.verdict))throw Error('Invalid window verdict in '+file);
   if(byVersion.has(w.version))throw Error('Duplicate verdict for window '+w.version);
   byVersion.set(w.version,{version:w.version,identity:{verdict:w.identity.verdict},currentReason:{verdict:w.currentReason.verdict},windowScope:{verdict:w.windowScope.verdict}});
  }
 }
 return [...byVersion.values()].sort((a,b)=>a.version-b.version);
}

export function renderGroupedMarkdown(report:GroupedReport){
 const pct=(n:number,d:number)=>d?`${(100*n/d).toFixed(1)}%`:'n/a';
 const lines:string[]=[
  '# 分组空间记忆报告（grouped v1）',
  '',
  `- 运行：\`${report.run}\``,
  `- 分组依据：人工确认参考的地点标签＋时间连续段（一个地点访问＝一组）`,
  `- 覆盖：${report.coverage.judgedStates}/${report.coverage.plannedStates} 个判断窗，${report.coverage.judgedObservations}/${report.coverage.plannedObservations} 个观察（${report.coverage.skippedStates} 跳过窗/${report.coverage.skippedObservations} 观察），scope=\`${report.coverage.coverageScope}\``,
  `- 分组均分（等权）：**${report.summary.meanGroupScore ?? 'n/a'}**，中位数 **${report.summary.medianGroupScore ?? 'n/a'}**（${report.summary.scoredGroups}/${report.summary.groups} 组有判断窗）`,
  `- 窗口级 identity：${report.summary.windowIdentity.supported} supported / ${report.summary.windowIdentity.uncertain} uncertain / ${report.summary.windowIdentity.contradicted} contradicted（${pct(report.summary.windowIdentity.supported,report.summary.windowIdentity.supported+report.summary.windowIdentity.uncertain+report.summary.windowIdentity.contradicted)} supported）`,
  `- 窗口级 evidence：${report.summary.windowEvidence.supported} / ${report.summary.windowEvidence.uncertain} / ${report.summary.windowEvidence.contradicted}`,
  '',
  '## 分数分布（按组，等权）',
  '',
  ...['100','75-99','50-74','1-49','0'].filter(k=>report.summary.distribution[k]!==undefined).map(k=>`- ${k}：${report.summary.distribution[k]} 组`),
  '',
  '## 每组',
  '',
  '| 组 | 参考地点 | 时间 | 窗 | identity | evidence | 候选地点 | 问题窗 | 结构 |',
  '|---|---|---|---|---|---|---|---|---|',
  ...report.groups.map(g=>`| ${g.segmentId} | ${g.placeId} | ${g.startMs!==null?time(g.startMs):g.startIndex*2000}–${g.endMs!==null?time(g.endMs):g.endIndex*2000} | ${g.windows.length}窗（覆盖${g.covered}/${g.judged}obs）${g.skipped?`，${g.skipped}obs skipped`:''} | ${g.identityScore===null?'—':g.identityScore} | ${g.evidenceScore===null?'—':g.evidenceScore} | ${g.agentPlaces.map(p=>`${p.name}×${p.windows}`).join(' / ')||'—'} | ${[...g.contradictedVersions.map(v=>`v${v}✗`),...g.uncertainVersions.map(v=>`v${v}?`)].join(' ')||'—'}${g.crossWindows.filter(w=>w.identity==='contradicted').map(w=>` ↗v${w.version}✗`).join('')} | ${g.merged?`merge:${g.mergedWith.join(',')}`:''}${g.split?' split':''} |`),
  '',
  '## 合并（一个候选地点覆盖多个参考地点）',
  '',
  ...(report.merges.length?report.merges.map(m=>`- **${m.name}**（${m.windows} 窗）→ ${m.referencePlaces.join(', ')}（${m.segments.length} 段）`):['- 无']),
  '',
  '## 拆分（一个参考地点内出现多个候选地点）',
  '',
  ...(report.splits.length?report.splits.map(s=>`- ${s.segmentId} ${s.referencePlace}：${s.agentPlaces.join(' / ')}`):['- 无']),
  '',
  '## 重访复用',
  '',
  ...(report.revisits.length?report.revisits.map(r=>`- ${r.referencePlace}：${r.verdict}（${r.runs.map(x=>`${x.segmentId}@${time(x.firstIndex*2000)}→${x.agentPlaces.join('|')||'—'}`).join('，')}）`):['- 无重复参考地点']),
  '',
  '## 边界时刻',
  '',
  `- 参考边界 ${report.transitions.boundaries} 个，其中 ${report.transitions.insideWindow} 个落在窗内（窗口粒度下只能显式 boundary 或跨窗变化），${report.transitions.matchedWithinOneWindow} 个在一窗内出现候选地点变化`,
  '',
  '| 边界 | 时间 | 参考变化 | 候选最近变化 | 滞后 |',
  '|---|---|---|---|---|',
  ...report.transitions.events.map(t=>`| ${t.boundaryIndex} | ${time(t.boundaryMs)} | ${t.fromPlace} → ${t.toPlace} | ${t.agentChangeIndex===null?'—':t.agentChangeIndex}${t.insideWindow?'（窗内）':''} | ${t.lagMs===null?'—':`${(t.lagMs/1000).toFixed(0)}s`} |`),
  '',
  `> ${report.note}`,
  ''
 ];
 return lines.join('\n');
}

