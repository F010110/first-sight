"""One-shot, manifest-backed source layout migration (no runtime data deletion).

Run from repository root. Preserves file bytes on moves, then applies mechanical
Python import / command / template relocations and TS relative import rewrites.
The old->new map is retained in docs/maintenance/layout-map.json.
"""
import ast
import json
import os
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def category(name):
    n = name.removeprefix('test_')
    if any(s in n for s in ['hssd', 'habitat']): return 'hssd'
    if any(s in n for s in ['school', 'activity']): return 'school'
    if any(s in n for s in ['review_portal', 'region_review', 'review_kit', 'dense_review', 'view_videos']): return 'review'
    if any(s in n for s in ['mansion', 'thor', 'episode', 'navigation', 'side_views', 'evaluation_captures', 'derive_motion', 'benchmark_capture', 'wide_angle']): return 'capture'
    if any(s in n for s in ['memory_evaluation', 'memory_provenance', 'memory_repair', 'locked_protocol', 'interleaved', 'inspect_repair', 'memory_final', 'spatial_oracle', 'window_context']): return 'evaluation'
    if any(s in n for s in ['group', 'boundary', 'identity_annotation', 'fixed_region', 'open_living', 'retrospective', 'temporal_classification', 'research_snapshot']): return 'grouping'
    if any(s in n for s in ['salad', 'anyloc', 'learned_recall', 'diverse', 'visual_recall', 'visual_features', 'geometry', 'spatial_gate', 'spatial_evidence', 'spatial_http', 'spatial_dev', 'spatial_runtime', 'spatial_calibration', 'three_view', 'rotation', 'motion_evidence', 'heading', 'segment_evidence', 'visual_memory', 'visual_pipeline', 'cached_visual', 'temporal_text']): return 'spatial'
    if any(s in n for s in ['home_', 'window_vlm', 'window_thinking', 'single_observation', 'dense_context', 'multi_context', 'anchor_recovery']): return 'context'
    return 'benchmarks'


