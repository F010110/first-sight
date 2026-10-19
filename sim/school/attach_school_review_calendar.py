"""Attach assumed calendar DISPLAY metadata; preserve review fingerprint/records."""
import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path


def attach(root, clock_file):
    data = json.loads((root / 'data.json').read_text(encoding='utf8'))
    source = json.loads(clock_file.read_text(encoding='utf8'))
    clock = source['clock']
    anchor = datetime.fromisoformat(clock['wallOrigin'])
    if anchor.tzinfo is None or clock['kind'] != 'assumed':
        raise ValueError('This sample requires explicitly assumed, timezone-aware dates')
    dates = {r['id']: r['recordedTime'] for r in source['observations']}
    if set(dates) != {s['id'] for s in data['samples']}:
        raise ValueError('Calendar observations do not match review package')
    episodes = {}
    for sample in data['samples']:
        expected = anchor + timedelta(milliseconds=sample['activityAtMs']-clock['sourceOriginMs'])
        if expected != datetime.fromisoformat(dates[sample['id']]):
            raise ValueError('Calendar mapping mismatch')
        zero = expected - timedelta(milliseconds=sample['sourceAtMs'])
        value = int(round(zero.timestamp()*1000))
        key = str(sample['episode'])
        if key in episodes and episodes[key] != value:
            raise ValueError('Nonlinear source-to-calendar mapping')
        episodes[key] = value
    payload = {'protocol': 'school-assumed-calendar-v1', 'fingerprint': data['fingerprint'],
               'kind': 'assumed', 'offsetMinutes': clock['offsetMinutes'],
               'anchor': clock['wallOrigin'], 'episodeSourceZeroWallMs': episodes,
               'warning': '用户授权假设日期，非真实拍摄日期；跨段空白仍保持原间隔。'}
    target = root / 'calendar.json'
    if target.exists():
        raise ValueError('Calendar already attached; do not silently replace assumed dates')
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf8')


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('root', type=Path); p.add_argument('clock', type=Path)
    a = p.parse_args(); attach(a.root, a.clock)
