import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {streamEfficiency} from '../../assistant/stream-efficiency.js';
import {assessRealtime} from '../../assistant/realtime-acceptance.js';

const [rootArg]=process.argv.slice(2);
if(!rootArg||process.argv.length!==3)throw Error('Usage: assess-three-agent-stream EXISTING-ROOT');
const root=resolve(rootArg);
const report=JSON.parse(await readFile(join(root,'report.json'),'utf8'));
const events=JSON.parse(await readFile(join(root,'efficiency-events.json'),'utf8'));
const journal=(await readFile(join(root,'events.jsonl'),'utf8')).split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
const metrics=streamEfficiency(events,true,journal);
const assessment=assessRealtime(metrics,report.expectedInputObservations,report.schedule);
await writeFile(join(root,'realtime-acceptance.json'),JSON.stringify(assessment,null,2),{flag:'wx'});
console.log(JSON.stringify(assessment,null,2));
