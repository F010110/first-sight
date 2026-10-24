import {readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {evaluateSpatialRepeats} from '../../agent/spatial-repeat-evaluation.js';
const [truthPath,outputPath,...directories]=process.argv.slice(2);
if(!truthPath||!outputPath||directories.length<2)throw Error('Usage: score-spatial-repeats LABELS.json NEW-output.json RUN-dir RUN-dir ... (include all trials)');
const raw=await readFile(truthPath),truth=JSON.parse(raw.toString());
const artifacts=await Promise.all(directories.map(async directory=>{
 const bytes=await readFile(join(directory,'predictions.json')),run=JSON.parse(bytes.toString());
 return {directory,run,sha256:createHash('sha256').update(bytes).digest('hex'),frozen:JSON.parse(await readFile(join(directory,'frozen.json'),'utf8')),strategy:JSON.parse(await readFile(join(directory,'strategy.json'),'utf8'))};
}));
if(new Set(artifacts.map(a=>a.frozen.inputSha256)).size!==1)throw Error('Do not compare repeats of different public source inputs');
if(truth.publicInputSha256!==undefined&&artifacts.some(a=>a.frozen.inputSha256!==truth.publicInputSha256))throw Error('Repeat sources do not match the private review input hash');
if(new Set(artifacts.map(a=>JSON.stringify(a.strategy))).size!==1||new Set(artifacts.map(a=>JSON.stringify(a.frozen.sourceHashes))).size!==1)throw Error('Repeat stability requires the same frozen strategy and implementation; compare changed strategies separately');
const result=evaluateSpatialRepeats(truth.labels,truth.revisits,artifacts.map(a=>a.run));
await writeFile(outputPath,JSON.stringify({...result,labelsSha256:createHash('sha256').update(raw).digest('hex'),artifacts:artifacts.map(({run,...a})=>a)},null,2),{flag:'wx'});
console.log(JSON.stringify({runs:result.runCount,metrics:result.metrics,pairInstability:result.pairInstability}));
