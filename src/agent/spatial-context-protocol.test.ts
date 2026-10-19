import {test} from 'node:test';import assert from 'node:assert/strict';import {spatialProtocolError} from './spatial-context-protocol.js';
const observations=[{id:'a',atMs:1,frames:[]}],assessment={observationId:'a',atMs:1,placeId:null,reason:'layout',sourceIds:['a']};
test('malformed model shapes and forbidden action variants are rejected without throwing',()=>{
 const invalid:unknown[]=[null,[],{}, {assessments:[null]}, {assessment,next:'finish'}, {assessment,next:{kind:'new-place',alias:'new-1'}},{assessment,next:{kind:'search'}},{assessment,next:{kind:'inspect',ids:'a'}},{assessment,next:{kind:'inspect',ids:['unavailable']}},{assessment,next:{kind:'answer',answer:'guess',abstained:false,sourceIds:['invented']}}];
 for(const value of invalid)assert.equal(typeof spatialProtocolError(value,observations,'question',new Set(['a']),new Set()),'string');
 assert.equal(spatialProtocolError({assessment,next:{kind:'answer',answer:'visible',abstained:false,sourceIds:['a']}},observations,'question',new Set(['a']),new Set()),null);
});
