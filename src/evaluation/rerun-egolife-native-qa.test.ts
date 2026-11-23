import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readNativeSnapshot} from './rerun-egolife-native-qa.js';

test('QA replay reads causal snapshots from a query-only baseline without changing memory',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE originals(id TEXT,at_ms REAL,raw TEXT); CREATE TABLE judgments(id TEXT,available_ms REAL,raw TEXT);');
  db.prepare('INSERT INTO originals VALUES(?,?,?)').run('old',1000,JSON.stringify({id:'old',atMs:1000}));
  db.prepare('INSERT INTO originals VALUES(?,?,?)').run('future',9000,JSON.stringify({id:'future',atMs:9000}));
  db.prepare('INSERT INTO judgments VALUES(?,?,?)').run('old',6000,JSON.stringify({placeId:'late'}));
  db.exec('PRAGMA query_only=ON');
  const early=readNativeSnapshot(db,5000);assert.equal(early.rows.length,1);assert.equal(early.rows[0]!.judgment,null);
  const later=readNativeSnapshot(db,7000);assert.equal(later.rows[0]!.judgment.placeId,'late');
  later.rows[0]!.judgment.placeId='tampered';assert.equal(readNativeSnapshot(db,7000).rows[0]!.judgment.placeId,'late');
  assert.throws(()=>db.exec('DELETE FROM originals'));
 }finally{db.close();}
});
