import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {buildSpatialMemoryReport,writeSpatialMemoryReport,reportHtml} from '../review/spatial-memory-report.mjs';
import {serveMemoryReport} from '../review/serve-memory-report.mjs';

test('visual report exports saved versions read-only, escapes data and never serves arbitrary run files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'opencode/memory-report-'));let server;
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 try{
  await mkdir(join(root,'originals'));const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/WxoAAAAASUVORK5CYII=','base64'),sha=hash(png);await writeFile(join(root,'originals',sha+'.png'),png);
  const row={id:'a',atMs:0,views:[{id:'a',direction:'front',sha256:sha,path:'not-used'}]},facts={summary:'</script><script>bad()</script>',details:['visible source']};
  const state={version:1,observationId:'a',atMs:0,availableAtMs:100,facts,assessment:{location:{status:'known',placeId:'place-a',name:'corner',reason:'source',sourceIds:['a']},hypotheses:[],unresolved:[],relations:[]},visitId:'visit-a',window:{startMs:0,endExclusiveMs:8000,observations:[{id:'a',atMs:0,facts}],missingFactIds:[]}};
  const db=new DatabaseSync(join(root,'spatial.sqlite'));db.exec(`CREATE TABLE spatial_schema(version);INSERT INTO spatial_schema VALUES(3);CREATE TABLE observations(seq,id,at_ms,raw,facts,error);CREATE TABLE states(version,raw);CREATE TABLE checkpoints(version,raw);CREATE TABLE places(id,name,created_version);CREATE TABLE visits(id,place_id,start_version);CREATE TABLE place_profile_revisions(place_id,version,key,raw);CREATE TABLE relation_assertions(version,raw);CREATE TABLE revisions(version,observation_id,raw);CREATE TABLE skipped_windows(tail_id,at_ms,consumed_version,raw);CREATE TABLE events(seq,at_ms,kind,raw);`);
  db.prepare('INSERT INTO observations VALUES(1,?,?,?,?,NULL)').run('a',0,JSON.stringify(row),JSON.stringify(facts));db.prepare('INSERT INTO states VALUES(1,?)').run(JSON.stringify(state));db.prepare('INSERT INTO checkpoints VALUES(1,?)').run(JSON.stringify({current:{id:'a',atMs:0}}));db.prepare('INSERT INTO places VALUES(?,?,1)').run('place-a','corner');db.prepare('INSERT INTO visits VALUES(?,?,1)').run('visit-a','place-a');db.close();
  await writeFile(join(root,'manifest.json'),JSON.stringify({intervalMs:2000,windowMs:8000}));await writeFile(join(root,'complete.json'),JSON.stringify({completed:true,inputDrainComplete:true,elapsedMs:100,usage:[]}));
  const before=hash(await readFile(join(root,'spatial.sqlite'))),report=await buildSpatialMemoryReport(root);assert.equal(report.frames.length,1);assert.equal(report.frames[0].database.boundObservations[0].facts.summary,facts.summary);assert.equal(report.finalDatabase.profiles.length,0);assert.equal(report.producerDatabaseSHA256,before);
  const html=reportHtml(report,'<script type="application/json">__MEMORY_DATA__</script>');assert.ok(!html.includes('</script><script>bad()'));assert.ok(html.includes('\\u003c/script'));
  await writeSpatialMemoryReport(root);await assert.rejects(writeSpatialMemoryReport(root),e=>e.code==='EEXIST');assert.equal(hash(await readFile(join(root,'spatial.sqlite'))),before);
  server=await serveMemoryReport(root,0);const base='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(base)).status,200);assert.equal((await fetch(base+'/originals/'+sha+'.png')).status,200);assert.equal((await fetch(base+'/spatial.sqlite')).status,404);assert.equal((await fetch(base+'/../manifest.json')).status,404);assert.equal((await fetch(base,{method:'POST'})).status,405);assert.equal(hash(await readFile(join(root,'spatial.sqlite'))),before);
  const saved=await readFile(join(root,'memory-review','index.html'),'utf8'),script=saved.match(/<script>\s*([\s\S]*?)<\/script>/)[1];assert.doesNotThrow(()=>new Function(script));
  await writeFile(join(root,'originals',sha+'.png'),Buffer.from('changed fixture'));assert.equal((await fetch(base+'/originals/'+sha+'.png')).status,409);await assert.rejects(buildSpatialMemoryReport(root),/Archived image changed/);
 }finally{if(server)await new Promise(ok=>server.close(ok));await rm(root,{recursive:true,force:true});}
});
