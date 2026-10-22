import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';
import {loadSpatialMethodComparison} from './spatial-method-comparison.js';
test('comparison binds source inputs and preserves unknowns instead of inheriting the previous place',async()=>{
 const root=await mkdtemp(resolve('cam/local/method-compare-'));
 try{
  const methods=[];
  for(const id of ['recall','graph']){
   const dir=join(root,id);await mkdir(join(dir,'requests'),{recursive:true});methods.push({id,label:id,root:dir});
   const input=JSON.stringify({observations:[{id:'a',scene:'campus-episode-6',atMs:100},{id:'b',scene:'campus-episode-6',atMs:200}]});
   await writeFile(join(dir,'public-input.json'),input);await writeFile(join(dir,'frozen.json'),JSON.stringify({inputSha256:createHash('sha256').update(input).digest('hex')}));
   const groups=[{id:'uuid',scope:{name:'区域',definition:'原图范围'}}];
   await writeFile(join(dir,'events.jsonl'),[{id:'a',atMs:100,placeId:'uuid',action:'new',groups},{id:'b',atMs:200,placeId:null,action:'unknown',groups}].map(result=>JSON.stringify({scene:'campus-episode-6',result})).join('\n'));
   await writeFile(join(dir,'predictions.json'),JSON.stringify({predictions:[{status:'completed'},{status:'completed'}]}));await writeFile(join(dir,'requests/usage.json'),JSON.stringify({calls:3,estimatedUSD:.01}));
  }
  const config=join(root,'config.json');await writeFile(config,JSON.stringify({schema:'spatial-method-comparison-v1',sample:{id:'campus'},methods,defaultMethod:'recall'}));
  const value=await loadSpatialMethodComparison(config);assert.equal(value.defaultMethod,'recall');assert.equal(value.methods.length,2);assert.equal(value.methods[0]!.events[1]!.name,'地点待定');assert.equal(value.methods[0]!.events[1]!.placeKey,null);
  await writeFile(join(methods[1]!.root,'public-input.json'),'{}');await assert.rejects(loadSpatialMethodComparison(config),/identical/);
 }finally{await rm(root,{recursive:true,force:true});}
});
