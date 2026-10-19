"""Run a categorized tool: python -m sim <tool-name> [arguments]."""
import json
import runpy
import sys
from pathlib import Path


def main():
    registry_path = Path(__file__).resolve().parents[1] / 'docs/maintenance/layout-map.json'
    registry = json.loads(registry_path.read_text(encoding='utf8'))['pythonModules']
    if len(sys.argv) < 2 or sys.argv[1] in ('--help', '-h', '--list'):
        print('Usage: python -m sim <tool-name> [arguments]\n')
        groups = {}
        for name, module in sorted(registry.items()):
            groups.setdefault(module.split('.')[1], []).append(name)
        for group, names in sorted(groups.items()):
            print(group + ':\n  ' + '\n  '.join(names))
        return
    name = sys.argv.pop(1).removesuffix('.py')
    if name not in registry:
        raise SystemExit('Unknown tool: ' + name + '. Use python -m sim --list.')
    sys.argv[0] = registry[name]
    runpy.run_module(registry[name], run_name='__main__')


if __name__ == '__main__':
    main()
