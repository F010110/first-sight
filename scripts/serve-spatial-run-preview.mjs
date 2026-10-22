/** Read-only experiment preview using the existing desktop UI unchanged.
 * No prepared package replacement, question history or paid inference.
 */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const [runPath,videoPath,portValue='8883',comparisonPath]=process.argv.slice(2);
if(!runPath||!videoPath)throw Error('Usage: serve-spatial-run-preview RUN-directory CLIPPED-video-directory [port] [comparison-manifest.json]');
const run=resolve(runPath),video=resolve(videoPath),port=Number(portValue);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid port');
const predictions=JSON.parse(await readFile(join(run,'predictions.json'),'utf8'));
const input=JSON.parse(await readFile(join(run,'public-input.json'),'utf8'));
const manifest=JSON.parse(await readFile(join(video,'complete.json'),'utf8'));
const rows=(await readFile(join(run,'events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line).result);
const events=new Map(rows.map(row=>[row.id,row]));
const positions=input.observations.map(observation=>{
 const event=events.get(observation.id),episodeNumber=Number(observation.scene.match(/^campus-episode-(\d+)$/)?.[1]);
 if(!episodeNumber)throw Error('Preview requires campus episode scene IDs');
 const group=event?.groups.find(group=>group.id===event.placeId);
 return {atMs:observation.atMs,episodeNumber,name:group?.scope.name??(event?'地点待定':'未完成建模')};
});
const load=path=>import(pathToFileURL(resolve('dist/current',path)).href);
const comparison=comparisonPath?await (await load('desktop/spatial-method-comparison.js')).loadSpatialMethodComparison(comparisonPath):null;
const [{desktopServer},{AssistantRuntime},{FileJournal},{QwenPlanner}]=await Promise.all([load('desktop/server.js'),load('assistant/runtime.js'),load('assistant/journal.js'),load('assistant/qwen-planner.js')]);
const root=join(run,'read-only-preview');await mkdir(root,{recursive:true});
const journal=new FileJournal(root);
const memory={async observe(){throw Error('Read-only spatial preview');},async question(){throw Error('Read-only spatial preview');},discardPending(){},close(){}};
const runtime=new AssistantRuntime(new QwenPlanner(join(root,'disabled-requests'),false),memory,journal,[],false);
process.env.FIRST_SIGHT_CAMPUS_VIDEO=video;
const server=desktopServer(runtime,journal,root,port,false,positions);
const handlers=server.listeners('request');server.removeAllListeners('request');
server.on('request',(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 const pathname=new URL(req.url??'/',`http://127.0.0.1:${port}`).pathname;
 const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 if(req.method!=='GET'&&req.method!=='HEAD')return json(403,{error:'此页仅回放本轮空间建模，不调用模型。'});
 if(pathname==='/api/method-comparison')return comparison?json(200,comparison):json(404,{error:'No method comparison configured'});
 if(pathname==='/api/playback-timeline')return json(200,{dataset:'spatial-run-preview',questions:[],positions});
 if(pathname==='/api/recordings')return json(200,[]);
 if(pathname==='/api/videos')return json(200,{fps:manifest.fps,memoryReady:false,episodes:manifest.episodes.map(episode=>({...episode,src:'/video/'+episode.src}))});
 for(const handler of handlers)handler.call(server,req,res);
});
await writeFile(join(root,'binding.json'),JSON.stringify({run,video,modelCalls:0,readOnly:true,planned:predictions.predictions.length,completed:rows.length,locationTiming:'Saved observation-time spatial results, not a measurement of live model response latency',oldFrontendAndPreparedMemoryUnchanged:true},null,2));
server.listen(port,'127.0.0.1',()=>console.log(`只读空间回放：http://127.0.0.1:${port} · ${rows.length}/${input.observations.length}观察`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>{void runtime.close().then(()=>process.exit(0));}));
