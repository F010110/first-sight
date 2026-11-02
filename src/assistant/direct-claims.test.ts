import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeDirectClaims} from './direct-claims.js';
import {aliasedSpatialRequest} from '../agent/spatial-reference-aliases.js';

test('direct claims preserve every text and its explicit citation without asking the model for duplicate fields',()=>{
 const value={claims:[{sourceIds:['a'],text:'door visible'},{sourceIds:['a'],text:'handle visible'},{sourceIds:['b'],text:'street visible'}]};
 const rows=decodeDirectClaims(value,['a','b']);
 assert.deepEqual(rows[0]!.result!.facts.map(f=>f.sourceIds),[['a'],['a']]);
 assert.equal(rows[0]!.result!.summary,'door visible；handle visible');assert.equal(rows[1]!.result!.summary,'street visible');
});
test('direct claims do not infer missing citations, promote strings, or hide omitted observations',()=>{
 for(const claims of [['scene'],[{text:'scene'}],[{text:'scene',sourceIds:['x']}],[{text:'scene',sourceIds:['a','b']}],[{text:'scene',sourceIds:['a'],memoryRefs:['memory-v1']}]] )assert.throws(()=>decodeDirectClaims({claims},['a','b']));
 const rows=decodeDirectClaims({claims:[{text:'scene',sourceIds:['a']}]},['a','b']);
 assert.ok(rows[0]!.result);assert.match(rows[1]!.error!,/No explicitly cited/);
});
test('direct claims work through request-local aliasing, unknown aliases fail before projection',async()=>{
 const input={phase:'identity' as const,prompt:'JSON',data:{current:{id:'observation-a'}},images:[{id:'observation-a',path:'unused',sha256:'unused',direction:'front'}]};
 const request=aliasedSpatialRequest(async i=>({claims:[{text:'visible',sourceIds:[i.images[0]!.id]}]}));
 assert.equal(decodeDirectClaims(await request(input),['observation-a'])[0]!.result!.facts[0]!.sourceIds[0],'observation-a');
 await assert.rejects(aliasedSpatialRequest(async()=>({claims:[{text:'scene',sourceIds:['S99']}]}))(input),/Unknown model reference/);
});
