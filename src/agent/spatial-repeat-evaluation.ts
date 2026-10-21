import {spatialAcceptance,type SpatialEvalLabel,type SpatialEvalPrediction,type SpatialEvalRevisit} from './spatial-acceptance.js';
export function evaluateSpatialRepeats(labels:SpatialEvalLabel[],revisits:SpatialEvalRevisit[],runs:Array<{runId:string;predictions:SpatialEvalPrediction[]}>){
 if(runs.length<2||new Set(runs.map(r=>r.runId)).size!==runs.length)throw Error('Require at least two distinct complete run artifacts');
 const reports=runs.map(run=>({runId:run.runId,...spatialAcceptance(labels,run.predictions,revisits)}));
 const range=(values:Array<number|null>)=>values.some(v=>v===null)?{min:null,mean:null,max:null}:{min:Math.min(...values as number[]),mean:(values as number[]).reduce((a,b)=>a+b,0)/values.length,max:Math.max(...values as number[])};
 const cores=labels.filter(l=>l.kind==='core');let eligiblePairs=0,unstablePairs=0;
 const maps=runs.map(r=>new Map(r.predictions.map(p=>[p.id,p])));
 for(let i=0;i<cores.length;i++)for(let j=i+1;j<cores.length;j++){
  const a=cores[i]!,b=cores[j]!;if(a.scene!==b.scene)continue;eligiblePairs++;
  const relations=maps.map(m=>{const x=m.get(a.id),y=m.get(b.id);return !x||!y||x.status!=='completed'||y.status!=='completed'||x.placeId===null||y.placeId===null?'unknown':x.placeId===y.placeId?'same':'different';});
  if(new Set(relations).size>1)unstablePairs++;
 }
 const metrics={balancedAccuracy:range(reports.map(r=>r.summary.balancedAccuracy)),coverage:range(reports.map(r=>r.summary.coverage)),revisitRecovery:range(reports.map(r=>r.summary.revisitRecovery)),executionCompletion:range(reports.map(r=>r.summary.executionCompletion))};
 const pairInstability=eligiblePairs?unstablePairs/eligiblePairs:null;
 const stabilityGates={minimumRuns:runs.length>=3,worstBalancedAccuracy:metrics.balancedAccuracy.min!==null&&metrics.balancedAccuracy.min>=.9,worstCoverage:metrics.coverage.min!==null&&metrics.coverage.min>=.95,worstRevisitRecovery:metrics.revisitRecovery.min!==null&&metrics.revisitRecovery.min>=.9,completeEveryRun:metrics.executionCompletion.min===1,pairStability:pairInstability!==null&&pairInstability<=.05};
 const allAcceptanceGatesPassed=reports.every(r=>r.passed),stabilityPassed=Object.values(stabilityGates).every(Boolean);
 return {schema:'spatial-repeats-v1',runCount:runs.length,allRunsRetained:true,metrics,eligiblePairs,unstablePairs,pairInstability,stabilityGates,stabilityPassed,allAcceptanceGatesPassed,passed:stabilityPassed&&allAcceptanceGatesPassed,reports,warning:'Repeated development cases measure stability, not heldout generalization. Different runtime UUIDs may change prompt tokens; this is not an identical HTTP-payload experiment.'};
}
