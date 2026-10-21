/** Evaluation-only schema. Labels must never be forwarded to a recognizer. */
export interface SpatialEvalLabel {id:string;scene:string;split:'development'|'holdout';kind:'core'|'boundary'|'unknown';region:string|null;reviewer:string;reason:string}
export interface SpatialEvalPrediction {id:string;placeId:string|null;status:'completed'|'failed'|'pending'}
export interface SpatialEvalRevisit {a:string;b:string}
export function spatialAcceptance(labels:SpatialEvalLabel[],predictions:SpatialEvalPrediction[],revisits:SpatialEvalRevisit[]=[]){
 const truth=new Map<string,SpatialEvalLabel>(),pred=new Map<string,SpatialEvalPrediction>();
 for(const l of labels){if(!l.id||truth.has(l.id)||!l.scene||!['development','holdout'].includes(l.split)||!['core','boundary','unknown'].includes(l.kind)||!l.reviewer?.trim()||!l.reason?.trim()||(l.kind==='core'?!l.region?.trim():l.region!==null))throw Error('Invalid or duplicate reviewed label');truth.set(l.id,l);}
 for(const p of predictions){if(!truth.has(p.id)||pred.has(p.id)||!['completed','failed','pending'].includes(p.status)||(p.placeId!==null&&!p.placeId.trim())||(p.status!=='completed'&&p.placeId!==null))throw Error('Invalid prediction or unknown observation');pred.set(p.id,p);}
 const pairSeen=new Set<string>();
 for(const pair of revisits){const a=truth.get(pair.a),b=truth.get(pair.b),key=[pair.a,pair.b].sort().join('\0');if(!a||!b||a.id===b.id||pairSeen.has(key)||a.kind!=='core'||b.kind!=='core'||a.scene!==b.scene||a.region!==b.region||a.split!==b.split)throw Error('Revisit must be a unique reviewed same-region core pair within a scene/split');pairSeen.add(key);}
 const rate=(a:number,b:number)=>b?a/b:null;
 const score=(rows:SpatialEvalLabel[])=>{
  const cores=rows.filter(l=>l.kind==='core'),ids=new Set(rows.map(l=>l.id));let same=0,different=0,sameCorrect=0,differentCorrect=0,falseMerges=0,falseSplits=0;
  const place=(id:string)=>pred.get(id)?.status==='completed'?pred.get(id)!.placeId:null;
  for(let i=0;i<cores.length;i++)for(let j=i+1;j<cores.length;j++){
   const a=cores[i]!,b=cores[j]!;if(a.scene!==b.scene)continue;
   const x=place(a.id),y=place(b.id),known=x!==null&&y!==null;
   if(a.region===b.region){same++;if(known){if(x===y)sameCorrect++;else falseSplits++;}}
   else{different++;if(known){if(x!==y)differentCorrect++;else falseMerges++;}}
  }
  const rs=revisits.filter(r=>ids.has(r.a)&&ids.has(r.b)),revisitCorrect=rs.filter(r=>place(r.a)!==null&&place(r.a)===place(r.b)).length;
  const sameRecovery=rate(sameCorrect,same),differentRecovery=rate(differentCorrect,different);
  const balancedAccuracy=sameRecovery===null||differentRecovery===null?null:(sameRecovery+differentRecovery)/2;
  const coverage=rate(cores.filter(l=>place(l.id)!==null).length,cores.length),executionCompletion=rate(rows.filter(l=>pred.get(l.id)?.status==='completed').length,rows.length);
  return {observations:rows.length,cores:cores.length,boundaries:rows.filter(l=>l.kind==='boundary').length,unreviewable:rows.filter(l=>l.kind==='unknown').length,missing:rows.filter(l=>!pred.has(l.id)).length,failed:rows.filter(l=>pred.get(l.id)?.status==='failed').length,pending:rows.filter(l=>pred.get(l.id)?.status==='pending').length,executionCompletion,coverage,samePairs:same,differentPairs:different,sameRecovery,differentRecovery,balancedAccuracy,falseMerges,falseSplits,falseMergeRate:rate(falseMerges,different),falseSplitRate:rate(falseSplits,same),revisitPairs:rs.length,revisitRecovery:rate(revisitCorrect,rs.length)};
 };
 const scenes=[...new Set(labels.map(l=>l.scene))].map(scene=>({scene,split:labels.find(l=>l.scene===scene)!.split,...score(labels.filter(l=>l.scene===scene))}));
 if(scenes.some(s=>labels.some(l=>l.scene===s.scene&&l.split!==s.split)))throw Error('A scene cannot leak between development and holdout');
 const holdout=scenes.filter(s=>s.split==='holdout');
 const macro=holdout.length&&holdout.every(s=>s.balancedAccuracy!==null)?holdout.reduce((n,s)=>n+s.balancedAccuracy!,0)/holdout.length:null;
 const held=score(labels.filter(l=>l.split==='holdout'));
 const gates={minimumHoldoutScenes:holdout.length>=3,minimumHoldoutCores:held.cores>=60,bothRelationsEveryScene:holdout.length>0&&holdout.every(s=>s.samePairs>=10&&s.differentPairs>=10),macroBalancedAccuracy:macro!==null&&macro>=.9,minimumSceneAccuracy:holdout.length>0&&holdout.every(s=>s.balancedAccuracy!==null&&s.balancedAccuracy>=.85),coverage:held.coverage!==null&&held.coverage>=.95,falseMergeRate:held.falseMergeRate!==null&&held.falseMergeRate<=.03,revisitRecovery:held.revisitPairs>=6&&held.revisitRecovery!==null&&held.revisitRecovery>=.9,executionCompletion:held.executionCompletion===1};
 return {schema:'spatial-acceptance-v1',summary:score(labels),scenes,holdout:{...held,macroBalancedAccuracy:macro},gates,passed:Object.values(gates).every(Boolean),scope:'Development usability proxy, not navigation safety or user acceptance. Boundary/unknown labels excluded from semantic pair metrics; missing/failed core predictions remain in denominators.'};
}
