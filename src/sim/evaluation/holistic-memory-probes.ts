import type {AuditBundle} from './holistic-memory-bundle.js';
import type {AuditProbe} from './holistic-memory-contract.js';

/** Mechanical risk navigation only; never decides semantic location correctness. No source-ID routing. */
export function auditProbePlan(bundle:AuditBundle):AuditProbe[]{
 const result=new Map<number,AuditProbe>(),states=bundle.states;
 const add=(s:any,reason:string)=>{if(!s)return;const previous=result.get(s.version);result.set(s.version,{version:s.version,sourceIds:[...new Set<string>([s.memberIds[0],s.memberIds.at(-1)])],reason:previous?previous.reason+'; '+reason:reason});};
 const repeated=states.filter((s,i)=>i>0&&typeof s.assessment?.location?.reason==='string'&&s.assessment.location.reason===states[i-1].assessment?.location?.reason);
 add(repeated.at(-1),'Latest repeated current reason; check whether it still describes this window');
 const boundaryConfirmed=states.filter(s=>s.assessment?.location?.status==='known'&&s.memberIds.some((id:string)=>bundle.reference.find(r=>r.id===id)?.annotation?.boundaryUncertain));
 add(boundaryConfirmed[0],'Confirmed whole-window identity overlaps reference boundary uncertainty (early sample)');
 add(boundaryConfirmed.at(-1),'Confirmed whole-window identity overlaps reference boundary uncertainty (late sample)');
 const transitions=states.filter(s=>s.assessment?.location?.boundary);
 add(transitions[Math.floor(transitions.length/2)],'Compare an existing boundary judgment against actual start/end ground');
 const renamed=states.find(s=>s.assessment?.placeRename),stable=states.filter(s=>s.assessment?.location?.status==='known'&&!s.assessment?.location?.boundary);
 add(renamed??stable[Math.floor(stable.length/2)],'Name maintenance or stable-region control; do not assume it is wrong');
 return [...result.values()].sort((a,b)=>a.version-b.version);
}

export function requireHolisticCapacity(windows:number,probes:AuditProbe[],maxTurns:number){
 const minimumTurns=Math.ceil(windows/12)+Math.ceil(new Set(probes.flatMap(p=>p.sourceIds)).size/4)+1;
 if(minimumTurns>maxTurns)throw Error(`Whole-run audit needs at least ${minimumTurns} turns; fixed pilot budget is ${maxTurns}. Implement chunked coverage before paying for a larger run.`);
 return minimumTurns;
}

/** Separate deliberate controls, never edits original states, facts, references or the main judge Session. */
export function spatialCalibrationPlan(bundle:AuditBundle){
 const stair=bundle.reference.find(r=>r.annotation?.description?.includes('出口楼梯')&&!r.annotation.boundaryUncertain);
 const crossing=bundle.states.find(s=>{const refs=s.memberIds.map((id:string)=>bundle.reference.find(r=>r.id===id)?.annotation);return refs[0]?.boundaryUncertain===false&&refs.at(-1)?.boundaryUncertain===true&&new Set(refs.map((r:any)=>r?.placeId)).size>1&&!refs.every((r:any)=>String(r?.placeId).startsWith('subway-'));});
 if(!stair||!crossing)throw Error('Spatial judge calibration requires a clear stair source and a reference-mixed window');
 const rows=[
  {id:'current-stairs-positive',sourceIds:[stair.id],claim:'当前画面主要为楼梯与墙面。',expected:'supported'},
  {id:'stale-platform-negative',sourceIds:[stair.id],claim:'当前三摄清晰可见站台边缘、列车和标有Midtown的蓝色立柱。',expected:'contradicted'},
  {id:'transition-positive',sourceIds:[crossing.memberIds[0],crossing.memberIds.at(-1)],claim:'这个完整窗口处于两个区域之间的过渡，不能仅凭尾图将全窗确认为同一侧。',expected:'supported'},
  {id:'tail-only-negative',sourceIds:[crossing.memberIds[0],crossing.memberIds.at(-1)],claim:'整个窗口的观察者从头到尾都在与最后一张图相同的一侧，没有经过任何区域边界。',expected:'contradicted'}
 ];
 return rows;
}
