import {test} from 'node:test';import assert from 'node:assert/strict';
import {memorySummary,withMemorySummary,type MemoryFact} from './memory-summary.js';
test('automatic compression is bounded, source-backed and does not edit raw memory',()=>{
 const facts:MemoryFact[]=Array.from({length:2000},(_,i)=>({id:'o'+i,atMs:i,text:'可见体育馆区域'+i%4,sourceIds:['o'+i],kind:'historical-judgment'}));const original=JSON.stringify(facts);
 const summary=memorySummary(facts,3000,1800);assert.ok(JSON.stringify(summary).length<=1800);assert.ok(summary.entries.some(e=>e.occurrences>1));assert.ok(summary.entries.length<facts.length);assert.equal(JSON.stringify(facts),original);
 const diverse=memorySummary(facts.map((f,i)=>({...f,text:'distinct '+i+' '.repeat(2)+'evidence'.repeat(100)})),3000,1800);assert.ok(diverse.compression.omitted>0);assert.ok(diverse.entries.some(e=>e.truncated));assert.ok(JSON.stringify(diverse).length<=1800);
});
test('exclude current, future and delayed judgments; retain user-context provenance',()=>{
 const facts:MemoryFact[]=[{id:'user',atMs:1,text:'之前在学校',kind:'user-context'},{id:'future',atMs:12,text:'未来答案',kind:'historical-judgment'},{id:'delayed',atMs:2,availableAtMs:12,text:'未返回识别',kind:'historical-judgment'},{id:'now',atMs:10,text:'当前未判断',kind:'historical-judgment'}];
 assert.deepEqual(memorySummary(facts,10).entries.map(e=>e.id),['user']);assert.equal(memorySummary([],0).entries.length,0);
});
test('configured calendar stays explicit and inside the compression budget',()=>{
 const summary=memorySummary([{id:'old',atMs:1,text:'past observation',kind:'historical-judgment'}],100,900,{kind:'assumed',sourceOriginMs:0,wallOrigin:'2026-10-18T09:00:00+08:00',offsetMinutes:480});
 assert.equal(summary.calendar?.kind,'assumed');assert.equal(summary.calendar?.asOf,'2026-10-18T09:00:00.100+08:00');assert.ok(JSON.stringify(summary).length<=900);
});
test('every provider payload gets one envelope without mutating or growing history',()=>{
 const body={messages:[{role:'user',content:[{type:'image_url',image_url:{url:'fixture'}}]},{role:'assistant',content:'tool result pending'}]};const before=JSON.stringify(body),summary=memorySummary([],1);
 for(let i=0;i<3;i++){const request=withMemorySummary(body,summary);assert.equal(JSON.stringify(request).match(/MEMORY_SUMMARY_JSON/g)?.length,1);assert.ok(JSON.stringify(request).includes('fixture'));}assert.equal(JSON.stringify(body),before);
});
