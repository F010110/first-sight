import {test} from 'node:test';import assert from 'node:assert/strict';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
test('browser comparison projection is causal and unknown clears the displayed identity after seeking',async()=>{
 const {methodAtTime}=await import(pathToFileURL(resolve('web/desktop/comparison-view.js')).href);
 const method={events:[{atMs:100,episodeNumber:6,placeId:'p',name:'A'},{atMs:200,episodeNumber:6,placeId:null,name:'地点待定'},{atMs:300,episodeNumber:6,placeId:'q',name:'B'}]};
 assert.equal(methodAtTime(method,6,99).event,null);assert.equal(methodAtTime(method,6,250).event.placeId,null);assert.equal(methodAtTime(method,6,150).event.name,'A');assert.equal(methodAtTime(method,6,150).knownPlaces,1);assert.equal(methodAtTime(method,5,500).event,null);
});
