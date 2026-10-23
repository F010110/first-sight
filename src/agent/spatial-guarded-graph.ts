import type {SpatialVisitTopology} from './spatial-visit-topology.js';
/** Experimental precision gate; keep visits, omit unsupported graph hints. */
export function guardedGraphContext(context:ReturnType<SpatialVisitTopology['context']>){
 const value=structuredClone(context);
 for(const place of value.places)place.relations=place.relations.filter(r=>r.kind==='observed-consecutive-transition'&&r.count>=2);
 value.interpretation+=' 本实验只交付同方向至少两次转移观测的边，不交付时间相近边。重复仍不证明空间边界、同地或可通行。先根据CURRENT与全部候选原图判断所在区域；图仅是辅助历史，不得用图生成新scope、分割同一开放区域或否决原图实例证据。没有边时完全按访问序列与原图判断。';
 return value;
}
