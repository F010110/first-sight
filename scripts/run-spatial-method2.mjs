/** Fixed method-2 entry point. Legacy experiment runner stays available for explicit ablations. */
import {spawn} from 'node:child_process';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
export function method2Arguments(args){
 const [input,features,...options]=args;
 if(!input||!features||!options.includes('--confirm-paid')||options.some(arg=>arg!=='--confirm-paid'))throw Error('Usage: run-spatial-method2 PUBLIC-input.json BOUND-features.json --confirm-paid');
 return ['--use-env-proxy',resolve('dist/current/desktop/run-spatial-fixed-evaluation.js'),input,'--ground-first','--comparative-resolution','--continuous-region-scope','--short-references',`--candidate-features=${features}`,'--visit-context=sequence','--max-calls=256','--confirm-paid'];
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=method2Arguments(process.argv.slice(2));console.log('固定方法2：最近2地点＋视觉2地点＋最近6次访问序列；不给VLM图关系。费用上限估算USD0.50。');
 const child=spawn(process.execPath,args,{stdio:'inherit'});child.on('error',error=>{console.error(error);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
}
