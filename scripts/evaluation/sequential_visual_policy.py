"""Pure, free-to-test evidence selection rules for the incremental diagnostic."""


def select_direction_pairs(scores, limit=4):
    options = sorted(((float(value), i, j) for i, row in enumerate(scores)
                      for j, value in enumerate(row)), key=lambda v: (-v[0], v[1], v[2]))
    selected, current_used, history_used = [], set(), set()
    for value, i, j in options:
        if i not in current_used and j not in history_used:
            selected.append((i, j))
            current_used.add(i)
            history_used.add(j)
            if len(selected) == limit:
                return selected
    for _, i, j in options:
        if (i, j) not in selected:
            selected.append((i, j))
            if len(selected) == limit:
                break
    return selected


def independent_view_support(results, min_inliers=60, min_ratio=0.35):
    passed = [r for r in results if r['inliers'] >= min_inliers and r['ratio'] >= min_ratio]
    for i, a in enumerate(passed):
        for b in passed[i + 1:]:
            if (a['currentDirection'] != b['currentDirection']
                    and a['historicalDirection'] != b['historicalDirection']
                    and a['currentSHA256'] != b['currentSHA256']
                    and a['historicalSHA256'] != b['historicalSHA256']):
                return True
    return False


def continuous_sources(previous, current, max_gap_ms=2000):
    return (previous is not None and current['ordinal'] == previous['ordinal'] + 1
            and previous.get('recordingId') == current.get('recordingId')
            and 0 < current['sourceTimeMs'] - previous['sourceTimeMs'] <= max_gap_ms)


def choose_supported_group(supported, previous_group):
    prior = supported.get(previous_group)
    if prior is not None and prior['identityConfirmed']:
        return prior
    return max(supported.values(), key=lambda c: (
        c['identityConfirmed'], c['belief'], c['anchorEvidence']['best']['inliers']))
