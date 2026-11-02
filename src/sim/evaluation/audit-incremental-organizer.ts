import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {OrganizedExperienceMemory,type ExperienceFact} from '../../assistant/organized-experience-memory.js';

const [sourceArg,outArg,...extra]=process.argv.slice(2);
if(!sourceArg||!outArg||extra.length)throw Error('Usage: audit-incremental-organizer SOURCE-INDEX NEW-OUTPUT (no model calls)');
const source=resolve(sourceArg),out=resolve(outArg),hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const before=hash(await readFile(source)),reader=new OrganizedExperienceMemory(source,true);
let facts:ExperienceFact[];
try{facts=reader.facts({eventAtMs:Number.MAX_SAFE_INTEGER,knownAtMs:Number.MAX_SAFE_INTEGER});}finally{reader.close();}
if(!facts.length||facts.length>5000)throw Error('Fact bound');
await mkdir(out,{recursive:false});
const path=join(out,'organized.sqlite');let writer=new OrganizedExperienceMemory(path);let sequenceChecks=0;
const available=[...facts].sort((a,b)=>a.availableAtMs-b.availableAtMs||a.atMs-b.atMs),committed:ExperienceFact[]=[],prefixes:any[]=[];
try{
 for(let i=0;i<available.length;i+=16){
  committed.push(...available.slice(i,i+16));committed.sort((a,b)=>a.atMs-b.atMs);
  const result=writer.synchronize(committed);
  const cutoff={eventAtMs:Math.max(...committed.map(f=>f.atMs)),knownAtMs:Math.max(...committed.map(f=>f.availableAtMs))};
  const view=writer.view(cutoff),assigned=view.episodes.flatMap(e=>e.observationIds);
  assert.equal(view.facts.length,committed.length);assert.equal(assigned.length,committed.length);assert.equal(new Set(assigned).size,assigned.length);
  assert.deepEqual(view.facts,committed);assert.equal(view.claims.length,0);
  const knownRefs=new Set(view.facts.map(f=>f.memoryRef));
  for(const episode of view.episodes){
   const sequence=writer.sequence(episode.episodeRef,cutoff);
   assert.equal(sequence.confirmedEntry,false);assert.equal(sequence.confirmedSamePlace,false);
   assert.ok(sequence.candidates.flatMap(c=>c.evidence).every(f=>knownRefs.has(f.memoryRef)&&f.atMs<=cutoff.eventAtMs));
   sequenceChecks++;
  }
  assert.equal(writer.synchronize(committed).revision,result.revision);
  prefixes.push({facts:committed.length,cutoff,revision:result.revision,candidates:view.episodes.length});
  if(prefixes.length%10===0){writer.close();writer=new OrganizedExperienceMemory(path);}
 }
 for(const prefix of prefixes){assert.equal(writer.view(prefix.cutoff).facts.length,prefix.facts);}
}finally{writer.close();}
assert.equal(hash(await readFile(source)),before);
const receipt={schema:'incremental-organizer-reconciliation-audit-v1',facts:facts.length,prefixes:prefixes.length,restarts:Math.floor(prefixes.length/10),
 exactOriginalFactsPreserved:true,completeUniqueMembership:true,idempotentRetries:true,earlierKnowledgePrefixesPreserved:true,sourceIndexUnchanged:true,sequenceChecks,
 sourceSHA256:before,paidCalls:0,scope:'Counterfactual committed-fact availability replay; not measured live producer throughput or semantic correctness',prefixChecks:prefixes};
await writeFile(join(out,'receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify({...receipt,prefixChecks:undefined}));
