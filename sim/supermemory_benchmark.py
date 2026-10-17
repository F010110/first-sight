"""SuperMemory-VQA request/answer isolation and deterministic prediction scoring.
Does not generate predictions, download video, or treat annotation evidence as retrieval input.
"""
import argparse
import json
from pathlib import Path
from salad_features import sha

UNANSWERABLE='This question can not be answered.'

def export(source, output):
    rows=json.loads(source.read_text(encoding='utf8')); output.mkdir(parents=True,exist_ok=False); (output/'evaluation-only').mkdir()
    requests=[]; truth=[];seen=set()
    for row in rows:
        qid=str(row['question_id']);choices=row['choices'];correct=row['correct_option_index']
        if qid in seen or len(choices)!=4 or not 0<=correct<4 or choices[correct]!=row['correct_answer'] or choices.count(UNANSWERABLE)!=1:raise ValueError('Unexpected QA schema')
        seen.add(qid)
        # No video_ids, evidence spans, room labels, category labels or answerability flags.
        requests.append({'id':qid,'subject':row['subject'],'question':row['question'],'choices':choices})
        truth.append({'id':qid,'correctIndex':correct,'answerable':row['is_answerable'],'unanswerableIndex':choices.index(UNANSWERABLE),'sourceAnnotation':row})
    (output/'requests.jsonl').write_text('\n'.join(map(json.dumps,requests))+'\n')
    (output/'evaluation-only'/'truth.jsonl').write_text('\n'.join(map(json.dumps,truth))+'\n')
    (output/'complete.json').write_text(json.dumps({'questions':len(rows),'sourceSha256':sha(source),'predictionCalls':0,'note':'QA adapter only, no memory input or model performance. Before replay, derive and validate question clock and per-video causal scope from official protocol; no annotation evidence hints to agent.'},indent=2))

def score(truth_path,predictions_path,output):
    truth={r['id']:r for r in map(json.loads,truth_path.read_text().splitlines())};predictions=[json.loads(l) for l in predictions_path.read_text().splitlines()]
    if len({p['id'] for p in predictions})!=len(predictions) or {p['id'] for p in predictions}!=set(truth):raise ValueError('Exactly one prediction per QA is required; no selective scoring')
    correct=tp=fp=fn=wrong_abstain=unsupported_answer=0
    for pred in predictions:
        i=pred['choiceIndex'];r=truth[pred['id']]
        if isinstance(i,bool) or not isinstance(i,int) or not 0<=i<4:raise ValueError('Invalid option index')
        correct+=i==r['correctIndex'];answers=i!=r['unanswerableIndex'];actual=r['answerable']
        tp+=answers and actual;fp+=answers and not actual;fn+=not answers and actual
        wrong_abstain+=not answers and actual;unsupported_answer+=answers and not actual
    result={'questions':len(truth),'qaAccuracy':correct/len(truth) if truth else None,'answerableF1':2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else 0,'wrongAbstentions':wrong_abstain,'answersOnUnanswerable':unsupported_answer,'qaMRR':None,'note':'No MRR without full ranked option scores; choice accuracy is not free-form answer accuracy.'}
    with output.open('x') as stream:json.dump(result,stream,indent=2)
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser();s=p.add_subparsers(dest='command',required=True)
    e=s.add_parser('export');e.add_argument('source',type=Path);e.add_argument('output',type=Path)
    q=s.add_parser('score');q.add_argument('truth',type=Path);q.add_argument('predictions',type=Path);q.add_argument('output',type=Path)
    a=p.parse_args()
    if a.command=='export':export(a.source,a.output)
    else:print(json.dumps(score(a.truth,a.predictions,a.output)))
