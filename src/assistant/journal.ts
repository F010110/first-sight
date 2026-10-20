import {appendFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Journal} from './contracts.js';

/** Serialized append-only audit; state snapshots are for inspection, not Context restore. */
export class FileJournal implements Journal {
 private tail:Promise<void>=Promise.resolve();
 constructor(private readonly root:string){}
 append(kind:string,value:unknown){
  const event={atMs:Date.now(),kind,value:structuredClone(value)};
  this.tail=this.tail.then(async()=>{await mkdir(this.root,{recursive:true});await appendFile(join(this.root,'events.jsonl'),JSON.stringify(event)+'\n');});
  return this.tail;
 }
 async snapshot(value:unknown){await this.tail;await writeFile(join(this.root,'state.json'),JSON.stringify(value,null,2));}
}
