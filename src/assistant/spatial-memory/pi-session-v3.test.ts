import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Type} from 'typebox';
import type {AgentHarnessTool} from '@earendil-works/pi-agent-core';
import {createV3Session,type V3Request} from './pi-session-v3.js';

const finish:AgentHarnessTool<undefined>={name:'finish_test',label:'finish_test',description:'Finish injected test operation.',parameters:Type.Object({}),replay:'safe',execute:async()=>({content:[{type:'text',text:'done'}],details:{},terminate:true})};
const view=()=>({current:{id:'test',atMs:0},runtimeContext:{currentVisualModule:'fresh independent source'},images:[]});
test('v3 spatial and private question Sessions compact independently, retain durable trails and pin their budget policy',async()=>{
 const root=mkdtempSync(join(tmpdir(),'v3-compact-'));let summaries=0;
 const request:V3Request=async r=>{
  if((r.data as any).messages&&!('tools' in (r.data as any))){summaries++;return {summary:'Working summary with source IDs and unresolved points.'};}
  return {output:{tool:'finish_test',arguments:{}},usage:{prompt_tokens:2000,completion_tokens:2}};
 };
 const options={maxContextChars:6000,keepRecentTokens:32,prefetch:false};
 const space=await createV3Session(join(root,'space'),'spatial-memory-v3',request,[finish],view,options),question=await createV3Session(join(root,'question'),'visual-question-v3',request,[finish],view,options);
 try{
  await space.prompt({seed:1});await space.prompt({seed:2});await space.prompt({spatialOnly:'s'.repeat(8000)});await space.prompt({next:'space'});
  await question.prompt({seed:1});await question.prompt({seed:2});await question.prompt({questionOnly:'q'.repeat(8000)});await question.prompt({next:'question'});
  assert.equal(summaries,2);
  const spaceTrail=readFileSync(space.session.metadata.path!,'utf8'),questionTrail=readFileSync(question.session.metadata.path!,'utf8');
  assert.match(spaceTrail,/spatialOnly/);assert.equal(questionTrail.includes('spatialOnly'),false);assert.equal(spaceTrail.includes('questionOnly'),false);
 }finally{await space.close();await question.close();rmSync(root,{recursive:true,force:true});}
});

test('invalid v3 summary fails closed without a hidden fallback model request or destroying original Session history',async()=>{
 const root=mkdtempSync(join(tmpdir(),'v3-bad-summary-'));let calls=0,summaries=0;
 const request:V3Request=async r=>{
  if((r.data as any).messages&&!('tools' in (r.data as any))){summaries++;return {summary:''};}
  calls++;return {output:{tool:'finish_test',arguments:{}},usage:{prompt_tokens:2000,completion_tokens:2}};
 };
 const role=await createV3Session(root,'spatial-memory-v3',request,[finish],view,{maxContextChars:6000,keepRecentTokens:32,prefetch:false});
 try{await role.prompt({seed:1});await role.prompt({seed:2});await role.prompt({original:'evidence'.repeat(1500)});await assert.rejects(()=>role.prompt({next:'must not send fallback'}),/compaction|summary/i);assert.equal(calls,3);assert.equal(summaries,2);assert.match(readFileSync(role.session.metadata.path!,'utf8'),/evidenceevidence/);}finally{await role.close();rmSync(root,{recursive:true,force:true});}
});
