import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {readFile,readdir,mkdir,writeFile,realpath} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
class HttpError extends Error{constructor(readonly status:number,message:string){super(message);}}
type Review={revision:number;datasetSHA256:string;targetType:'observation'|'segment'|'revisit';targetId:string;status:'approved'|'needs-change'|'uncertain';note:string;correctedDescription?:string;correctedLabel?:string;at:string};

/** Oracle-only, loopback-only review service. No model imports, game control or evaluation APIs. */
export async function createAnnotationReviewServer(rootArg:string,webRoot=resolve('web/annotation-review')){
 const root=await realpath(rootArg),sampleBytes=await readFile(join(root,'sample.json'));
 const integrity=JSON.parse(await readFile(join(root,'integrity.json'),'utf8'));
 const datasetSHA256=hash(sampleBytes);if(datasetSHA256!==integrity.sampleSHA256)throw Error('Annotation base changed');
  const sample=JSON.parse(sampleBytes.toString('utf8'));
  let memoryCases:any[]|null=null;
  if(sample.provenance?.memoryEvaluation){const bytes=await readFile(join(root,'memory-cases.json'));if(hash(bytes)!==sample.provenance.memoryCasesSHA256)throw Error('Memory evaluation changed');memoryCases=JSON.parse(bytes.toString());}
 if(sample.schema!=='unioncity-annotation-review-v1'||!sample.provenance?.oracleOnly||!Array.isArray(sample.frames)||!sample.frames.length)throw Error('Invalid oracle review bundle');
 const bindingFile=JSON.parse(await readFile(join(root,'bindings.json'),'utf8'));
 const allowedImageRoot=await realpath(bindingFile.allowedImageRoot);
 const ids={observation:new Set<string>(sample.frames.map((f:any)=>f.id)),segment:new Set<string>(sample.segments.map((s:any)=>s.id)),revisit:new Set<string>(sample.revisits.map((r:any)=>r.id))};
 const imageBindings=new Map<string,{path:string;sha256:string}>();
 for(const frame of sample.frames)for(const direction of ['front','left','right']){
  const key=frame.id+'/'+direction,b=bindingFile.bindings[key];
  if(!b||!/^[a-f0-9]{64}$/.test(b.sha256)||frame.views[direction]!=='/image/'+key)throw Error('Missing image binding');
  const path=await realpath(b.path),rel=relative(allowedImageRoot,path);
  if(rel.startsWith('..')||isAbsolute(rel))throw Error('Image outside allowed original root');
  imageBindings.set(key,{path,sha256:b.sha256});
 }
 const maps=new Map<string,Buffer>();
 for(const layer of sample.map.layers){
  if(!/^[a-z]+$/.test(layer.id))throw Error('Invalid map id');
  const bytes=await readFile(join(root,`map-${layer.id}.png`));if(hash(bytes)!==integrity.maps[layer.id])throw Error('Map changed');maps.set(layer.id,bytes);
 }
 const reviewsRoot=join(root,'reviews');await mkdir(reviewsRoot,{recursive:true});
 const reviews:Review[]=[];
 const files=(await readdir(reviewsRoot)).filter(f=>/^review-\d{6}\.json$/.test(f)).sort();
 if(files.length>10000)throw Error('Review journal limit');
 for(const file of files){const review=JSON.parse(await readFile(join(reviewsRoot,file),'utf8'));if(review.datasetSHA256!==datasetSHA256||review.revision!==reviews.length+1||!ids[review.targetType as keyof typeof ids]?.has(review.targetId))throw Error('Invalid review journal');reviews.push(review);}
 const token=randomBytes(24).toString('hex');let writes=Promise.resolve();
 const send=(res:ServerResponse,status:number,type:string,body:string|Buffer)=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; img-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});res.end(body);};
 const json=(res:ServerResponse,status:number,value:unknown)=>send(res,status,'application/json; charset=utf-8',JSON.stringify(value));
 async function readBody(req:IncomingMessage){let raw='';for await(const chunk of req){raw+=chunk.toString('utf8');if(Buffer.byteLength(raw)>32000)throw new HttpError(413,'Review body too large');}try{return JSON.parse(raw);}catch{throw new HttpError(400,'Invalid JSON');}}
 const server=createServer((req,res)=>{void(async()=>{
  const host=req.headers.host??'';
  if(!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host))throw new HttpError(403,'Loopback host required');
  const url=new URL(req.url??'/',`http://${host}`),path=url.pathname;
  if(req.method==='POST'&&path==='/api/reviews'){
   if(sample.reviewRequired===false)throw new HttpError(405,'This completed annotation bundle is read-only');
   if(req.headers.origin!==`http://${host}`||req.headers['x-review-token']!==token||!req.headers['content-type']?.startsWith('application/json'))throw new HttpError(403,'Same-origin review authorization required');
   const body=await readBody(req);
   const operation=writes.then(async()=>{
    if(!body||typeof body!=='object'||Object.keys(body).some(k=>!['expectedRevision','targetType','targetId','status','note','correctedDescription','correctedLabel'].includes(k)))throw new HttpError(400,'Invalid review fields');
    if(body.expectedRevision!==reviews.length)throw new HttpError(409,'Review revision changed; reload before saving');
    if(!['observation','segment','revisit'].includes(body.targetType)||!ids[body.targetType as keyof typeof ids].has(body.targetId)||!['approved','needs-change','uncertain'].includes(body.status)||typeof body.note!=='string'||body.note.length>4000)throw new HttpError(400,'Invalid review target/status/note');
    for(const [key,max] of [['correctedDescription',1200],['correctedLabel',160]] as const)if(body[key]!==undefined&&(typeof body[key]!=='string'||body[key].length>max))throw new HttpError(400,'Invalid correction');
     if(body.targetType!=='observation'&&body.correctedDescription!==undefined)throw new HttpError(400,'Descriptions can only be corrected per observation');
     if(memoryCases&&(body.targetType!=='observation'||body.correctedDescription!==undefined||body.correctedLabel!==undefined))throw new HttpError(400,'Memory review records verdicts only; it cannot change source annotations');
    if(reviews.length>=10000)throw new HttpError(409,'Review journal limit reached');
    const review:Review={revision:reviews.length+1,datasetSHA256,targetType:body.targetType,targetId:body.targetId,status:body.status,note:body.note,...body.correctedDescription!==undefined?{correctedDescription:body.correctedDescription}:{},...body.correctedLabel!==undefined?{correctedLabel:body.correctedLabel}:{},at:new Date().toISOString()};
    await writeFile(join(reviewsRoot,`review-${String(review.revision).padStart(6,'0')}.json`),JSON.stringify(review,null,2),{flag:'wx'});reviews.push(review);return review;
   });
   writes=operation.then(()=>{},()=>{});const review=await operation;json(res,200,{revision:reviews.length,review});return;
  }
  if(req.method!=='GET')throw new HttpError(405,'Read-only except explicit review saves');
   if(path==='/api/sample'){json(res,200,{sample,datasetSHA256,reviews,revision:reviews.length,reviewToken:token});return;}
   if(path==='/api/memory'){
    if(!memoryCases)throw new HttpError(404,'No spatial memory evaluation attached');
    const id=url.searchParams.get('id'),item=memoryCases.find(c=>c.id===id);if(!item)throw new HttpError(404,'Unknown memory state');
    let verdict:any=null;try{verdict=JSON.parse(await readFile(join(root,'grades',item.id+'.json'),'utf8'));if(verdict.casesSHA256!==sample.provenance.memoryCasesSHA256)throw new HttpError(409,'Grade binding changed');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    json(res,200,{...item,images:undefined,grade:verdict?.grade??null,error:verdict?.error??null,authority:'Model verdict is provisional; human reviews are independent',hasSpatialGraph:false});return;
   }
  if(path==='/api/export'){res.setHeader('Content-Disposition','attachment; filename="unioncity-reviewed-annotations.json"');json(res,200,{schema:'unioncity-reviewed-annotations-v1',datasetSHA256,base:sample,reviews,revision:reviews.length});return;}
  if(path.startsWith('/image/')){
   const binding=imageBindings.get(path.slice(7));if(!binding)throw new HttpError(404,'Unknown image');
   const actual=await realpath(binding.path),rel=relative(allowedImageRoot,actual);if(rel.startsWith('..')||isAbsolute(rel)||actual!==binding.path)throw new HttpError(409,'Original image path changed');
   const bytes=await readFile(actual);if(hash(bytes)!==binding.sha256)throw new HttpError(409,'Original image changed');send(res,200,'image/png',bytes);return;
  }
  const match=/^\/map\/([a-z]+)\.png$/.exec(path);if(match){const bytes=maps.get(match[1]!);if(!bytes)throw new HttpError(404,'Unknown map');send(res,200,'image/png',bytes);return;}
   const assets:Record<string,[string,string]>={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/memory.html':['memory.html','text/html; charset=utf-8'],'/memory.js':['memory.js','text/javascript; charset=utf-8'],'/memory.css':['memory.css','text/css; charset=utf-8']};
  const asset=assets[path];if(!asset)throw new HttpError(404,'Not found');send(res,200,asset[1],await readFile(join(webRoot,asset[0])));
 })().catch(error=>{if(!res.headersSent)json(res,error instanceof HttpError?error.status:500,{error:error instanceof HttpError?error.message:'Review service could not complete request'});else res.end();});});
 return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [root,portArg='8891']=process.argv.slice(2);const port=Number(portArg);
 if(!root||!Number.isInteger(port)||port<1024||port>65535)throw Error('Usage: annotation-review-server ROOT [PORT]');
 const server=await createAnnotationReviewServer(resolve(root));server.listen(port,'127.0.0.1',()=>console.log(`Annotation review (oracle only, no model calls): http://127.0.0.1:${port}/`));
}
