"""Official match prompt with explicitly substituted Qwen judge; all 26 retained."""
import json
import os
from pathlib import Path
import re
import urllib.request
import argparse

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', default='qwen3.8-flash')
    parser.add_argument('--tag', default='qwen-judge-v1')
    args = parser.parse_args()
    if '/' in args.tag or '\\' in args.tag:
        raise ValueError('Invalid report tag')
    questions = {q['question_id']: q for q in json.loads((ROOT / 'data/hm3d-minival-eqa-subset/questions.json').read_text())}
    progress = json.loads((ROOT / 'reports/minival26-baseline-v1-progress.json').read_text())
    prompt = (ROOT / 'vendor/3dmem-aeqa-eval/prompts/mmbench.txt').read_text()
    output = ROOT / 'reports' / ('minival26-' + args.tag + '.json')
    report = json.loads(output.read_text()) if output.exists() else {
        'scope': 'Official match prompt, substituted Qwen judge; not paper GPT-4 score reproduction',
        'denominator': 26, 'judgeModel': args.model, 'rows': []}
    if report['judgeModel'] != args.model:
        raise ValueError('Cannot mix judging models in one report')
    done = {r['questionId'] for r in report['rows']}
    for execution in progress['executions']:
        qid = execution['questionId']
        if qid in done:
            continue
        q = questions[qid]
        predictions = [a.get('answer') for a in execution['answers'] if a.get('question_id') == qid]
        prediction = predictions[0] if predictions else None
        row = {'questionId': qid, 'question': q['question'], 'reference': q['answer'],
               'prediction': prediction, 'executionStatus': execution['status']}
        if not prediction:
            row.update(score=0, reason='missing prediction')
        else:
            text = prompt.format(question=q['question'], answer=q['answer'], prediction=prediction)
            payload = {'model': report['judgeModel'], 'temperature': .2, 'max_tokens': 1024,
                       'messages': [{'role': 'user', 'content': text}]}
            request = urllib.request.Request(os.environ['QWEN_BASE_URL'].rstrip('/') + '/chat/completions',
                                             data=json.dumps(payload).encode(), headers={
                                                 'Authorization': 'Bearer ' + os.environ['QWEN_API_KEY'],
                                                 'Content-Type': 'application/json'})
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    result = json.load(response)
                content = result['choices'][0]['message']['content'].strip()
                match = re.fullmatch(r'(?:Your mark:\s*)?([1-5])\s*', content)
                row.update(score=int(match.group(1)) if match else None,
                           judgeOutput=content, usage=result.get('usage'), returnedModel=result.get('model'))
            except Exception as error:
                row.update(score=None, errorType=type(error).__name__)
        report['rows'].append(row)
        scores = [r['score'] for r in report['rows'] if r['score'] is not None]
        report['finished'] = len(report['rows'])
        report['unscored'] = sum(r['score'] is None for r in report['rows'])
        report['scoreMeanRaw'] = sum(scores) / len(scores) if scores else None
        # No official SPL calculation or success-rate interpretation here.
        report['manualReviewPending'] = True
        output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
        print(qid, 'score=', row['score'], flush=True)


if __name__ == '__main__':
    main()
