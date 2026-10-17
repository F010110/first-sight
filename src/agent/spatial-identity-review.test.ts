import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewedIdentityRecognizer} from './spatial-identity-review.js';
import type {WindowRecognizer,TopologyState} from './spatial-topology-service.js';
test('new identity review can reuse old/null; no retries, invented IDs or silent fallback',async()=>{
 const batch=[{id:'o',atMs:10,frames:['image']}];const history:TopologyState={version:1,nodes:[{id:'old',summary:'same description',lastSeenMs:0,representatives:[]}],observations:[],pending:[],assignments:[],edges:[],currentPlaceId:'old',revisions:[]};
 const proposal={places:[{id:'new-1',summary:'same description'}],assignments:[{observationId:'o',placeId:'new-1',reason:'proposal'}]};
 let initialCalls=0,reviewCalls=0,audits=0;
 const initial:WindowRecognizer=async()=>{initialCalls++;return structuredClone(proposal);};
 const recognized=reviewedIdentityRecognizer(initial,async(b,h,p)=>{reviewCalls++;assert.deepEqual(b,batch);assert.equal(h.nodes.length,1);assert.deepEqual(p,proposal);return {places:[],assignments:[{observationId:'o',placeId:'old',reason:'original image evidence'}]};},async()=>{audits++;});
 assert.equal((await recognized(batch,history)).assignments[0]!.placeId,'old');assert.equal(initialCalls,1);assert.equal(reviewCalls,1);assert.equal(audits,1);assert.equal(proposal.assignments[0]!.placeId,'new-1');
 const invalid=reviewedIdentityRecognizer(initial,async()=>({places:[],assignments:[{observationId:'o',placeId:'invented',reason:'bad'}]}),async()=>{});
 await assert.rejects(()=>invalid(batch,history),/Invalid identity/);
 const failure=reviewedIdentityRecognizer(initial,async()=>{throw Error('provider failed');},async()=>{});await assert.rejects(()=>failure(batch,history),/provider failed/);
 const noNew=reviewedIdentityRecognizer(async()=>({places:[],assignments:[{observationId:'o',placeId:null,reason:'unknown'}]}),async()=>{throw Error('must not call');},async()=>{});assert.equal((await noNew(batch,history)).assignments[0]!.placeId,null);
});
