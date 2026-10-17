/** Durable sequential coordinator: waits on child exit events, never polls. */
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const [prepared,bank,paid]=process.argv.slice(2);
if(!prepared||!bank||paid!=='--confirm-paid')throw Error('Usage: prepared bank --confirm-paid');
const root=resolve(prepared),taskBank=resolve(bank);const history:Array<Record<string,unknown>>=[];
const state=()=>writeFile(join(root,'pipeline-state.json'),JSON.stringify({history,updatedAt:new Date().toISOString()},null,2));
async function execute(name:string,file:string,args:string[],complete:string){
 if(existsSync(complete)){const record=JSON.parse(await readFile(complete,'utf8'));if(typeof record.status==='string'&&record.status!=='completed'||name==='unified-memory'&&record.status?.pending!==0)throw Error('Non-complete stage marker');history.push({stage:name,status:'existing-complete'});await state();return;}
 history.push({stage:name,status:'running',startedAt:new Date().toISOString()});await state();console.log('Starting',name);
 const code=await new Promise<number|null>((done,reject)=>{const child=spawn(process.execPath,['--use-env-proxy',file,...args],{stdio:'inherit',env:process.env});child.once('error',reject);child.once('exit',done);});
 if(code!==0){history.push({stage:name,status:'stopped',exitCode:code});await state();throw Error(`${name} failed; no later stage billed`);}
 if(!existsSync(complete))throw Error(`${name} exited without completion marker`);
 history.push({stage:name,status:'completed',finishedAt:new Date().toISOString()});await state();
}
await execute('unified-memory','dist/sim/spatial-calibration.js',[join(root,'model-replay'),join(root,'memory'),join(root,'memory-config.json'),'--confirm-paid',...existsSync(join(root,'memory'))?['--resume']:[]],join(root,'memory','summary.json'));
await execute('smoke-18','dist/sim/memory-evaluation.js',[root,'smoke','--confirm-paid'],join(root,'smoke','complete.json'));
await execute('smoke-grading','dist/sim/memory-evaluation-grade.js',[root,taskBank,'smoke','--confirm-paid'],join(root,'smoke-grading','complete.json'));
await execute('full-270','dist/sim/memory-evaluation.js',[root,'full','--confirm-paid'],join(root,'full','complete.json'));
await execute('full-grading','dist/sim/memory-evaluation-grade.js',[root,taskBank,'full','--confirm-paid'],join(root,'full-grading','complete.json'));
console.log('First complete evaluation finished:',join(root,'full-grading','scorecard.json'));
