import {test} from 'node:test';import assert from 'node:assert/strict';import {SpatialVisitTopology} from './spatial-visit-topology.js';
const v=(id:string,atMs:number,placeId:string|null)=>({id,atMs,placeId,...placeId?{name:placeId}:{}});
test('consecutive transitions record evidence, revisits and timing without inventing traversability',()=>{
 const g=new SpatialVisitTopology();g.observe(v('a',0,'A'));g.observe(v('b',2000,'B'));g.observe(v('a2',4000,'A'));
 const s=g.snapshot();assert.equal(s.nodes.length,2);assert.equal(s.edges.filter(e=>e.kind==='observed-consecutive-transition').length,2);assert.equal(s.policy.directTraversability,'not-established');assert.equal(s.nodes[0]!.observations,2);
 s.nodes[0]!.name='mutated';assert.equal(g.snapshot().nodes[0]!.name,'A');
});
test('unknowns, gaps and elapsed time do not create direct links or metric distance',()=>{
 const g=new SpatialVisitTopology();g.observe(v('a',0,'A'));g.observe(v('u',2000,null));g.observe(v('b',4000,'B'));g.observe(v('c',40000,'C'));
 const s=g.snapshot();assert.equal(s.edges.length,1);assert.equal(s.edges[0]!.kind,'temporal-proximity-hint');assert.equal(s.policy.timeProvesMetricProximity,false);
});
test('VLM context is causal, bounded to selected groups and retains visit sequence',()=>{
 const g=new SpatialVisitTopology();for(let i=0;i<10;i++)g.observe(v('v'+i,i*2000,i%2?'B':'A'));
 const c=g.context(20000,['A']);assert.equal(c.recentVisits.length,6);assert.equal(c.places.length,1);assert.equal(c.places[0]!.relations.length,0);assert.ok(c.recentVisits.some(v=>v.status==='outside-recalled-candidates'));
 assert.throws(()=>g.context(18000,['A']),/Noncausal/);assert.throws(()=>g.observe({...v('later',22000,'A'),name:'renamed'}),/rename/);
});
test('sequence and graph contexts differ only in relation tables, not visit history or node evidence',()=>{
 const g=new SpatialVisitTopology();g.observe(v('a',0,'A'));g.observe(v('b',2000,'B'));
 const sequence=g.context(4000,['A','B'],false),graph=g.context(4000,['A','B'],true);
 assert.equal(sequence.places[0]!.relations.length,0);assert.equal(graph.places[0]!.relations.length,2);
 assert.deepEqual({...graph,places:graph.places.map(p=>({...p,relations:[]}))},sequence);
});
