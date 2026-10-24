import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const [run,output]=process.argv.slice(2);if(!run||!output)throw Error('Usage: export-spatial-visit-topology RUN NEW-output.json');
const {SpatialVisitTopology}=await import(pathToFileURL(resolve('dist/current/agent/spatial-visit-topology.js')).href);
const raw=await readFile(resolve(run,'events.jsonl'),'utf8');const graphs=new Map();
for(const line of raw.trim().split('\n')){const {scene,result:r}=JSON.parse(line);let graph=graphs.get(scene);if(!graph){graph=new SpatialVisitTopology();graphs.set(scene,graph);}const place=r.groups.find(g=>g.id===r.placeId);graph.observe({id:r.id,atMs:r.atMs,placeId:r.placeId,...place?{name:place.scope.name}:{}});}
const report={sourceRun:run,eventsSha256:createHash('sha256').update(raw).digest('hex'),modelCalls:0,graphs:[...graphs].map(([scene,graph])=>({scene,...graph.snapshot()})),note:'Derived evidence only; predictions unchanged, not fed into original inference.'};
await writeFile(output,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({scenes:graphs.size,nodes:report.graphs.reduce((n,g)=>n+g.nodes.length,0),edges:report.graphs.reduce((n,g)=>n+g.edges.length,0),modelCalls:0}));