def main():
    os.chdir(ROOT)
    manifest = ROOT / 'docs/maintenance/layout-map.json'
    if manifest.exists(): raise SystemExit('Migration already applied; consult layout-map.json')
    mapping = {}
    for p in Path('sim').iterdir():
        if not p.is_file(): continue
        if p.name == 'README.md': mapping[p.as_posix()] = 'docs/archive/simulator-original-guide.md'
        elif p.suffix == '.ps1': mapping[p.as_posix()] = 'scripts/evaluation/' + p.name
        elif p.name.startswith('test_'): mapping[p.as_posix()] = 'tests/python/' + p.name
        else: mapping[p.as_posix()] = f'sim/{category(p.stem)}/{p.name}'
    # Keep common QA dependencies beside the current evaluation entry points.
    evaluation = {'interleaved-memory-evaluation','interleaved-memory-schedule','memory-answer-repair','memory-evaluation-grade','memory-evaluation-session','spatial-memory-evaluation-session','current-evidence-session','locked-answer-repair','memory-provenance-evaluation','memory-evaluation','repair-memory-protocol-locked','retry-memory-evaluation','run-memory-evaluation','prepare-school-calendar','grade-inspect-probe','probe-inspect-repair','diagnose-memory-runtime','probe-default-summary','probe-spatial-protocol-repair'}
    for p in Path('src/sim').glob('*.ts'):
        stem=p.stem.removesuffix('.test')
        group='evaluation' if stem in evaluation else 'development' if 'dev-' in stem or stem=='spatial-sqlite-migrate' else 'replay'
        mapping[p.as_posix()]=f'src/sim/{group}/{p.name}'
    for name in ['docs/notes/suggestions/建议9.md','docs/notes/suggestions/建议10.md']:
        mapping[name]='docs/notes/suggestions/'+name
    for name in ['docs/requirements/First-Sight 软件需求分析说明书.md','docs/requirements/First-Sight 软件需求分析说明书.pdf']:
        mapping[name]='docs/requirements/'+name
    # Historical application status reports no longer serve as the current manual.
    active={'mobile-trial.md','memory-clock-and-calendar.md','long-term-memory-v1.md','long-term-memory-v1.json','spatial-context-refactor.md','spatial-graph-human-audit.md','inspect-repair-full90-results.md'}
    for p in Path('docs/application').iterdir():
        if p.is_file() and p.name not in active: mapping[p.as_posix()]='docs/archive/application-history/'+p.name
    py_modules={Path(old).stem:Path(new).with_suffix('').as_posix().replace('/','.') for old,new in mapping.items() if old.startswith('sim/') and old.endswith('.py')}
    ts_paths={str((ROOT/old).resolve()):new for old,new in mapping.items() if old.endswith('.ts')}
    # Capture all textual references before relocating files.
    texts={}
    for base in ['src','sim','scripts','tests','docs']:
        if not Path(base).exists(): continue
        for p in Path(base).rglob('*'):
            if p.is_file() and p.suffix in {'.py','.ts','.mjs','.html','.md','.json','.ps1'}:
                try:texts[p.as_posix()]=p.read_text(encoding='utf8')
                except UnicodeDecodeError:print('Preserve non-UTF8 file without rewriting:',p)
    for name in ['README.md','TODO.md','package.json']:
        texts[name]=Path(name).read_text(encoding='utf8')
    # git mv is intentional: all preexisting work was committed before migration.
    for old,new in mapping.items():
        destination=Path(new)
        if destination.exists(): raise ValueError('Destination exists: '+new)
        destination.parent.mkdir(parents=True,exist_ok=True)
        subprocess.run(['git','mv','--',old,new],check=True)
    for old,text in texts.items():
        new=mapping.get(old,old); p=Path(new); updated=text
        if p.suffix=='.py':
            # Rewrite only real import statements (including imports inside functions).
            tree=ast.parse(text); spans=[]; offsets=[0]
            for line in text.splitlines(keepends=True): offsets.append(offsets[-1]+len(line))
            for node in ast.walk(tree):
                if isinstance(node,ast.ImportFrom) and node.level==0 and node.module in py_modules:
                    start=offsets[node.lineno-1]+len(text.splitlines()[node.lineno-1][:node.col_offset].encode('utf8').decode('utf8'))
                    line=text.splitlines()[node.lineno-1]
                    match=re.search(r'\bfrom\s+'+re.escape(node.module)+r'\b',line[node.col_offset:])
                    if match:
                        a=offsets[node.lineno-1]+node.col_offset+match.start();b=offsets[node.lineno-1]+node.col_offset+match.end()
                        spans.append((a,b,'from '+py_modules[node.module]))
                elif isinstance(node,ast.Import):
                    if any(alias.name in py_modules for alias in node.names):
                        a=offsets[node.lineno-1]+node.col_offset;b=offsets[node.end_lineno-1]+node.end_col_offset
                        pieces=['import '+(py_modules[alias.name]+' as '+(alias.asname or alias.name) if alias.name in py_modules else alias.name+(' as '+alias.asname if alias.asname else '')) for alias in node.names]
                        spans.append((a,b,'; '.join(pieces)))
            for a,b,replacement in sorted(spans,reverse=True):updated=updated[:a]+replacement+updated[b:]
            # Only subprocess Python arguments become module invocations. Hash paths
            # and historic run/sim paths remain file paths, not command arguments.
            for oldpath,newpath in mapping.items():
                if oldpath.startswith('sim/') and oldpath.endswith('.py'):
                    module=Path(oldpath).stem
                    updated=re.sub(r"(sys\.executable\s*,\s*)['\"]"+re.escape(oldpath)+r"['\"]",lambda m:m[1]+"'-m','sim','"+module+"'",updated)
                    updated=updated.replace("'python','"+oldpath+"'","'python','-m','sim','"+module+"'")
                    updated=re.sub(r"(['\"][^'\"]*/(?:bin/)?python['\"]\s*,\s*)['\"]"+re.escape(oldpath)+r"['\"]",lambda m:m[1]+"'-m','sim','"+module+"'",updated)
            # Files relative to a script may now live in another feature package.
            for oldpath,newpath in mapping.items():
                basename=Path(oldpath).name
                if Path(oldpath).parent==Path(old).parent and Path(newpath).parent!=p.parent:
                    updated=updated.replace("Path(__file__).with_name('"+basename+"')","Path('"+newpath+"')")
            if new!=old:
                updated=updated.replace('Path(__file__).resolve().parents[1]', 'Path(__file__).resolve().parents[2]')
            if Path(old).name=='test_research_snapshot.py':
                for module,target in py_modules.items():
                    if module.startswith('test_'): updated=updated.replace("'"+module+"'","'"+target+"'")
        if p.suffix in {'.ts','.mjs'}:
            def relative_import(match):
                spec=match[2]
                if not spec.startswith('.'):return match[0]
                oldtarget=(ROOT/Path(old).parent/spec).resolve()
                if str(oldtarget).endswith('.js'):oldtarget=Path(str(oldtarget)[:-3]+'.ts')
                target=ts_paths.get(str(oldtarget))
                if target is None:
                    try:key=oldtarget.relative_to(ROOT).as_posix()
                    except ValueError:return match[0]
                    target=mapping.get(key,key if oldtarget.exists() else None)
                if target is None:return match[0]
                relative=os.path.relpath(ROOT/target,(ROOT/new).parent).replace('\\','/')
                if relative.endswith('.ts'):relative=relative[:-3]+'.js'
                if not relative.startswith('.'):relative='./'+relative
                return match[1]+relative+match[3]
            updated=re.sub(r"((?:from\s*|import\s*\(|new URL\(\s*)['\"])(\.[^'\"]+)(['\"])",relative_import,updated)
        # Executable code/config references follow the new layout, never generated
        # receipt paths in run/ or frozen dist/ trees.
        if p.suffix!='.md' and not old.startswith('docs/'):
            for oldpath,newpath in sorted(mapping.items(),key=lambda kv:-len(kv[0])):
                if oldpath.endswith('.ts'):
                    updated=updated.replace('dist/'+oldpath[4:-3]+'.js','dist/'+newpath[4:-3]+'.js')
                else:
                    updated=updated.replace('"'+oldpath+'"','"'+newpath+'"').replace("'"+oldpath+"'","'"+newpath+"'")
        if p.suffix=='.md':
            # Resolve links relative to the OLD document, then remap both ends.
            def link(match):
                value=match[1];path,sep,anchor=value.partition('#')
                if not path or re.match(r'^[a-zA-Z]+:',path) or path.startswith('/'):return match[0]
                target=(ROOT/Path(old).parent/path).resolve()
                try:key=target.relative_to(ROOT).as_posix()
                except ValueError:return match[0]
                dest=mapping.get(key,key)
                relative=os.path.relpath(ROOT/dest,p.parent.resolve()).replace('\\','/')
                return ']('+relative+(sep+anchor if sep else '')+')'
            updated=re.sub(r'\]\(([^\s)]+)\)',link,updated)
        if updated!=text:p.write_text(updated,encoding='utf8',newline='')
    manifest.parent.mkdir(parents=True,exist_ok=True)
    manifest.write_text(json.dumps({'baseline':'9b6bd84','policy':'Relocation only; historical run/dist receipts are not moved or rewritten. Old CLI paths are replaced by python -m sim <tool>.','moves':mapping,'pythonModules':{k:v for k,v in py_modules.items() if not k.startswith('test_')}},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'moved':len(mapping),'textFilesInspected':len(texts)}))


