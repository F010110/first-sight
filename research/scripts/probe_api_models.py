"""List Qwen endpoint model IDs without printing URLs, credentials or error bodies."""
import json
import os
from pathlib import Path
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[1]


def main():
    key = os.environ.get('QWEN_API_KEY')
    base = os.environ.get('QWEN_BASE_URL', '').rstrip('/')
    report = {'keyPresent': bool(key), 'basePresent': bool(base), 'generationCalls': 0}
    if key and base:
        url = base + '/models'
        request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + key})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                data = json.load(response)
            ids = [m['id'] for m in data.get('data', []) if isinstance(m, dict) and isinstance(m.get('id'), str)]
            report['modelIds'] = [m for m in ids if any(s in m.lower() for s in ('qwen', 'flash'))]
            report['totalModels'] = len(ids)
        except urllib.error.HTTPError as error:
            report['httpStatus'] = error.code
        except Exception as error:
            report['errorType'] = type(error).__name__
    (ROOT / 'reports/api-model-probe.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
