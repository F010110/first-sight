/** Isolated protocol/quality probe, NOT the production Pi spatial-memory service. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spatialJsonVlm} from '../../dist/current/agent/spatial-json-vlm.js';

const [inputArg,outArg,confirm]=process.argv.slice(2);
if(!inputArg||!outArg||confirm!=='--confirm-paid')throw Error('Usage: probe-spatial-eight-second-batches INPUT NEW-OUT --confirm-paid');
const input=JSON.parse(await readFile(inputArg,'utf8')),out=resolve(outArg);
if(input.schema!=='spatial-public-input-v1')throw Error('Require public input');
await mkdir(out,{recursive:false});
// Public timeline only. No labels, questions or judge data enter either arm.
const windows=[0,200000,400000].map(start=>Array.from({length:4},(_,i)=>{
 const row=input.observations.find(r=>r.atMs>=start+i*2000);
 if(!row||row.atMs!==start+i*2000)throw Error('Require exact 2-second sampling');
 return {id:row.id,atMs:row.atMs,views:row.views.map(v=>({...v,id:row.id}))};
}));
await writeFile(join(out,'manifest.json'),JSON.stringify({schema:'eight-second-batch-probe-v1',windowMs:8000,samplingMs:2000,windows:windows.map(w=>w.map(r=>({id:r.id,atMs:r.atMs}))),scope:'Isolated direct-model diagnostic; no production Session, persistent identities, retrieval or real-time certification. Each arm resets between windows.'},null,2));
const perceive=spatialJsonVlm(join(out,'perception'),12,.15,true,1000);
const facts=new Map();
// Exactly two workers; never queue an unbounded list of model requests.
const rows=windows.flat();let cursor=0;
await Promise.all(Array.from({length:2},async()=>{while(cursor<rows.length){const r=rows[cursor++];facts.set(r.id,await perceive({phase:'perception',prompt:'独立检查当前同一时刻front/left/right三摄，仅输出JSON {"summary":"当前可见观察","details":["具体细节"]}。不判断历史身份，不虚构动作。',data:{current:{id:r.id,atMs:r.atMs}},images:r.views}));}}));
const prompt=`你是空间判断协议实验，不是裁判。输入是按时间排序的独立观察和原图。三摄方向不是时间。仅判断实际占据区域，远处可见店面不等于已进入。输出JSON {"observations":[{"id":"输入ID","regionKey":"本窗口局部区域键，例如a/b或unknown","name":"区域暂名","reason":"简短可核查依据","sourceIds":["实际输入来源ID"],"details":["本观察可见细节"]}],"transitions":[{"fromId":"ID","toId":"ID","status":"changed或uncertain","reason":"依据"}]}。每个输入观察必须恰好输出一次，顺序一致；相同区域复用regionKey，不能因类别/装修相似自动认证同地；不确定就unknown。批内可能转场，不得把一个位置机械复制给所有观察。此前判断只是解释不是观察事实。后续观察参与形成的早帧解释只能标作本批结束后可用。不要输出长篇分析。`;
const results=[];
for(const arm of ['single','batch']){
 const request=spatialJsonVlm(join(out,arm),arm==='single'?12:3,.2,true,2000);
 for(let wi=0;wi<windows.length;wi++){
  const window=windows[wi],groups=arm==='single'?window.map(r=>[r]):[window];let history=[];
  for(const group of groups){
   const begin=performance.now(),tail=group.at(-1);
   const output=await request({phase:'identity',prompt,data:{current:{id:tail.id,atMs:tail.atMs},observations:group.map(r=>({id:r.id,atMs:r.atMs,facts:facts.get(r.id)})),previousJudgments:history,knowledgeCutoffMs:tail.atMs},images:group.flatMap(r=>r.views)});
   const allowed=new Set([...history.map(r=>r.id),...group.map(r=>r.id)]);
   const valid=Array.isArray(output.observations)&&output.observations.length===group.length&&output.observations.every((r,i)=>r.id===group[i].id&&typeof r.regionKey==='string'&&typeof r.reason==='string'&&Array.isArray(r.sourceIds)&&r.sourceIds.includes(r.id)&&r.sourceIds.every(id=>allowed.has(id)));
   const result={arm,window:wi,inputIds:group.map(r=>r.id),elapsedMs:performance.now()-begin,knowledgeCutoffMs:tail.atMs,valid,output};results.push(result);
   await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));
   if(!valid)throw Error('Invalid batch output; retained, no automatic paid rerun');
   history.push(...output.observations);
   console.log(JSON.stringify({arm,window:wi,count:group.length,elapsedMs:Math.round(result.elapsedMs),valid}));
  }
 }
}
const summary=['single','batch'].map(arm=>{const rs=results.filter(r=>r.arm===arm);return {arm,calls:rs.length,observations:rs.reduce((n,r)=>n+r.inputIds.length,0),totalReasoningMs:rs.reduce((n,r)=>n+r.elapsedMs,0),maxRequestMs:Math.max(...rs.map(r=>r.elapsedMs)),windows:windows.map((_,i)=>({window:i,reasoningMs:rs.filter(r=>r.window===i).reduce((n,r)=>n+r.elapsedMs,0)}))};});
await writeFile(join(out,'summary.json'),JSON.stringify({summary,semanticQualityCertified:false,notes:'Reasoning time excludes shared perception and collection wait. Fixed finite probe does not certify sustained throughput or bounded production ingress.'},null,2));
console.log(JSON.stringify(summary));
