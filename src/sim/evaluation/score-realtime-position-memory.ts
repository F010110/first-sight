import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {boundJSON,digest,loadJSON,pipelineArtifacts} from './spatial-evaluation-pipeline.js';

// Audit actual persisted states. Never ask a judge to generate missing identity predictions.
const [standardArg,runArg,outArg]=process.argv.slice(2);
if(!standardArg||!runArg||!outArg)throw Error('Usage: score-realtime-position-memory STANDARD RUN NEW-OUTPUT');
const standard=resolve(standardArg),run=resolve(runArg),out=resolve(outArg);
const frozen=await loadJSON(join(standard,'frozen.json'));
const reference=await boundJSON(join(standard,'evaluation-only/standard.json'),frozen.hashes['evaluation-only/standard.json']);
const {plan,observations}=await pipelineArtifacts(run);
if(plan.inputSHA256!==frozen.inputSHA256||observations.length!==813)throw Error('Frozen source mismatch');
const db=new DatabaseSync(join(run,'three-agent/three-agent.sqlite'),{readOnly:true});
let persisted:any[];
try{persisted=db.prepare("SELECT observation_id,source_at_ms,version,body FROM results WHERE lane='memory' ORDER BY version").all();}finally{db.close();}
const violations:string[]=[],contexts=new Map<string,any>();
for(const [i,o] of observations.entries()){
 const c=o.checkpoint;if(o.status!=='completed'||!c){violations.push(`missing:${o.id}`);continue;}
 const bytes=await readFile(c.contextPath),context=JSON.parse(bytes.toString());contexts.set(o.id,context);
 if(digest(bytes)!==c.contextSHA256||c.index!==i+1||c.memoryRef!==`memory-v${i+1}`)violations.push(`binding:${o.id}`);
 if(context.sourceObservations.some((s:any)=>s.atMs>c.atMs))violations.push(`future:${o.id}`);
 const record=persisted[i],source=context.sourceObservations.find((s:any)=>s.observationId===o.id),body=record?JSON.parse(record.body):null;
 if(!record||record.observation_id!==o.id||record.source_at_ms!==c.atMs||record.version!==c.index||!source||source.summary!==body.summary||JSON.stringify(source.observations)!==JSON.stringify(body.facts.map((f:any)=>f.text)))violations.push(`persisted-source:${o.id}`);
}
// This evaluator supports this producer's empty interpretation plane only. A new
// nonempty prediction schema must be evaluated explicitly, not silently ignored.
const interpretations=[...contexts.values()].flatMap(c=>c.interpretations??[]);
if(interpretations.length||persisted.some(r=>JSON.parse(r.body).hypotheses?.length))throw Error('Nonempty interpretation plane requires an explicit relation prediction adapter');
const cases=reference.cases.map((r:any)=>({...r,prediction:null,status:'not-established',correct:false,reason:'Persisted fact-first state has no explicit region-equivalence or facility-hierarchy judgment. Similar wording is not an identity prediction.'}));
const groups=Object.fromEntries(['positive','negative','hierarchy'].map(kind=>{const rows=cases.filter((c:any)=>c.kind===kind);return [kind,{planned:rows.length,judged:0,correct:0,unknown:rows.length,establishedRelationRecall:rows.length?0:null,conditionalAccuracy:null}];}));
await mkdir(out,{recursive:false});
await writeFile(join(out,'cases.jsonl'),cases.map((c:any)=>JSON.stringify(c)).join('\n')+'\n',{flag:'wx'});
const report={schema:'realtime-position-memory-audit-v1',inputSHA256:plan.inputSHA256,referenceSHA256:frozen.hashes['evaluation-only/standard.json'],predictionsSHA256:digest(await readFile(join(run,'observations.jsonl'))),processing:await loadJSON(join(run,'inference-complete.json')),integrity:{planned:813,contexts:contexts.size,persistedMemoryResults:persisted.length,passed:violations.length===0,violations},spatialRelations:{planned:cases.length,explicitJudgments:0,correct:0,notEstablished:cases.length,establishedRelationRecall:0,conditionalAccuracy:null,groups},longTermRetrieval:{status:'not-tested',reason:'No retrieval operation was performed during this observation-only replay. Durable source retention is not retrieval success.'},localization:{status:'not-scored',reason:'No predicted region identity; descriptive nouns are not a localization output.'},visualDetails:{status:'out-of-scope',reason:'Position labels do not certify all visible details; retired detail standard is not used.'},apiCalls:0,conclusion:'Observation source retention is complete only if integrity passes. Explicit spatial relations are not established; spatial-memory quality gate is not passed. No user-question evaluation authorized.',authority:'Deterministic comparison with frozen reviewed positions, not a model-generated replacement standard'};
await writeFile(join(out,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report));
