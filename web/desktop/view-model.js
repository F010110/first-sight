/** Only delivered language belongs on the user-facing screen, never raw assessments. */
export function projectRecording(timeline,index){
 const events=timeline.slice(0,index+1);
 return {
  frame:[...events].reverse().find(e=>e.kind==='campus-frame')?.value??null,
  questions:events.filter(e=>e.kind==='task-created').map(e=>({id:e.value.id,text:e.value.text,atMs:e.atMs})),
  answers:events.filter(e=>e.kind==='message-delivered').map(e=>e.value)
 };
}
