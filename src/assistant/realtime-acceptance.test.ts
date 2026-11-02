import test from 'node:test';
import assert from 'node:assert/strict';
import {streamEfficiency} from './stream-efficiency.js';
import {assessRealtime} from './realtime-acceptance.js';

function fixture(){
 const metrics=streamEfficiency([],true);
 Object.assign(metrics,{sourceDurationMs:1210000,inputObservations:576,completedObservations:576,extractedObservations:576,completedCoverage:1,failedTasks:0,failedBatches:0,observationEndToEndMs:{count:576,p50:1200,p95:2000,max:4000},unfinishedCount:{count:600,p50:1,p95:2,max:3},tailBacklogSlopeObservationsPerMinute:0,catchUpMs:1500,interactions:[{id:'q',status:'completed',elapsedMs:2500}]});
 return {metrics,schedule:Array.from({length:576},()=>({arrivalLateMs:2}))};
}
test('fixed realtime acceptance passes measured facts without promoting relationship certainty',()=>{
 const {metrics,schedule}=fixture();const assessment=assessRealtime(metrics,576,schedule);
 assert.equal(assessment.passed,true);assert.equal(assessment.semanticAccuracy,'not-evaluated');assert.match(assessment.scope,/NOT hard real-time/);
});
test('failed observations, short tests, growing backlog, stretched inputs and slow tails cannot pass',()=>{
 const mutations=[(m:ReturnType<typeof streamEfficiency>)=>{m.failedTasks=1;},(m:ReturnType<typeof streamEfficiency>)=>{m.completedObservations=575;},(m:ReturnType<typeof streamEfficiency>)=>{m.sourceDurationMs=66000;},(m:ReturnType<typeof streamEfficiency>)=>{m.observationEndToEndMs.p95=2600;},(m:ReturnType<typeof streamEfficiency>)=>{m.tailBacklogSlopeObservationsPerMinute=1;},(m:ReturnType<typeof streamEfficiency>)=>{m.catchUpMs=null;},(m:ReturnType<typeof streamEfficiency>)=>{m.interactions[0]!.status='failed';}];
 for(const mutate of mutations){const {metrics,schedule}=fixture();mutate(metrics);assert.equal(assessRealtime(metrics,576,schedule).passed,false);}
 const {metrics,schedule}=fixture();schedule[0]!.arrivalLateMs=1000;assert.equal(assessRealtime(metrics,576,schedule).passed,false);
});
