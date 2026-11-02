import {readFile,mkdir,writeFile,statfs} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {OrganizedExperienceMemory,proposeExperienceBoundaries,type ExperienceFact} from '../../assistant/organized-experience-memory.js';

const [sourceArg,outArg,...flags]=process.argv.slice(2);
if(!sourceArg||!outArg||flags.length)throw Error('Usage: build-organized-experience-index SOURCE-THREE-AGENT-SQLITE NEW-OUTPUT (no model calls)');
const source=resolve(sourceArg),out=resolve(outArg),sha=(raw:Buffer)=>createHash('sha256').update(raw).digest('hex');
const before=sha(await readFile(source)),space=await statfs(dirname(out));if(space.bavail*space.bsize<20_000_000_000)throw Error('20GB reserve required');
const original=new DatabaseSync(source,{readOnly:true});original.exec('PRAGMA query_only=ON');
let rows:Array<{observation_id:string;source_at_ms:number;available_at_ms:number;version:number;body:string;observation_body:string}>;
try{rows=original.prepare("SELECT r.observation_id,r.source_at_ms,r.available_at_ms,r.version,r.body,o.body AS observation_body FROM results r JOIN observations o ON o.id=r.observation_id WHERE r.lane='memory' ORDER BY r.source_at_ms").all() as typeof rows;}finally{original.close();}
if(!rows.length||rows.length>5000)throw Error('Bounded build requires 1-5000 committed observations');
await mkdir(out,{recursive:false});
const indexPath=join(out,'organized.sqlite'),memory=new OrganizedExperienceMemory(indexPath),facts:ExperienceFact[]=[];
try{
 for(const row of rows){
  const observation=JSON.parse(row.observation_body),result=JSON.parse(row.body);
  const views=await Promise.all((observation.frames as string[]).map(async(path,i)=>{
   const raw=await readFile(path);return {direction:['front','left','right'][i]??`view-${i}`,path,sha256:sha(raw)};
  }));
  const fact:ExperienceFact={memoryRef:`memory-v${row.version}`,observationId:row.observation_id,atMs:row.source_at_ms,
   sourceAtMs:observation.sourceAtMs??row.source_at_ms,availableAtMs:row.available_at_ms,recordingId:observation.recordingId??'source-recording',
   text:result.summary,views,rawResultJSON:row.body};
  memory.append(fact);facts.push(fact);
 }
 const proposals=proposeExperienceBoundaries(facts),boundaries=[];
 for(const proposal of proposals){
  boundaries.push(proposal.boundary);
  memory.revise({knownAtMs:proposal.knownAtMs,evidenceUntilMs:proposal.evidenceUntilMs,boundaries:[...boundaries],claims:[],reason:'Counterfactual online prefix: sustained text-change candidate, not GT visit identity'});
 }
 const cutoff={eventAtMs:facts.at(-1)!.atMs,knownAtMs:Math.max(...facts.map(f=>f.availableAtMs))};
 memory.revise({...{knownAtMs:cutoff.knownAtMs,evidenceUntilMs:cutoff.eventAtMs},boundaries,claims:[],reason:'Completed source-fact projection; no enter-shop or same-place claims invented'});
 const view=memory.view(cutoff);
 const publicEpisodes=view.episodes.map(e=>({...e,representatives:e.representativeRefs.map(ref=>{
  const f=facts.find(f=>f.memoryRef===ref)!;return {memoryRef:ref,atMs:f.atMs,text:f.text};
 })}));
 await writeFile(join(out,'episodes.json'),JSON.stringify({revision:view.revision,episodes:publicEpisodes,claims:view.claims},null,2),{flag:'wx'});
 const probes=[{text:'最开始等车的座位',order:'earliest' as const},{text:'店铺柜台',order:'earliest' as const},{text:'洗衣店设备',order:'relevance' as const}];
 await writeFile(join(out,'retrieval-probes.json'),JSON.stringify(probes.map(query=>({query,result:memory.locate(query,cutoff)})),null,2),{flag:'wx'});
 await writeFile(join(out,'build-receipt.json'),JSON.stringify({schema:'organized-experience-build-v1',source,sourceSHA256:before,facts:facts.length,
  episodeCandidates:view.episodes.length,descriptionChangeProposals:proposals.length,derivedClaims:0,paidCalls:0,readsAnnotations:false,readsQuestions:false,readsMap:false,
  cutoff,organizationAvailability:'Counterfactual prefix replay: derived revision availability is max original availability of facts used; not a claim this index existed during old run',
  limitations:['Candidate text-coherence episodes are not verified physical visits','Facet lexicon and lexical matching are not a validated embedding retriever','No entry order or same-instance events automatically certified','Runtime reader supports frozen index; continuous organizer synchronization still needs integration']},null,2),{flag:'wx'});
}finally{memory.close();}
const after=sha(await readFile(source));if(before!==after)throw Error('Source database unexpectedly changed');
await writeFile(join(out,'integrity.json'),JSON.stringify({sourceUnchanged:true,sourceSHA256:before,indexSHA256:sha(await readFile(indexPath))},null,2),{flag:'wx'});
console.log(JSON.stringify({out,facts:facts.length,sourceUnchanged:true,paidCalls:0}));
