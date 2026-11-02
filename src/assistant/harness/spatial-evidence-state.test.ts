import test from 'node:test';
import assert from 'node:assert/strict';
import {SpatialEvidenceState} from './spatial-evidence-state.js';

test('source-state replay restores the complete source plane without interpretations',()=>{
 const state=new SpatialEvidenceState(),frames=Array.from({length:6},(_,i)=>({memoryRef:`memory-v${i+1}`,observationId:`o${i+1}`,atMs:i,summary:'原始',observations:['固定观察']}));
 state.restoreSources(frames);frames[0]!.observations[0]='修改';
 state.begin({memoryRef:'memory-v7',observationId:'o7',atMs:7,summary:'当前',observations:[]});
 assert.equal(state.context().archive.count,6);assert.deepEqual(state.context().currentInterpretations,[]);assert.deepEqual(state.context().recalledSources,[]);
 assert.throws(()=>state.restoreSources([]));
 assert.throws(()=>new SpatialEvidenceState().restoreSources([{...frames[0]!,memoryRef:'wrong'}]));
});

test('old retrievals do not become implicit next-operation evidence or citation permission',async()=>{
 const state=new SpatialEvidenceState();
 for(let i=1;i<=7;i++){state.begin({memoryRef:`memory-v${i}`,observationId:`o${i}`,atMs:i,summary:`来源${i}`,observations:[`物体${i}`]});state.commit();}
 state.begin({memoryRef:'memory-v8',observationId:'o8',atMs:8,summary:'当前',observations:[]});
 await state.recall({op:'find',terms:['来源1']});await state.recall({op:'recall',memoryRefs:['memory-v1']});
 assert.equal(state.context().recalledSources.length,1);
 state.propose('候选关联',['memory-v1']);state.commit();
 state.begin({memoryRef:'memory-v9',observationId:'o9',atMs:9,summary:'新场景',observations:[]});
 assert.deepEqual(state.context().recalledSources,[]);
 assert.throws(()=>state.propose('复用旧检索',['memory-v1']));
 await state.recall({op:'recall',memoryRefs:['memory-v1']});
 assert.equal(state.propose('重新读取来源',['memory-v1']).recorded,true);
});

test('observations are immutable, interpretations are optional and never become next-frame facts',()=>{
 const state=new SpatialEvidenceState(),frame={memoryRef:'memory-v1',observationId:'one',atMs:1,summary:'当前室内',observations:['绿色桌子']};
 state.begin(frame);state.propose('可能是仓库',['memory-v1']);assert.equal(state.propose('可能是仓库',['memory-v1']).alreadyRecorded,true);frame.observations[0]='外部修改';
 const committed=state.commit();assert.deepEqual(committed.frame.observations,['绿色桌子']);
 state.begin({memoryRef:'memory-v2',observationId:'two',atMs:2,summary:'门口',observations:['前方街道']});
 const view=state.context();assert.deepEqual(view.currentInterpretations,[]);assert.ok(!JSON.stringify(view.recentSourceObservations).includes('仓库'));
 assert.equal(state.commit().interpretations.length,0);
});

test('source-only working context retains full old-source recall rather than forgetting the past',async()=>{
 const state=new SpatialEvidenceState();
 for(let i=1;i<=7;i++){state.begin({memoryRef:`memory-v${i}`,observationId:`o${i}`,atMs:i,summary:`来源${i}`,observations:[`物体${i}`]});state.commit();}
 state.begin({memoryRef:'memory-v8',observationId:'o8',atMs:8,summary:'当前',observations:[]});
 assert.equal(state.context().recentSourceObservations.length,4);
 assert.throws(()=>state.propose('未读来源',['memory-v1']));
 await state.recall({op:'find',terms:['来源1']});await state.recall({op:'recall',memoryRefs:['memory-v1']});
 assert.equal(state.propose('历史候选',['memory-v8','memory-v1']).kind,'model-interpretation-not-observation');
});
