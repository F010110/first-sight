"""One-shot tracked-source migration. Never traverses private/runtime artifacts.

Run from the repository root. The manifest preserves every moved source path.
No compatibility wrappers, source deletion, or changes to frozen run receipts.
"""
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def main():
    os.chdir(ROOT)
    manifest = Path('docs/maintenance/v2-layout-map.json')
    if manifest.exists():
        raise SystemExit('Already migrated; consult v2-layout-map.json')
    tracked = subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0')
    groups = {
        'testing': ['test-typescript.mjs', 'check-compact-live-ui.cjs',
                    'check-realtime-history.mjs', 'check-realtime-ui.mjs',
                    'test-spatial-comparison-browser.mjs', 'check-doc-links.py'],
        'maintenance': ['index-local-artifacts.py', 'reorganize_repository.py'],
        'media': ['analyze_frames.py', 'extract_frames.py', 'image_change.py',
                  'image_match.py', 'image_overlap.py', 'scene_reader.py'],
        'spatial': ['audit-spatial-visit-context.mjs', 'build-spatial-prompt-triptychs.py',
                    'compare-spatial-recall-runs.mjs', 'diagnose-spatial-graph-run.mjs',
                    'export-spatial-visit-topology.mjs', 'prepare-spatial-candidate-features.py'],
        'datasets': ['import-hssd-spatial-public.py', 'label-spatial-hssd-source.py'],
        'review': ['prepare-spatial-review.py', 'serve-spatial-run-preview.mjs'],
        'evaluation': ['run-spatial-method2.mjs', 'run-spatial-repeat-batch.mjs',
                       'score-spatial-repeat-batch.mjs'],
        'network': ['setup-lan-tls.ps1'],
    }
    mapping = {f'scripts/{name}': f'scripts/{group}/{name}'
               for group, names in groups.items() for name in names}
    # Host scripts keep peer imports together; firmware/build files stay in cam/.
    for old in tracked:
        if old.startswith('cam/') and old.count('/') == 1 and old.endswith('.py'):
            group = 'build' if old.endswith('/build_bootloader.py') else 'host'
            mapping[old] = f'cam/{group}/{Path(old).name}'
    for old in tracked:
        if old.startswith('src/desktop/') and any(Path(old).name.startswith(prefix) for prefix in
                ('experiment-', 'grade-campus-', 'run-spatial-fixed-', 'score-spatial-')):
            mapping[old] = 'src/sim/evaluation/' + Path(old).name
    texts = {}
    for name in tracked:
        if not name or name == 'TODO.md':
            continue  # user-owned unstaged historical work
        p = Path(name)
        if p.suffix not in {'.py', '.ts', '.mjs', '.cjs', '.ps1', '.md', '.ini', '.json'}:
            continue
        if p.suffix == '.json' and name != 'package.json':
            continue  # frozen manifests are not current source references
        try:
            texts[name] = p.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            continue
    for old, new in mapping.items():
        Path(new).parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['git', 'mv', '--', old, new], check=True)

    def relocate_reference(old_source, new_source, reference):
        target = os.path.normpath(str(Path(old_source).parent / reference)).replace('\\', '/')
        # TS imports use emitted .js names, source map uses .ts.
        key = target[:-3] + '.ts' if target.endswith('.js') and target[:-3] + '.ts' in mapping else target
        destination = mapping.get(key, target)
        if key.endswith('.ts') and reference.endswith('.js'):
            destination = destination[:-3] + '.js'
        result = os.path.relpath(destination, Path(new_source).parent).replace('\\', '/')
        return result if result.startswith('.') else './' + result

    for old, text in texts.items():
        new = mapping.get(old, old)
        updated = text
        if Path(old).suffix in {'.ts', '.mjs', '.cjs'}:
            updated = re.sub(r"((?:from\s*|import\s*\(|require\s*\()(['\"]))([.][^'\"]+)(\2)",
                             lambda m: m[1] + relocate_reference(old, new, m[3]) + m[4], updated)
        if Path(old).suffix == '.md':
            def link(match):
                ref = match[2]
                if re.match(r'[a-z]+:|#|/', ref):
                    return match[0]
                path, sep, anchor = ref.partition('#')
                target = os.path.normpath(str(Path(old).parent / path)).replace('\\', '/')
                if old == new and target not in mapping:
                    return match[0]
                return match[1] + relocate_reference(old, new, path) + (sep + anchor if sep else '') + match[3]
            updated = re.sub(r'(\]\()([^\s)]+)(\))', link, updated)
        # Commands, subprocesses and source inventories use root-relative paths.
        for source, dest in sorted(mapping.items(), key=lambda item: -len(item[0])):
            updated = updated.replace(source, dest)
            if source.startswith('cam/') and source.endswith('.py') and Path(old).suffix == '.py':
                updated = updated.replace('from ' + source[:-3].replace('/', '.') + ' import',
                                          'from ' + dest[:-3].replace('/', '.') + ' import')
            if source.endswith('.ts'):
                updated = updated.replace(source.replace('src/', 'dist/current/', 1).removesuffix('.ts') + '.js',
                                          dest.replace('src/', 'dist/current/', 1).removesuffix('.ts') + '.js')
        if old.startswith('scripts/') and old in mapping and old.endswith('.py'):
            updated = updated.replace('Path(__file__).resolve().parents[1]', 'Path(__file__).resolve().parents[2]')
        if old.startswith('cam/') and old in mapping:
            updated = updated.replace('Path(__file__).parent', 'Path(__file__).parent.parent')
            updated = updated.replace('pathlib.Path(__file__).parent', 'pathlib.Path(__file__).parent.parent') if 'pathlib.Path(__file__).parent.parent' not in updated else updated
        if old == 'cam/platformio.ini':
            updated = updated.replace('pre:build_bootloader.py', 'pre:build/build_bootloader.py')
        updated = updated.replace('discover -s cam -p', 'discover -s cam/host -p')
        if updated != text:
            Path(new).write_text(updated, encoding='utf-8', newline='\n')
    manifest.write_text(json.dumps({'baseline': '673a9e4', 'moves': mapping}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Migrated {len(mapping)} tracked files; runtime data and TODO untouched.')


if __name__ == '__main__':
    main()
