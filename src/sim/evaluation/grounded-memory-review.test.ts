import test from 'node:test';
import assert from 'node:assert/strict';
import {chunkVersions,validateGrounded,validateComparison,scoreCaps,applySynthesis,overallScore,type Comparison} from './grounded-memory-review.js';

const verdict=(v:'supported'|'contradicted'|'uncertain'='supported')=>({verdict:v,reason:'evidence'});
const comparison=(version:number,findings:any[]=[]):Comparison=>({windows:[{version,identity:verdict(),currentReason:verdict(findings.some(f=>f.dimension==='currentReason'&&f.verdict==='contradicted')?'contradicted':'supported'),windowScope:verdict(findings.some(f=>f.dimension==='windowScope'&&f.verdict==='contradicted')?'contradicted':'supported')}],findings});

test('grounding requires full version coverage with both window ends',()=>{
 const ok={windows:[{version:3,start:{occupiedRegion:'sidewalk',nearGroundEvidence:'pavement'},end:{occupiedRegion:'crosswalk',nearGroundEvidence:'asphalt stripe'},windowScope:'transition',limitations:'none'}]};
 assert.equal(validateGrounded(ok,[3]).length,1);
 assert.throws(()=>validateGrounded({windows:[]},[3]),/cover exactly/);
 assert.throws(()=>validateGrounded({windows:[{...ok.windows[0]!,end:{occupiedRegion:'',nearGroundEvidence:'x'}}]},[3]),/both ends/);
 assert.throws(()=>validateGrounded({windows:[{...ok.windows[0]!,windowScope:'maybe'}]},[3]),/Invalid grounded/);
});

test('comparison findings must quote the exact candidate and stay within delivered sources',()=>{
 const claims=new Map([[3,{assessment:{location:{reason:'两侧透过栏杆可见站台边缘与列车'}}}]]),delivered=new Set(['o3']);
 const raw={windows:[{version:3,identity:verdict(),currentReason:verdict('contradicted'),windowScope:verdict()}],findings:[{version:3,quote:'可见站台边缘与列车',dimension:'currentReason',verdict:'contradicted',severity:'major',sourceIds:['o3'],reason:'stair images show solid walls'}]};
 assert.equal(validateComparison(raw,[3],claims,delivered).findings.length,1);
 assert.throws(()=>validateComparison({...raw,findings:[{...raw.findings[0],quote:'图中出现列车'}]},[3],claims,delivered),/Unbound/);
 assert.throws(()=>validateComparison({...raw,findings:[{...raw.findings[0],sourceIds:['o9']}]},[3],claims,delivered),/Unbound/);
 assert.throws(()=>validateComparison({...raw,findings:[{...raw.findings[0],dimension:'identity'}]},[3],claims,delivered),/contradicts window verdict/);
});

test('a confirmed per-window contradiction caps the dimension and the model cannot self-award 4',()=>{
 const major=comparison(3,[{version:3,quote:'x',dimension:'currentReason',verdict:'contradicted',severity:'major'},{version:3,quote:'y',dimension:'windowScope',verdict:'contradicted',severity:'minor'}]);
 const caps=scoreCaps([major]);assert.equal(caps.evidence,2);assert.equal(caps.location,3);assert.equal(caps.uncertainty,3);assert.equal(caps.organization,4);
 const raw={dimensions:{location:{score:4,reason:'r'},identity:{score:4,reason:'r'},organization:{score:4,reason:'r'},evidence:{score:4,reason:'r'},uncertainty:{score:4,reason:'r'}},extraFindings:[],summary:'s',limitations:['l'],needsHumanReview:false};
 const result=applySynthesis(raw,[major],[{reason:'x'}]);
 assert.equal(result.dimensions.evidence.score,2);assert.equal(result.dimensions.location.score,3);assert.equal(result.requestedScores.evidence,4);assert.equal(result.adjustments.length,3);assert.equal(overallScore(result.dimensions),80);
 assert.throws(()=>applySynthesis({...raw,extraFindings:[{quote:'not in candidate',dimension:'identity',verdict:'uncertain',severity:'minor',reason:'r'}]},[major],[{reason:'x'}]),/Unbound synthesis/);
});

test('chunking covers every version in order and refuses oversized chunks',()=>{
 assert.deepEqual(chunkVersions([1,2,3,4,5],2),[[1,2],[3,4],[5]]);assert.deepEqual(chunkVersions([1],12),[[1]]);
 assert.throws(()=>chunkVersions([1],13),/Chunk size/);assert.throws(()=>chunkVersions([1],0),/Chunk size/);
});
