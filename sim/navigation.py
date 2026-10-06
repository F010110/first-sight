"""Deterministic oracle navigation for episode collection.

Adapted from EAM (../EAM/src/eam/navigation.py). Reachability is privileged
collector information and never given to the agents under test.
"""

from collections import deque


def fixed_route(positions, start, initial_yaw, grid=0.25):
    """Walk to the farthest connected grid point and back; rotate at destination.

    Because it walks out and returns along the same path, the route naturally
    revisits rooms, which is what we want for place-recognition tests.
    Returns real movement actions (no teleport between waypoints).
    """

    def key(p):
        return (round(p["x"] / grid), round(p["z"] / grid))

    nodes = {key(p) for p in positions}
    origin = key(start)
    if origin not in nodes:
        raise ValueError("Start is not on reachable grid")
    yaw = int(round(initial_yaw / 90)) % 4
    if abs((initial_yaw / 90) - round(initial_yaw / 90)) > 1e-4:
        raise ValueError("Fixed grid route requires cardinal starting yaw")
    parent = {origin: None}
    queue = deque([origin])
    order = []
    directions = [(0, 1), (1, 0), (0, -1), (-1, 0)]
    while queue:
        node = queue.popleft()
        order.append(node)
        for dx, dz in directions:
            neighbor = (node[0] + dx, node[1] + dz)
            if neighbor in nodes and neighbor not in parent:
                parent[neighbor] = node
                queue.append(neighbor)
    target = order[-1]
    path = []
    current = target
    while current is not None:
        path.append(current)
        current = parent[current]
    path.reverse()
    walk = path + list(reversed(path[:-1]))
    actions = []
    for i, (a, b) in enumerate(zip(walk, walk[1:])):
        if i == len(path) - 1:
            actions.extend(["RotateRight"] * 4)
        heading = directions.index((b[0] - a[0], b[1] - a[1]))
        turns = (heading - yaw) % 4
        actions.extend(["RotateLeft"] if turns == 3 else ["RotateRight"] * turns)
        yaw = heading
        actions.append("MoveAhead")
    return actions
