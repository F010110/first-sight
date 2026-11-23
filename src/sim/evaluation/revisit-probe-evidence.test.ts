import {test} from 'node:test';
import assert from 'node:assert/strict';
import {replaceProbeEvidence} from './revisit-probe-evidence.js';
import type {RevisitRecall} from '../../assistant/spatial-memory/revisit-candidates.js';

test('backend evidence replacement removes stale pair declarations and uses production projection',()=>{
 const recall:RevisitRecall={status:'ok',method:'megaloc-lightglue-ransac',consideredPlaces:1,excludedPreviousPlaceId:null,error:null,limit:1,candidates:[{placeId:'new-place',name:'candidate',matchedObservationId:'history',matchedAtMs:0,bestInliers:999,bestSimilarity:.99,supportedMembers:1,images:[]}],note:'candidate only'};
 const pair={placeId:'new-place',channel:'global',current:{id:'now',direction:'left'},historical:{id:'history',direction:'right'}};
 const result=replaceProbeEvidence('unchanged instructions\nSelected evidence pairs: [{"placeId":"stale-place"}]',recall,[pair]);
 assert.ok(!result.prompt.includes('stale-place'));assert.ok(result.prompt.startsWith('unchanged instructions\n'));
 assert.equal(result.prompt.split('Selected evidence pairs: ').length,2);
 assert.deepEqual(JSON.parse(result.prompt.split('Selected evidence pairs: ')[1]!),[pair]);
 assert.ok(!JSON.stringify(result.revisit).includes('bestInliers'));assert.ok(!JSON.stringify(result.revisit).includes('bestSimilarity'));
});

test('missing or duplicated frozen declarations fail closed instead of mixing evidence',()=>{
 const recall={candidates:[]} as unknown as RevisitRecall;
 assert.throws(()=>replaceProbeEvidence('no declaration',recall,[]),/exactly one/);
 assert.throws(()=>replaceProbeEvidence('Selected evidence pairs: []\nSelected evidence pairs: []',recall,[]),/exactly one/);
});
