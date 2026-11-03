import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {SpatialLongTermStore} from '../../dist/current/assistant/spatial-memory/long-term-store.js';
import {describeSpatialMemory} from '../review/describe-spatial-memory.mjs';

test('text inspection reads the actual organized database without changing it or calling a provider',async()=>{
 const root=await mkdtemp(join(tmpdir(),'opencode/memory-text-'));
 try{
  const store=new SpatialLongTermStore(root),row={id:'a',atMs:0,views:[]};store.archive(row);store.saveFacts('a',{summary:'visible street',details:['red awning']});
  const state=store.add(row,{location:{status:'new',placeId:null,name:'corner',reason:'visible source',sourceIds:['a']},hypotheses:[],unresolved:[],relations:[],memoryNotes:[{text:'red awning',sourceIds:['a']}]},s=>({current:{id:'a',atMs:0},location:s.assessment.location,recent:[s],anchors:[],retrieved:[]}));store.close();
  await mkdir(join(root,'pi-requests'));await writeFile(join(root,'complete.json'),JSON.stringify({observations:1,planned:1,spatialStates:1,skippedWindows:0,elapsedMs:10,contextPolicy:'spatial-session-context-v1'}));
  const hash=async()=>createHash('sha256').update(await readFile(join(root,'spatial.sqlite'))).digest('hex'),before=await hash();
  const {result,markdown}=await describeSpatialMemory(root);assert.equal(await hash(),before);assert.equal(result.databaseSHA256,before);assert.equal(result.places[0].id,state.assessment.location.placeId);assert.equal(result.places[0].visits[0].windows[0].observationId,'a');assert.equal(result.places[0].notes[0].text,'red awning');assert.equal(result.places[0].notes[0].sources[0].source_id,'a');assert.equal(result.receipts[0].notesAdded,1);assert.match(markdown,/访问1/);assert.match(markdown,/visible street/);assert.equal(result.readOnly,true);
 }finally{await rm(root,{recursive:true,force:true});}
});
