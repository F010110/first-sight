import {test} from 'node:test';import assert from 'node:assert/strict';
import {SpatialVisitTopology} from './spatial-visit-topology.js';import {guardedGraphContext} from './spatial-guarded-graph.js';
test('guard removes weak edges without changing causal visits or source graph',()=>{
 const g=new SpatialVisitTopology();for(const [i,id] of ['a','b','a','b'].entries())g.observe({id:String(i),atMs:i*2000,placeId:id,name:id});
 const original=g.context(8000,['a','b']),filtered=guardedGraphContext(original);
 assert.deepEqual(filtered.recentVisits,original.recentVisits);assert.equal(filtered.places[0]!.relations.length,1);assert.equal(filtered.places[0]!.relations[0]!.count,2);assert.equal(filtered.places[1]!.relations.length,0);assert.ok(original.places[1]!.relations.length>0);
});
