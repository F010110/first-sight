"""Mechanical representative selection; no GT or semantic place decisions."""


def farthest_representatives(items, count, distance):
    """Deterministic farthest-first coverage, retaining actual simultaneous views."""
    if len(items) <= count:
        return list(items)
    selected = [items[0]]
    remaining = list(items[1:])
    nearest = [distance(x, selected[0]) for x in remaining]
    while remaining and len(selected) < count:
        index = max(range(len(remaining)), key=lambda i: (nearest[i], -i))
        chosen = remaining.pop(index)
        nearest.pop(index)
        selected.append(chosen)
        nearest = [min(old, distance(x, chosen)) for x, old in zip(remaining, nearest)]
    return selected


def bounded_domain(center, memberships, radius=4):
    """Finite source neighborhood, not a claim about metric/spatial boundaries.

    Never jump an unassigned gap or another place, even if that old ID returns.
    """
    if center not in memberships:
        return []
    place = memberships[center]
    result = [center]
    for step in [-1,1]:
        for delta in range(1,radius+1):
            index = center + step*delta
            if memberships.get(index) != place:
                break
            result.append(index)
    return sorted(result)
