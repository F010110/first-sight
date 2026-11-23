"""Read-only reconstruction of saved request/output progression; not semantic grading."""
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

root = Path(sys.argv[1])
out = Path(sys.argv[2])
steps = []
for path in sorted((root / 'requests').glob('*/input.json')):
    raw = path.read_bytes()
    data = json.loads(raw)['data']
    response_path = path.parent / 'response.txt'
    response = json.loads(response_path.read_text(encoding='utf-8')) if response_path.exists() else {}
    try:
        action = json.loads(response['choices'][0]['message']['content'])
    except (KeyError, ValueError):
        action = {}
    records = data.get('history', [{}])[-1].get('result', {}).get('records', []) if data.get('history') else []
    steps.append({'request': path.parent.name, 'inputSHA256': hashlib.sha256(raw).hexdigest(),
                  'role': data.get('role'), 'fullyReadObserved': data.get('progress', {}).get('fullyRead'),
                  'previousReadPageMs': [records[0]['atMs'], records[-1]['atMs']] if records else None,
                  'promptTokens': response.get('usage', {}).get('prompt_tokens'),
                  'action': action})
research = [s for s in steps if s['role'] == 'memory-investigator']
last_notes = research[-1]['action'].get('notes') if research else None
repeated = 0
for step in reversed(research):
    if not last_notes or step['action'].get('notes') != last_notes:
        break
    repeated += 1
usage = json.loads((root / 'requests/usage.json').read_text(encoding='utf-8'))
receipt = {'schema': 'saved-investigator-trace-diagnosis-v1', 'sourceRun': str(root),
           'requests': len(steps), 'researchRequests': len(research),
           'actions': dict(Counter(s['action'].get('kind', 'no-output') for s in research)),
           'fullyReadLowerBoundFromSavedInputs': max((s['fullyReadObserved'] or 0 for s in research), default=0),
           'trailingIdenticalWorkingNotes': repeated,
           'researchPromptTokensFirstLast': [research[0]['promptTokens'], research[-1]['promptTokens']] if research else None,
           'reportProduced': any(s['action'].get('kind') == 'report' for s in research),
           'usage': usage, 'steps': steps,
           'limits': ['Progress is a lower bound: final tool result may precede a denied request and have no next input receipt',
                      'Model notes are hypotheses, not accepted event or identity judgments',
                      'Post-run changes are not validated by replaying these saved outputs']}
with out.open('x', encoding='utf-8') as handle:
    json.dump(receipt, handle, ensure_ascii=False, indent=2)
print(json.dumps({k: v for k, v in receipt.items() if k not in {'steps', 'limits'}}, ensure_ascii=False))
