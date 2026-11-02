import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {loadSkills,BACKGROUND_CONTEXT} from '@earendil-works/pi-agent-core';
import {NodeExecutionEnv} from '@earendil-works/pi-agent-core/node';

export async function firstSightSkills(){
 const env=new NodeExecutionEnv({cwd:process.cwd()});
 const result=await loadSkills(env,[resolve('skills/first-sight')],BACKGROUND_CONTEXT);
 if(result.diagnostics.length)throw Error('Skill loading diagnostics: '+JSON.stringify(result.diagnostics));
 for(const name of ['first-sight-assistant','memory-investigation','visual-inspection','context-compaction'])if(!result.skills.some(s=>s.name===name))throw Error('Missing skill '+name);
 return {env,skills:result.skills,versions:Object.fromEntries(result.skills.map(s=>[s.name,createHash('sha256').update(s.content).digest('hex')]))};
}
