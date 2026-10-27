"""Single bounded synthetic image request; never prints endpoint/key/error bodies."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import time
import urllib.request
import urllib.error
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]


def main():
    image = Image.new('RGB', (192, 128), 'white')
    draw = ImageDraw.Draw(image)
    draw.rectangle((12, 28, 76, 100), fill='red')
    draw.ellipse((112, 28, 176, 100), fill='blue')
    buffer = io.BytesIO()
    image.save(buffer, format='PNG')
    png = buffer.getvalue()
    model = 'qwen3.8-flash'
    payload = {'model': model, 'max_tokens': 128, 'temperature': 0,
               'messages': [{'role': 'user', 'content': [
                   {'type': 'text', 'text': 'Describe the color and shape on the LEFT and on the RIGHT. One short sentence.'},
                   {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + base64.b64encode(png).decode()}}]}]}
    key = os.environ['QWEN_API_KEY']
    base = os.environ['QWEN_BASE_URL'].rstrip('/')
    request = urllib.request.Request(base + '/chat/completions', data=json.dumps(payload).encode(),
                                    headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    report = {'modelRequested': model, 'callsAttempted': 1, 'maxOutputTokens': 128,
              'input': 'synthetic red rectangle left, blue circle right; no project/user images',
              'imageSha256': hashlib.sha256(png).hexdigest(), 'passedTransport': False}
    start = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            result = json.load(response)
        report.update(passedTransport=True, modelReturned=result.get('model'),
                      usage=result.get('usage'), choices=result.get('choices'))
    except urllib.error.HTTPError as error:
        report['httpStatus'] = error.code
    except Exception as error:
        report['errorType'] = type(error).__name__
    report['seconds'] = round(time.monotonic() - start, 2)
    # API replies to this synthetic prompt are not credentials, but redact defensively.
    serialized = json.dumps(report, ensure_ascii=False, indent=2).replace(key, '[REDACTED]').replace(base, '[REDACTED_URL]')
    (ROOT / 'reports/api-vision-probe.json').write_text(serialized, encoding='utf-8')
    print(serialized)


if __name__ == '__main__':
    main()
