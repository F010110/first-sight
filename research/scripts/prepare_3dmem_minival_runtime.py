"""Build a traceable disposable adaptation, preserving upstream source unchanged."""
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'vendor/3d-mem'
OUT = ROOT / 'runs/3dmem-minival-runtime-v1'


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError('Upstream mismatch: ' + old[:60])
    return text.replace(old, new, 1)


def main():
    OUT.mkdir(parents=True, exist_ok=False)
    for name in ('src', 'cfg', 'data'):
        shutil.copytree(SOURCE / name, OUT / name, ignore=shutil.ignore_patterns('__pycache__'))
    shutil.copy2(SOURCE / 'run_aeqa_evaluation.py', OUT)
    changes = {}
    def write(relative, value):
        path = OUT / relative
        before = path.read_bytes()
        path.write_text(value, encoding='utf-8')
        changes[relative] = {'before': hashlib.sha256(before).hexdigest(), 'after': hashlib.sha256(path.read_bytes()).hexdigest()}
    scene = (OUT / 'src/scene_aeqa.py').read_text()
    scene = replace_once(scene, 'split = "train" if int(scene_id.split("-")[0]) < 800 else "val"', 'split = ""  # provided minival archive layout')
    scene = replace_once(scene, 'scene_id.split("-")[1] + ".basis.glb"', 'scene_id.split("-")[1] + ".glb"')
    scene = replace_once(scene, 'navmesh_path = os.path.join(\n            cfg.scene_data_path,\n            split,\n            scene_id,\n            scene_id.split("-")[1] + ".basis.navmesh",\n        )',
                         'navmesh_path = str(cfg.regenerated_navmesh_dir) + "/" + scene_id + ".navmesh"')
    write('src/scene_aeqa.py', scene)
    habitat = (OUT / 'src/habitat.py').read_text()
    habitat = habitat.replace('sim_cfg.scene_id = settings["scene"]', 'sim_cfg.scene_id = settings["scene"]\n    sim_cfg.gpu_device_id = -1')
    write('src/habitat.py', habitat)
    write('src/const.py', 'import os\nINVALID_SCENE_ID = []\nEND_POINT = os.environ.get("QWEN_BASE_URL", "http://localhost")\nOPENAI_KEY = os.environ.get("QWEN_API_KEY", "preflight-no-key")\n')
    api = (OUT / 'src/eval_utils_gpt_aeqa.py').read_text()
    api = replace_once(api, 'model="gpt-4o",', 'model=os.environ.get("RESEARCH_VLM_MODEL", "qwen3.8-flash"),')
    api = replace_once(api, 'max_tries = 5', 'max_tries = 1  # pilot: no automatic paid retries')
    api = api.replace('print("Error: ", e)', 'print("API error type:", type(e).__name__)')
    # Bounded total calls, including prefiltering calls, before issuing requests.
    api = replace_once(api, '    max_tries = 1  # pilot: no automatic paid retries',
                       '    global _research_calls\n    _research_calls += 1\n    if _research_calls > int(os.environ.get("RESEARCH_API_MAX_CALLS", "6")):\n        raise RuntimeError("Pilot API call budget exhausted")\n    max_tries = 1  # pilot: no automatic paid retries')
    api = '_research_calls = 0\n' + api
    write('src/eval_utils_gpt_aeqa.py', api)
    from omegaconf import OmegaConf
    config = OmegaConf.load(OUT / 'cfg/eval_aeqa.yaml')
    config.scene_data_path = str(ROOT / 'data/hm3d-minival-glb-v0.2')
    config.scene_dataset_config_path = 'default'
    config.regenerated_navmesh_dir = str(ROOT / 'runs/hm3d-minival-validation-v2-wxyz')
    config.questions_list_path = str(ROOT / 'data/hm3d-minival-eqa-subset/questions.json')
    config.output_parent_dir = str(ROOT / 'runs/3dmem-minival-results')
    config.exp_name = 'gt-api-pilot'
    # Keep camera resolution and planner/map settings unchanged initially.
    OmegaConf.save(config, OUT / 'cfg/minival.yaml')
    for name in ('yolov8x-world.pt', 'sam_l.pt'):
        source = SOURCE / name
        if source.exists():
            (OUT / name).symlink_to(source)
    report = {'runtime': str(OUT), 'changes': changes,
              'scope': 'raw-GLB/regenerated-navmesh and API backend adaptation; full original algorithm retained',
              'preflightOnly': True, 'apiMaxCallsDefault': 6,
              'missingSemantics': True, 'sourceUnmodified': True}
    (ROOT / 'reports/3dmem-minival-runtime-adaptation.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(OUT)


if __name__ == '__main__':
    main()
