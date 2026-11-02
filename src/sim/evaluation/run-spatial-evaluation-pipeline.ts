import {runSpatialPipeline,scoreSpatialPipeline} from './spatial-evaluation-pipeline.js';
import {runPipelineQuestions} from './spatial-pipeline-questions.js';
const [stage,arg,out,confirm]=process.argv.slice(2);
if(stage==='all'&&arg&&out&&confirm==='--confirm-paid'){
 const root=await runSpatialPipeline(arg,out),score=await scoreSpatialPipeline(root,undefined,'v2');
 console.log(JSON.stringify(score.spatial.gate.passed&&score.questions.status==='ready'?await runPipelineQuestions(root,'v2'):score,null,2));
}
else if(stage==='run'&&arg&&out&&confirm==='--confirm-paid')await runSpatialPipeline(arg,out);
else if(stage==='score'&&arg&&out==='--confirm-paid'&&!confirm)console.log(JSON.stringify(await scoreSpatialPipeline(arg,undefined,'v2'),null,2));
else if(stage==='rescore'&&arg&&out&&confirm==='--confirm-paid')console.log(JSON.stringify(await scoreSpatialPipeline(arg,undefined,out),null,2));
else if(stage==='retry-review'&&arg&&out&&confirm==='--confirm-paid')console.log(JSON.stringify(await scoreSpatialPipeline(arg,undefined,out,'v2'),null,2));
else if(stage==='questions'&&arg&&out==='--confirm-paid'&&!confirm)console.log(JSON.stringify(await runPipelineQuestions(arg,'v2'),null,2));
else if(stage==='questions'&&arg&&out&&confirm==='--confirm-paid')console.log(JSON.stringify(await runPipelineQuestions(arg,out),null,2));
else throw Error('Usage: run-spatial-evaluation-pipeline all|run PLAN NEW-OUTPUT --confirm-paid | score OUTPUT --confirm-paid | rescore OUTPUT v3 --confirm-paid | questions OUTPUT [v2] --confirm-paid');