def finish():
    os.chdir(ROOT)
    manifest=json.loads(Path('docs/maintenance/layout-map.json').read_text(encoding='utf8'))
    moves=manifest['moves']
    # Current builds are isolated from immutable experiment snapshots.
    for base in ['src','sim','tests','scripts']:
        for p in Path(base).rglob('*'):
            if not p.is_file() or p.suffix not in {'.ts','.py','.mjs','.ps1'} or p==Path(__file__).relative_to(ROOT):continue
            try:text=p.read_text(encoding='utf8')
            except UnicodeDecodeError:continue
            updated=text.replace('dist/sim/','dist/current/sim/').replace('dist/agent/','dist/current/agent/')
            if p.parent==Path('src/sim/evaluation'):
                updated=updated.replace("'../agent/","'../../agent/").replace('"../agent/','"../../agent/')
            if updated!=text:p.write_text(updated,encoding='utf8',newline='')
    p=Path('package.json');text=p.read_text(encoding='utf8');p.write_text(text.replace(' dist/',' dist/current/'),encoding='utf8',newline='')
    # Markdown links in three newly archived root/index documents retain meaning.
    for filename,oldbase in [('repository-readme-pre-v1.2.md','.'),('worklog-pre-v1.2.md','.'),('testing-version-1.1.md','docs')]:
        p=Path('docs/archive')/filename;text=p.read_text(encoding='utf8')
        def link(match):
            value=match[1];path,sep,anchor=value.partition('#')
            if not path or re.match(r'^[a-zA-Z]+:',path) or path.startswith('/'):return match[0]
            target=(ROOT/oldbase/path).resolve()
            try:key=target.relative_to(ROOT).as_posix()
            except ValueError:return match[0]
            dest=moves.get(key,key)
            if key=='README.md':dest='README.md'
            if key=='TODO.md':dest='TODO.md'
            relative=os.path.relpath(ROOT/dest,p.parent.resolve()).replace('\\','/')
            return ']('+relative+(sep+anchor if sep else '')+')'
        p.write_text(re.sub(r'\]\(([^\s)]+)\)',link,text),encoding='utf8',newline='')
    print('Finalized active build paths and archived document links')


if __name__=='__main__':
    import sys
    finish() if '--finish' in sys.argv else main()
