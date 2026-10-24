/** Explicit paid historical QA check; reads a stopped session without rewriting it. */
import {DatabaseSync} from 'node:sqlite';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {answerRealtimeQuestion} from '../../dist/current/hardware/realtime-question.js';
import {spatialJsonVlm} from '../../dist/current/agent/spatial-json-vlm.js';
const [source,output,confirmation]=process.argv.slice(2);
if(!source||!output||confirmation!=='--confirm-paid')throw Error('Usage: check-realtime-history SESSION NEW-OUTPUT --confirm-paid (USD0.10 cap)');
const root=resolve(output);await mkdir(root,{recursive:false});
const db=new DatabaseSync(join(resolve(source),'memory.sqlite'),{readOnly:true});const asOfMs=Date.now();
const rows=db.prepare('SELECT o.raw,j.raw AS judgment,j.available_ms FROM originals o LEFT JOIN judgments j ON j.id=o.id AND j.available_ms<=? WHERE o.at_ms<=? ORDER BY o.at_ms').all(asOfMs,asOfMs).map(r=>({original:JSON.parse(r.raw),judgment:r.judgment?JSON.parse(r.judgment):null,availableAtMs:r.available_ms}));db.close();
const snapshot={asOfMs,rows};await writeFile(join(root,'snapshot.json'),JSON.stringify(snapshot));
const text='刚才记录的画面中有哪些物体？请先搜索再查看历史原图。';
const result=await answerRealtimeQuestion(snapshot,text,spatialJsonVlm(join(root,'requests'),12,.1),false);
await writeFile(join(root,'result.json'),JSON.stringify({source:resolve(source),text,result},null,2));console.log(JSON.stringify(result));
