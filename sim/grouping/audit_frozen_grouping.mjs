/** Exact prefix comparison with committed test.5 code; zero VLM calls. */
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import assert from 'node:assert/strict';
import {proposeCoherentContextChanges} from '../dist/current/agent/coherent-context-changes.js';
const original=execFileSync('git',['show','03b03eb:src/agent/coherent-context-changes.ts'],{encoding:'utf8'});
const old=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(original)).toString('base64'));
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const result={reference:'03b03eb (test.5)',policy:'legacy-first-pair',vlmCalls:0,cases:[],limitations:'Exact deterministic grouping regression only; does not guarantee model responses or unlabelled/boundary correctness.'};
for(const [name,source,baseline] of [
  ['val4','run/anchor-recovery-v1/home-val4/online/integrated-memory.json','run/anchor-recovery-v1/home-val4/online/replay.json'],
  ['val5','run/hssd-adapter-val5-smoke-v1/integrated-memory.json','run/hssd-adapter-val5-smoke-v1/integrated-memory.json'],
]) {
  const memory=read(source);
  for(const input of memory.interpretations){
    assert.deepEqual(proposeCoherentContextChanges(input.observations,input.links,4000),old.proposeCoherentContextChanges(input.observations,input.links,4000));
  }
  const replay=read(`run/frozen-grouping-confirmation/${name}/replay.json`);
  assert.equal(replay.restartRoundtripPassed,true);
  const actual=replay.grouping.groups.map(g=>g.observationIds);
  const b=read(baseline);const expected=(b.grouping??b.groupingRevisions.at(-1)).groups.map(g=>g.observationIds);
  assert.deepEqual(actual,expected);
  result.cases.push({name,prefixesCompared:memory.interpretations.length,groups:actual.length,exactOriginalContextResults:true,exactGroupMembershipPreserved:true});
}
writeFileSync('run/frozen-grouping-audit.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
