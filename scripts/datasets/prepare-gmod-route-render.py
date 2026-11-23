"""Prepare recorded eye poses for NEW map rendering, not recovered original footage."""
import argparse
import json
from pathlib import Path

def main(root, output):
    rows=[json.loads(x) for x in (root/'trajectory.jsonl.txt').read_text(encoding='utf8').splitlines() if x.strip()]
    chosen=[]
    for row in rows:
        if chosen and row['time_s']-chosen[-1]['time_s']<1:continue
        chosen.append(row)
    result={'schema':'first-sight-gmod-route-render-request-v1','map':'rp_unioncity_day',
        'source_recording':str(root),'newly_rendered':True,'original_images_recovered':False,
        'dynamic_state_reconstructed':False,'pose_for_renderer_and_gold_only':True,
        'steps':[{'source_time_s':r['time_s'],'source_elapsed_s':r['time_s']-rows[0]['time_s'],
                  'player_position_source':r['position_source'],'eye_position_source':r['eye_position_source'],
                  'eye_angles_pyr_deg':r['eye_angles_pyr_deg']} for r in chosen]}
    output.parent.mkdir(parents=True,exist_ok=True)
    with output.open('x',encoding='utf8') as f:json.dump(result,f,ensure_ascii=False,indent=2)
    print(json.dumps({'render_steps':len(chosen),'span_s':chosen[-1]['time_s']-chosen[0]['time_s'],
                      'output':str(output),'rendered':False}))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('root',type=Path);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();main(a.root,a.output)
