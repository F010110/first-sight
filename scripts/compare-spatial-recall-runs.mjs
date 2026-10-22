/** Compare complete artifacts without treating the baseline prediction as truth. */
import {readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';
const [baselinePath,trialPath,output]=process.argv.slice(2);
if(!baselinePath||!trialPath||!output)throw Error('Usage: compare-spatial-recall-runs BASELINE-dir TRIAL-dir NEW-report.json');
const load=async path=>{
 const frozen=JSON.parse(await readFile(join(path,'frozen.json'),'utf8'));
 const raw=await readFile(join(path,'events.jsonl'),'utf8');
 const rows=raw.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line).result);
 const predictions=JSON.parse(await readFile(join(path,'predictions.json'),'utf8'));
 return {path,frozen,rows,predictions,eventsSha256:createHash('sha256').update(raw).digest('hex'),strategy:JSON.parse(await readFile(join(path,'strategy.json'),'utf8')),usage:JSON.parse(await readFile(join(path,'requests/usage.json'),'utf8'))};
};
const [baseline,trial]=await Promise.all([load(baselinePath),load(trialPath)]);
if(baseline.frozen.inputSha256!==trial.frozen.inputSha256)throw Error('Different public inputs');
for(const key of ['groundFirst','comparative','regionScale','shortReferences'])if(baseline.strategy[key]!==trial.strategy[key])throw Error('Non-recall strategy changed: '+key);
const summarize=run=>({run:run.path,eventsSha256:run.eventsSha256,planned:run.predictions.predictions.length,completed:run.rows.length,failed:run.predictions.predictions.filter(p=>p.status==='failed').length,pending:run.predictions.predictions.filter(p=>p.status==='pending').length,unknown:run.rows.filter(r=>r.placeId===null).length,groups:run.rows.at(-1)?.groups.length??0,groupReviews:run.rows.reduce((n,r)=>n+r.reviews.length,0),memberPages:run.rows.reduce((n,r)=>n+r.reviews.reduce((a,v)=>a+v.answers.length,0),0),omittedGroupReviews:run.rows.reduce((n,r)=>n+(r.selection?.omittedGroups??0),0),usage:run.usage});
const maps=[baseline,trial].map(run=>new Map(run.rows.map(r=>[r.id,r])));
const ids=baseline.predictions.predictions.map(p=>p.id);let bothKnown=0,changedPairs=0,unknownAffected=0;
for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
 const relations=maps.map(m=>{const a=m.get(ids[i]),b=m.get(ids[j]);return !a?.placeId||!b?.placeId?'unknown':a.placeId===b.placeId?'same':'different';});
 if(relations.includes('unknown')){unknownAffected++;continue;}
 bothKnown++;if(relations[0]!==relations[1])changedPairs++;
}
const result={schema:'spatial-recall-run-comparison-v1',baseline:summarize(baseline),trial:summarize(trial),bothKnownPairs:bothKnown,changedBothKnownPairs:changedPairs,unknownAffectedPairs:unknownAffected,note:'Prediction agreement only, not accuracy. UUIDs ignored. One unpaired stochastic trial cannot isolate causality. Failure/pending observations retained; no success splicing. No topology added.'};
await writeFile(output,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
