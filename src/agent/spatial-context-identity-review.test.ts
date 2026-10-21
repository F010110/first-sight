import {test} from 'node:test';import assert from 'node:assert/strict';
import {spatialReferenceIds,spatialIdentityReviewError,reviewedSpatialModel,spatialComparisonRequirements} from './spatial-context-identity-review.js';
import type {SpatialLoopModel} from './spatial-context-loop.js';
const input:any={context:{current:null,location:null,recent:[{observationId:'latest',atMs:8,placeId:'p',sourceIds:['latest']}],anchors:[{observationId:'anchor',atMs:1,placeId:'p',sourceIds:['anchor']}],retrieved:[{id:'latest',placeId:'p',atMs:8}],outputs:[],compression:{}},observations:[{id:'now',atMs:10,frames:[]}],question:null,candidates:[],inspectedIds:['now','latest'],evidenceImages:[{id:'latest',mimeType:'image/png',data:'fixture'}],remainingCalls:4,historicalEvidenceRequired:false,feedback:null};
const assessment={observationId:'now',atMs:10,placeId:'p',reason:'layout',sourceIds:['now','latest'],observerRegion:'inside enclosed court',comparisons:[{referenceId:'latest',relation:'same',layoutEvidence:'same fence side and court floor'}]};
test('reference selection uses latest observation and same-identity anchor, never future',()=>{
 assert.deepEqual(spatialReferenceIds(input.context,input.observations),['latest','anchor']);
 assert.deepEqual(spatialReferenceIds({...input.context,recent:[{...input.context.recent[0],atMs:11}]},input.observations),[]);
});
test('identity review rejects repeated new identity after same-region comparison',()=>{
 assert.equal(spatialIdentityReviewError({assessments:[assessment]},input),null);
 assert.match(spatialIdentityReviewError({assessments:[{...assessment,placeId:'new-1'}]},input)!,/Same physical region/);
 assert.match(spatialIdentityReviewError({assessments:[{...assessment,comparisons:[{...assessment.comparisons[0],relation:'different'}]}]},input)!,/Reusing/);
 assert.equal(spatialIdentityReviewError({assessments:[{...assessment,placeId:'new-1',comparisons:[{...assessment.comparisons[0],relation:'different'}]}]},input),null);
 assert.equal(spatialIdentityReviewError({assessments:[{...assessment,placeId:null,comparisons:[{...assessment.comparisons[0],relation:'uncertain'}]}]},input),null);
 assert.match(spatialIdentityReviewError({assessments:[{...assessment,placeId:'new-1',comparisons:[{...assessment.comparisons[0],relation:'uncertain'}]}]},input)!,/Uncertain/);
});
test('references need original citations; unseen known identities cannot be reused',()=>{
 assert.match(spatialIdentityReviewError({assessments:[null]},input)!,/unique exact/);
 assert.match(spatialIdentityReviewError({assessments:[{...assessment,comparisons:[null]}]},input)!,/entries must/);
 assert.match(spatialIdentityReviewError({assessments:[{...assessment,sourceIds:['now']}]},input)!,/citation/);
 assert.match(spatialIdentityReviewError({assessments:[{...assessment,placeId:'unseen',comparisons:[{...assessment.comparisons[0],relation:'different'}]}]},input)!,/directly compared/);
 assert.match(spatialIdentityReviewError({assessments:[{...assessment,comparisons:[]}]},input)!,/missing=/);
});
test('window entry compares historical representatives, later observations compare previous original without forced duplicate matrix',()=>{
 const two={...input,observations:[...input.observations,{id:'next',atMs:12,frames:[]}]};
 assert.deepEqual(spatialComparisonRequirements(two),[{observationId:'now',requiredReferenceIds:['latest']},{observationId:'next',requiredReferenceIds:['now']}]);
 const next={...assessment,observationId:'next',atMs:12,sourceIds:['next','now'],comparisons:[{referenceId:'now',relation:'same',layoutEvidence:'same fence side and floor'}]};
 assert.equal(spatialIdentityReviewError({assessments:[assessment,next]},two),null);
 const extra={...next,sourceIds:['next','now','latest'],comparisons:[...next.comparisons,...assessment.comparisons]};
 assert.equal(spatialIdentityReviewError({assessments:[assessment,extra]},two),null);
 assert.match(spatialIdentityReviewError({assessments:[assessment,{...next,placeId:'new-1'}]},two)!,/Same physical region/);
});
test('bounded review preserves rejections and ends unknown, never accepting bad grouping',async()=>{
 let calls=0;const rejected:unknown[]=[];
 const base:SpatialLoopModel=async()=>{calls++;return {assessments:[{...assessment,placeId:'new-1'}],next:{kind:'finish'}} as any;};
 const model=reviewedSpatialModel(base,async value=>{rejected.push(value);});const output=await model(input);
 assert.equal(calls,3);assert.equal(rejected.length,4);assert.equal(output.assessments![0]!.placeId,null);
});
