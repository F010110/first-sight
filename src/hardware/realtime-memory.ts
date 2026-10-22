import {DatabaseSync} from 'node:sqlite';
export interface LiveOriginal {id:string;atMs:number;requestWallTimeMs:number;receivedAtMs:number;jpegPath:string;jpegSha256:string;pngPath?:string;pngSha256?:string;features?:number[][];gapBefore?:boolean}
/** Separate session DB. QA receives value snapshots, never a producer write handle. */
export class RealtimeMemory{
 private db:DatabaseSync;
 constructor(path:string){this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE originals(id TEXT PRIMARY KEY,at_ms REAL UNIQUE NOT NULL,raw TEXT NOT NULL); CREATE TABLE judgments(id TEXT PRIMARY KEY REFERENCES originals(id),available_ms REAL NOT NULL,raw TEXT NOT NULL); CREATE TABLE questions(id TEXT PRIMARY KEY,raw TEXT NOT NULL);');}
 archive(row:LiveOriginal){this.db.prepare('INSERT INTO originals VALUES(?,?,?)').run(row.id,row.atMs,JSON.stringify(row));}
 prepared(row:LiveOriginal){this.db.prepare('UPDATE originals SET raw=? WHERE id=?').run(JSON.stringify(row),row.id);}
 commit(id:string,result:unknown,availableMs:number){this.db.prepare('INSERT INTO judgments VALUES(?,?,?)').run(id,availableMs,JSON.stringify(result));}
 rows(){return (this.db.prepare('SELECT raw FROM originals ORDER BY at_ms').all() as {raw:string}[]).map(r=>JSON.parse(r.raw) as LiveOriginal);}
 snapshot(asOfMs:number){
  return structuredClone({asOfMs,rows:(this.db.prepare('SELECT o.raw,j.raw AS judgment,j.available_ms FROM originals o LEFT JOIN judgments j ON j.id=o.id AND j.available_ms<=? WHERE o.at_ms<=? ORDER BY o.at_ms').all(asOfMs,asOfMs) as {raw:string;judgment:string|null;available_ms:number|null}[]).map(r=>({original:JSON.parse(r.raw) as LiveOriginal,judgment:r.judgment?JSON.parse(r.judgment):null,availableAtMs:r.available_ms}))});
 }
 question(id:string,value:unknown){this.db.prepare('INSERT INTO questions VALUES(?,?)').run(id,JSON.stringify(value));}
 close(){this.db.close();}
}
