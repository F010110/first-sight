import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {spatialAcceptance} from '../agent/spatial-acceptance.js';
const [labelsPath,predictionsPath,outputPath]=process.argv.slice(2);
if(!labelsPath||!predictionsPath||!outputPath)throw Error('Usage: score-spatial-acceptance labels.json predictions.json NEW-report.json');
const labelsRaw=await readFile(labelsPath),predictionRaw=await readFile(predictionsPath);
const truth=JSON.parse(labelsRaw.toString()),run=JSON.parse(predictionRaw.toString());
if(!Array.isArray(truth.labels)||!Array.isArray(truth.revisits)||!Array.isArray(run.predictions)||typeof run.runId!=='string'||!run.runId.trim())throw Error('Require labels/revisits and one complete runId/predictions artifact');
const report={...spatialAcceptance(truth.labels,run.predictions,truth.revisits),runId:run.runId,labelsSha256:createHash('sha256').update(labelsRaw).digest('hex'),predictionsSha256:createHash('sha256').update(predictionRaw).digest('hex')};
await writeFile(outputPath,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({runId:run.runId,passed:report.passed,gates:report.gates}));
