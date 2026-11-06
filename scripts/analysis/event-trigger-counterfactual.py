#!/usr/bin/env python3
"""Causal counterfactual for the "do not judge every 8s window" proposal.

Question: on an already-recorded trajectory, how many full spatial judgments would a
schedule need if it judged only some windows, and what does each cheap signal cost in
missed reference place changes?

Inputs (all local, no API calls):
  --run     a completed spatial-memory run with schema-v4 SQLite (facts per observation)
  --source  the public-source.json the run was produced from
  --sample  the reference sample.json (annotations used only for evaluation)
  --out     directory for the JSON artifacts

Signals are causal: window facts, the current tail image, the last judged tail image,
and the number of windows since the last judgment. Reference annotations are never an
input to the policy. Reference place changes are only used to score a policy.

Outputs:
  signals.json  per-window causal signals and reference change flags
  report.json   signal AUCs plus fixed-stride and detector-policy trade-offs

Usage:
  .venv/Scripts/python.exe scripts/analysis/event-trigger-counterfactual.py \
    --run run/unioncity-memory-full813-v2 \
    --source run/gmod-annotated-rerender-v2-final/public-source.json \
    --sample run/gmod-annotated-rerender-v2-final/sample.json \
    --out run/event-trigger-813
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3

import cv2
import numpy as np

WINDOW_MS = 8000
PROJECT_MS = 2000
TRANSITION = ['门口', '入口', '出口', '楼梯', '台阶', '阶梯', '闸机', '检票', '通道', '走廊',
              '拐角', '转角', '路口', '斑马线', '横穿', '穿过', '跨越', '电梯', '扶手', '卷帘门',
              '栅栏', '栏杆', '街道', '人行道', '车道', '马路', '室外', '室内', '站台', '站厅']


def load(run, source, sample_path):
    src = json.load(open(source, encoding='utf-8'))['observations']
    sample = json.load(open(sample_path, encoding='utf-8'))
    c = sqlite3.connect(os.path.join(run, 'spatial.sqlite'))
    facts = {oid: (json.loads(raw) if raw else None) for oid, raw in c.execute('select id,facts from observations')}
    c.close()
    return src, sample, facts


def thumb(path):
    img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise SystemExit('cannot read ' + path)
    img = cv2.resize(img, (32, 32), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    hist = np.histogram(img, bins=16, range=(0, 1))[0].astype(np.float32)
    hist /= max(1.0, hist.sum())
    return img, hist


def sift():
    return cv2.SIFT_create(nfeatures=2500)


def sift_inliers(matcher, a_path, b_path):
    """SIFT+RANSAC inliers: 0 if the pair cannot be verified, never a positive match."""
    a = cv2.imread(a_path, cv2.IMREAD_GRAYSCALE)
    b = cv2.imread(b_path, cv2.IMREAD_GRAYSCALE)
    ka, da = matcher.detectAndCompute(a, None)
    kb, db = matcher.detectAndCompute(b, None)
    if da is None or db is None or len(ka) < 8 or len(kb) < 8:
        return 0
    pair = cv2.BFMatcher(cv2.NORM_L2).knnMatch(da, db, k=2)
    good = [m for m, n in ((p[0], p[1]) for p in pair if len(p) == 2) if m.distance < 0.75 * n.distance]
    if len(good) < 8:
        return 0
    src_pts = np.float32([ka[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst_pts = np.float32([kb[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    _, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
    return int(mask.sum()) if mask is not None else 0


def bigrams(text):
    t = ''.join(ch for ch in text if not ch.isspace())
    return {t[i:i + 2] for i in range(max(0, len(t) - 1))}


def text_similarity(a, b):
    A, B = bigrams(a), bigrams(b)
    return 0.0 if not A or not B else len(A & B) / len(A | B)


def build_rows(src, sample, facts):
    frames = {f['id']: f for f in sample['frames']}
    buckets = {}
    for i, o in enumerate(src):
        buckets.setdefault((i * PROJECT_MS) // WINDOW_MS, []).append(i)

    rows = []
    for w in sorted(buckets):
        idxs = buckets[w]
        text = ' '.join(
            facts[src[i]['id']].get('summary', '') + ' ' + ' '.join(facts[src[i]['id']].get('details', []))
            for i in idxs if facts.get(src[i]['id'])
        )
        tail_path = next(v['path'] for v in src[idxs[-1]]['views'] if v['direction'] == 'front')
        places = [frames[src[i]['id']]['annotation']['placeId'] for i in idxs]
        prev_place = frames[src[idxs[0] - 1]['id']]['annotation']['placeId'] if idxs[0] > 0 else None
        internal = any(places[j] != places[j - 1] for j in range(1, len(places)))
        rows.append({
            'w': w,
            'frames': [src[i]['id'] for i in idxs],
            'text': text,
            'cues': {word for word in TRANSITION if word in text},
            'tail': tail_path,
            'ref_places': places,
            'ref_change': bool(internal or (prev_place is not None and places[0] != prev_place)),
        })

    matcher = sift()
    for i, r in enumerate(rows):
        r['layout_prev'] = r['hist_prev'] = r['text_sim_prev'] = None
        r['new_cue'] = []
        r['sift_prev'] = None
        if i == 0:
            continue
        p = rows[i - 1]
        a_img, a_hist = thumb(p['tail'])
        b_img, b_hist = thumb(r['tail'])
        r['layout_prev'] = float(np.abs(a_img - b_img).mean())
        r['hist_prev'] = float(1.0 - np.minimum(a_hist, b_hist).sum())
        r['text_sim_prev'] = text_similarity(p['text'], r['text'])
        r['new_cue'] = sorted(r['cues'] - p['cues'])
        r['sift_prev'] = sift_inliers(matcher, p['tail'], r['tail'])

    revisits = sorted({(rv['returnIndex'] * PROJECT_MS) // WINDOW_MS for rv in sample.get('revisits', [])})
    return rows, revisits


def auc(values, labels):
    """P(random positive outranks random negative); 0.5 means no separation."""
    pairs = sorted(zip(values, labels))
    rank = {}
    i = 0
    while i < len(pairs):
        j = i
        while j + 1 < len(pairs) and pairs[j + 1][0] == pairs[i][0]:
            j += 1
        r = (i + j) / 2 + 1
        for k in range(i, j + 1):
            rank[k] = r
        i = j + 1
    pos = [k for k, (_, y) in enumerate(pairs) if y]
    neg = [k for k, (_, y) in enumerate(pairs) if not y]
    if not pos or not neg:
        return None
    s = sum(rank[p] for p in pos)
    return round((s - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)), 3)


def quantiles(values):
    if not values:
        return None
    s = sorted(values)
    def q(p):
        k = (len(s) - 1) * p
        i = int(k)
        j = min(i + 1, len(s) - 1)
        return round(float(s[i] + (s[j] - s[i]) * (k - i)), 3)
    return {'min': round(float(s[0]), 3), 'p25': q(.25), 'p50': q(.5), 'p75': q(.75), 'p90': q(.9), 'max': round(float(s[-1]), 3)}


def fixed_stride(rows, changes, revisits, stride):
    """Judge every stride-th sealed window. Every reference change is inside the evidence
    of the next judgment by construction; staleness is bounded by stride-1 windows."""
    triggers = set(range(0, len(rows), stride))
    # A change at w is seen by the first triggered window at or after w.
    def seen_by(w):
        t = next((k for k in sorted(triggers) if k >= w), None)
        return t is not None and t - w <= stride - 1
    missed = [w for w in changes if not seen_by(w)]
    missed_revisits = [w for w in revisits if not seen_by(w)]
    return {
        'kind': 'fixed-stride', 'stride': stride, 'triggers': len(triggers),
        'reduction': round(1 - len(triggers) / len(rows), 3),
        'max_staleness_windows': stride - 1,
        'missed_place_changes': len(missed), 'missed_revisits': missed_revisits,
    }


def detector_policy(rows, changes, revisits, *, hist_tau, gap, use_sift, sift_tau, use_text, text_tau, use_cue):
    """Sequential causal policy: judge when a signal fires or the max gap is reached."""
    triggers, last = [], None
    for r in rows:
        why = []
        if last is None:
            why.append('first')
        else:
            if len(triggers) and r['w'] - last >= gap:
                why.append('max-gap')
            if use_cue and r['new_cue']:
                why.append('cue')
            if use_text and r['text_sim_prev'] is not None and r['text_sim_prev'] < text_tau:
                why.append('text')
            if hist_tau is not None and r['hist_prev'] is not None and r['hist_prev'] > hist_tau:
                why.append('hist')
            if use_sift and r['sift_prev'] is not None and r['sift_prev'] < sift_tau:
                why.append('sift')
        if why:
            triggers.append(r['w'])
            last = r['w']
    trigger_set = set(triggers)
    def covered(w):
        return w in trigger_set or (w + 1) in trigger_set
    missed = [w for w in changes if not covered(w)]
    missed_revisits = [w for w in revisits if not covered(w)]
    gaps = [b - a - 1 for a, b in zip(triggers, triggers[1:])]
    return {
        'kind': 'detector', 'hist_tau': hist_tau, 'sift_tau': sift_tau, 'text_tau': text_tau,
        'use_sift': use_sift, 'use_text': use_text, 'use_cue': use_cue, 'gap': gap,
        'triggers': len(triggers), 'reduction': round(1 - len(triggers) / len(rows), 3),
        'missed_place_changes': len(missed), 'missed_change_windows': missed,
        'missed_revisits': missed_revisits, 'max_unjudged_gap': max(gaps) if gaps else None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--run', required=True)
    ap.add_argument('--source', required=True)
    ap.add_argument('--sample', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    src, sample, facts = load(args.run, args.source, args.sample)
    rows, revisits = build_rows(src, sample, facts)
    changes = [r['w'] for r in rows if r['ref_change']]

    signal_rows = rows[1:]
    labels = [r['ref_change'] for r in signal_rows]
    aucs = {
        'hist_prev(higher=change)': auc([r['hist_prev'] for r in signal_rows], labels),
        'layout_prev(higher=change)': auc([r['layout_prev'] for r in signal_rows], labels),
        'text_sim_prev(lower=change)': auc([-r['text_sim_prev'] for r in signal_rows], labels),
        'new_cue(higher=change)': auc([1.0 if r['new_cue'] else 0.0 for r in signal_rows], labels),
        'sift_prev(lower=change)': auc([-r['sift_prev'] for r in signal_rows], labels),
    }

    policies = [fixed_stride(rows, changes, revisits, s) for s in (1, 2, 3, 4, 6)]
    half = len(rows) // 2
    grid = []
    for hist_tau in (None, 0.30, 0.38, 0.46, 0.54, 0.62):
        for text_tau in (None, 0.08, 0.11, 0.14):
            for gap in (2, 3, 4, 5, 6, 8):
                for use_cue in (True, False):
                    grid.append(detector_policy(rows, changes, revisits, hist_tau=hist_tau, gap=gap,
                                                use_sift=True, sift_tau=4, use_text=text_tau is not None,
                                                text_tau=text_tau, use_cue=use_cue))
    grid.sort(key=lambda r: (r['missed_place_changes'], r['triggers']))

    # Held-out halves: pick the best zero-miss policy on one half, report it on the other.
    # The full-trajectory frontier above is in-sample and therefore optimistic.
    def subset(part):
        lo, hi = part[0]['w'], part[-1]['w']
        return [w for w in changes if lo <= w <= hi], [w for w in revisits if lo <= w <= hi]

    holdout = []
    for name, fit_part, test_part in (('first-half->second', rows[:half], rows[half:]),
                                      ('second-half->first', rows[half:], rows[:half])):
        fit_changes, fit_revisits = subset(fit_part)
        test_changes, test_revisits = subset(test_part)
        fit = [r for r in grid if r['kind'] == 'detector' and r['triggers'] >= len(fit_part) // 2]
        # Re-run on the fit half (the grid was computed on the whole trajectory).
        candidates = []
        for hist_tau in (None, 0.30, 0.38, 0.46, 0.54, 0.62):
            for text_tau in (None, 0.08, 0.11, 0.14):
                for gap in (2, 3, 4, 5, 6, 8):
                    for use_cue in (True, False):
                        candidates.append(detector_policy(fit_part, fit_changes, fit_revisits, hist_tau=hist_tau, gap=gap,
                                                          use_sift=True, sift_tau=4, use_text=text_tau is not None,
                                                          text_tau=text_tau, use_cue=use_cue))
        good = [r for r in candidates if r['missed_place_changes'] == 0 and r['missed_revisits'] == []]
        if not good:
            holdout.append({'split': name, 'fit': None, 'note': 'no zero-miss policy on the fit half'})
            continue
        best = max(good, key=lambda r: r['reduction'])
        test = detector_policy(test_part, test_changes, test_revisits, hist_tau=best['hist_tau'], gap=best['gap'],
                               use_sift=best['use_sift'], sift_tau=best['sift_tau'], use_text=best['use_text'],
                               text_tau=best['text_tau'], use_cue=best['use_cue'])
        holdout.append({'split': name, 'fit': {k: best[k] for k in ('hist_tau', 'text_tau', 'gap', 'reduction', 'triggers')},
                        'test': {k: test[k] for k in ('reduction', 'triggers', 'missed_place_changes', 'missed_revisits')}})

    report = {
        'windows': len(rows),
        'place_change_windows': len(changes),
        'revisit_return_windows': revisits,
        'signal_auc': aucs,
        'signal_quantiles': {
            'hist_prev': quantiles([r['hist_prev'] for r in signal_rows]),
            'sift_prev': quantiles([r['sift_prev'] for r in signal_rows]),
            'text_sim_prev': quantiles([r['text_sim_prev'] for r in signal_rows]),
        },
        'fixed_stride': policies,
        'detector_policies_best': grid[:8],
        'detector_holdout': holdout,
        'note': 'Causal signals only; reference annotations used for scoring, never as policy input.',
    }
    with open(os.path.join(args.out, 'signals.json'), 'w', encoding='utf-8') as fh:
        json.dump({'rows': [{k: v for k, v in r.items() if k != 'cues'} for r in rows], 'referenceChanges': changes}, fh, ensure_ascii=False)
    with open(os.path.join(args.out, 'report.json'), 'w', encoding='utf-8') as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
