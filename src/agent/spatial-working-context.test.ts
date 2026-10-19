import {test} from 'node:test';import assert from 'node:assert/strict';
import {SpatialWorkingContext} from './spatial-working-context.js';
test('new observation invalidates location until judged, and snapshots are detached',()=>{
 const c=new SpatialWorkingContext();c.observe({id:'a',atMs:1,frames:[]});c.commit({observationId:'a',atMs:1,placeId:'p',reason:'visible layout',sourceIds:['a']});assert.equal(c.view().location?.placeId,'p');
 c.observe({id:'b',atMs:2,frames:[]});assert.equal(c.view().location,null);const view=c.view();view.recent.length=0;assert.equal(c.view().recent.length,1);
});
test('compression bounds history and evidence without claiming raw deletion',()=>{
 const c=new SpatialWorkingContext(2,2,2);for(let i=0;i<20;i++){c.observe({id:'o'+i,atMs:i,frames:[]});c.commit({observationId:'o'+i,atMs:i,placeId:'p'+i,reason:'layout',sourceIds:['o'+i]});}
 assert.equal(c.view().recent.length,2);assert.equal(c.view().anchors.length,2);assert.ok(c.view().compression.discarded>0);assert.equal(c.view().compression.rawMemoryDeleted,false);
 assert.throws(()=>c.retrieve({id:'future',atMs:21,reason:'future',placeId:null},new Set(['future'])));
 assert.throws(()=>c.retrieve({id:'old',atMs:1,reason:'not viewed',placeId:null},new Set()));
});
