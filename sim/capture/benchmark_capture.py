"""Deterministic observation-rich routes, no inference dependencies."""
def add_rotation_probes(actions, move_interval, angles=None):
    if move_interval <= 0:
        return list(actions)
    if angles is not None:
        if not angles or any(not isinstance(a, (int,float)) or not 0 < abs(a) < 180 for a in angles) or abs(sum(angles) % 360) > 1e-6:
            raise ValueError('Probe angles must be unambiguous nonzero turns and restore heading (sum multiple of 360)')
        probe = [{'action': 'RotateRight' if a > 0 else 'RotateLeft', 'degrees': abs(a)} for a in angles]
    else:
        probe = ["RotateRight"] * 4
    result = list(probe)
    moves = 0
    for action in actions:
        result.append(action)
        if action == "MoveAhead":
            moves += 1
            if moves % move_interval == 0:
                result.extend(probe)
    return result

def split_recorded_turns(actions, max_step):
    """Execute real smaller Rotate actions, NOT interpolated video frames."""
    if max_step <= 0:
        return list(actions)
    if max_step >= 180:
        raise ValueError('Maximum turn step must be below 180 degrees')
    result=[]
    event=0
    for action in actions:
        name=action.get('action') if isinstance(action,dict) else action
        if name not in ['RotateLeft','RotateRight']:
            result.append(action);continue
        event+=1
        degrees=action.get('degrees',90) if isinstance(action,dict) else 90
        remaining=degrees
        while remaining>1e-6:
            step=min(max_step,remaining)
            result.append({'action':name,'degrees':step,'turn_event_id':event,'turn_event_total_degrees':degrees})
            remaining-=step
    return result
