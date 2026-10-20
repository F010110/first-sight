/** Only delivered language belongs on the user-facing screen, never raw assessments. */
export function projectRecording(timeline,index){
 const events=timeline.slice(0,index+1);
 const current=[...events].reverse().find(e=>e.kind==='task-created');
 return {
  frame:[...events].reverse().find(e=>e.kind==='campus-frame')?.value??null,
  questions:current?[{id:current.value.id,text:current.value.text,atMs:current.atMs}]:[],
  answers:events.filter(e=>e.kind==='message-delivered'&&current&&e.value.taskId===current.value.id).map(e=>e.value).slice(-1)
 };
}
export function projectAtTime(timeline,episodeNumber,atMs){
 const question=[...(timeline.questions??[])].reverse().find(row=>row.episodeNumber===episodeNumber&&row.atMs<=atMs)??null;
 const position=[...(timeline.positions??[])].reverse().find(row=>row.episodeNumber===episodeNumber&&row.atMs<=atMs);
 return {question,answer:question&&question.answerAtMs!==null&&question.answerAtMs<=atMs?question.answer:null,location:position?.name??'尚未判断'};
}
export function formatSampleTime(atMs){
 const seconds=Math.floor(atMs/1000);return `${String(Math.floor(seconds/3600)%24).padStart(2,'0')}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}.${Math.floor(atMs%1000/100)}`;
}
