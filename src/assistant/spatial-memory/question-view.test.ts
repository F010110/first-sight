import test from 'node:test';
import assert from 'node:assert/strict';
import {SpatialQuestionView,type SpatialReader,SpatialSnapshot} from './question-view.js';
import type {StoredState,HistoryRecord,Assessment} from './contracts.js';

const location=(placeId:string|null,atId:string):Assessment['location']=>({status:placeId?'known':'unknown',placeId,name:placeId??'未知',reason:'来源',sourceIds:[atId]});
const state=(version:number,id:string,atMs:number):StoredState=>({version,observationId:id,atMs,availableAtMs:atMs,facts:{summary:'事实'+id,details:['细节'+id]},assessment:{location:location('place-a',id),hypotheses:[],unresolved:[],relations:[]},visitId:null});
const history=(s:StoredState):HistoryRecord=>({observationId:s.observationId,atMs:s.atMs,facts:s.facts,location:s.assessment.location,version:s.version});

function fakeReader(){
 const states=[state(1,'a',0),state(2,'b',1000)];
 const snapshot=(version:number,knownAtMs:number):SpatialSnapshot=>{
  const target=states.find(s=>s.version===version);
  if(!target||target.availableAtMs>knownAtMs)throw Error('Uncommitted or not yet available spatial version');
  const allowed=states.filter(s=>s.version<=version&&s.availableAtMs<=knownAtMs);
  return {state:allowed.at(-1)!,context:{current:{id:'b',atMs:1000},location:null,recent:[],anchors:[],retrieved:[]},history:allowed.map(history),visits:[{placeId:'place-a',observationIds:allowed.map(s=>s.observationId)}],transitions:[]};
 };
 const inspected:string[]=[];
 const reader:SpatialReader={latest:()=>null,snapshotAt:snapshot,inspectAt:async(version,knownAtMs,ids)=>{const snap=snapshot(version,knownAtMs),allowed=new Set(snap.history.map(r=>r.observationId));if(ids.some(id=>!allowed.has(id)))throw Error('outside committed snapshot');inspected.push(...ids);return ids.flatMap(id=>['front','left','right'].map(direction=>({id,direction,path:id+'-'+direction+'.png',sha256:'x'})));}};
 return {reader,inspected,states};
}

test('question view reads only its committed version and requires delivery before images',async()=>{
 const {reader,inspected}=fakeReader();
 const view=SpatialQuestionView.open(reader,2,1000);
 assert.equal(view.currentLocation().placeId,'place-a');
 assert.throws(()=>view.read(['b']),/previously delivered/);
 await assert.rejects(view.inspect(['b']),/previously delivered/);
 assert.equal(view.timeline({beforeMs:0}).records.length,1);
 assert.equal(view.timeline({beforeMs:1000}).records.length,2);
 assert.equal(view.find(['事实b']).records.length,1);
 const images=await view.inspect(['b']);
 assert.equal(images.images.length,3);assert.deepEqual(inspected,['b']);
 assert.equal(view.coverage().inspected,1);
 assert.throws(()=>view.timeline({beforeMs:2000}),/inside the committed snapshot/);
});

test('later committed versions and availability are invisible from an earlier question cutoff',()=>{
 const {reader}=fakeReader();
 const earlier=SpatialQuestionView.open(reader,1,0);
 assert.equal(earlier.timeline().records.length,1);
 assert.throws(()=>SpatialQuestionView.open(reader,2,0),/Uncommitted|not yet available/);
 const later=SpatialQuestionView.open(reader,2,1000);
 assert.equal(later.timeline().records.length,2);
 assert.equal('commit' in later,false);
});
