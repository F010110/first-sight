import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {SpatialSqliteStore} from '../agent/spatial-sqlite-store.js';import {SpatialRetriever} from '../agent/spatial-retrieve.js';
import {spatialAlgorithmSession,oracleSession} from './spatial-memory-evaluation-session.js';
test('actual SpatialRetriever clock bridge, place associations, causal masking and oracle isolation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'algorithm-session-'));let retriever:SpatialRetriever|undefined;
 try{const image=join(dir,'x.png');await writeFile(image,'fixture');const hash=createHash('sha256').update('fixture').digest('hex');
 const rows=[0,1,2].map(i=>({id:`o${i}`,atMs:i*1000,sourceAtMs:i*1000,episodeNumber:1,judgmentAvailableAtMs:i===1?5000:i*1000,cameras:{front:image,left:image,right:image},sha256:{front:hash,left:hash,right:hash}}));
 const store=new SpatialSqliteStore(join(dir,'memory.sqlite'));for(const row of rows){store.ingest({id:row.id,atMs:row.atMs,frames:[image,image,image]});store.commit([{observationId:row.id,placeId:'p',reason:row.id==='o1'?'FUTURE':'gym'}],[{id:'p',summary:'future summary',representatives:[],lastSeenMs:row.atMs}]);}store.close();
 retriever=new SpatialRetriever(join(dir,'memory.sqlite'));const trace:unknown[]=[];const session=spatialAlgorithmSession(retriever,rows,1501,v=>trace.push(v));
 assert.equal(session.search({query:'FUTURE'}).hits.length,0);assert.equal(session.search({query:'第1段2秒'}).hits.length,0);
 const found=session.search({query:'第1段1秒'}).hits;assert.equal(found[0]?.id,'o1');assert.equal(found[0]?.reason,'');assert.equal(found[0]?.placeId,null);
 assert.equal(session.search({query:'gym'}).hits[0]?.placeId,'p');assert.equal((await session.inspect(['o1'])).length,3);
 const oracle=oracleSession(rows,['o0'],1501,()=>{});assert.equal((await oracle.inspect(['o0'])).length,3);oracle.validateCitations(['o0']);await assert.rejects(oracle.inspect(['o1']));
 assert.ok(trace.length>0);
 }finally{retriever?.close();await rm(dir,{recursive:true,force:true});}
});
