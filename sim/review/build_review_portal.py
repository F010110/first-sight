"""Build a local index over generated review packages, no external hosting."""
import argparse
import html
import json
from types import SimpleNamespace
from pathlib import Path


def build_portal(root):
    args=SimpleNamespace(root=Path(root))
    rows = []; catalog = []
    for path in sorted(args.root.glob('*/data.json')):
        data = json.loads(path.read_text(encoding='utf-8'))
        if 'datasetId' not in data:continue
        catalog.append({'directory': path.parent.name, 'name': data['datasetId'], 'samples': len(data['samples']), 'title': data.get('title'), 'source': data.get('source'), 'reviewKind': data.get('reviewKind'), 'issueCount': len(data.get('issues', []))})
        rows.append(f'<li><a href="{html.escape(path.parent.name, quote=True)}/">{html.escape(data["datasetId"])}</a> — {len(data["samples"])} 个样本，{data["frameCount"]} 帧，模型 {html.escape(data["model"] or "未知")}</li>')
    if not rows:
        raise ValueError('No review packages')
    (args.root / 'datasets.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding='utf-8')
    video_path=args.root/'hssd-videos/catalog.json'
    videos=json.loads(video_path.read_text(encoding='utf8'))['scenes'] if video_path.exists() else []
    cards=[];seen=set()
    entries=[]
    for row in catalog:
        scene=row['name'].removeprefix('hssd-') if row['name'].startswith('hssd-') else None
        video=next((v for v in videos if v['sceneId']==scene),None)
        entries.append((row,video));seen.add(scene)
    for video in videos:
        if video['sceneId'] not in seen:entries.append((None,video))
    for row,video in entries:
        directory=row['directory'] if row else None
        title=video['sceneId'] if video else (row.get('title') or '家庭 '+directory)
        description=video['name'] if video else row['name']
        source=(row.get('source') if row else None) or ('Habitat / HSSD' if video or (row and row['name'].startswith('hssd-')) else 'AI2-THOR / ProcTHOR')
        status='可审核' if row else '采集失败 · 无有效输入'
        count=row['samples'] if row else 0
        links=[]
        if directory:links.append(f'<a class="button" href="{html.escape(directory,quote=True)}/">{"问题诊断／原图审核" if row.get("reviewKind")=="memory" else "逐点／标签审核"}</a>')
        if video and video['ready']:links.append(f'<a class="button" href="hssd-videos/?scene={html.escape(video["sceneId"],quote=True)}">视频审核</a>')
        if video and (args.root/'label-maps/index.html').exists():links.append(f'<a class="button" href="label-maps/?scene={html.escape(video["sceneId"],quote=True)}">标签地图／判断依据</a>')
        if not links:links.append('<span class="muted">失败保留，不计为完成</span>')
        kind='memory' if row and row.get('reviewKind')=='memory' else ('hssd' if video or (row and row['name'].startswith('hssd-')) else 'home')
        extra=f' · {row["issueCount"]} 个待诊断问题' if row and row.get('issueCount') else ''
        cards.append(f'<article data-kind="{kind}" data-ready="{str(bool(row)).lower()}" data-search="{html.escape(title+description+source,quote=True)}"><div class="top"><span class="tag">{html.escape(source)}</span><span>{status}</span></div><h2>{html.escape(title)}</h2><p>{html.escape(description)}</p><p class="muted">{count} 个观察点{extra} · 标签与预测分别展示</p><nav>{"".join(links)}</nav></article>')
    template=Path(__file__).with_name('review_portal.html').read_text(encoding='utf8')
    (args.root/'index.html').write_text(template.replace('<!--CARDS-->',''.join(cards)).replace('<!--COUNT-->',str(len(entries))),encoding='utf8')
    for row in catalog:
        path=args.root/row['directory']/'index.html'
        page=path.read_text(encoding='utf8')
        if '返回全部样本' not in page:page=page.replace('<header>','<header><a href="../">返回全部样本</a>',1);path.write_text(page,encoding='utf8')
    print(args.root / 'index.html')


def main():
    parser=argparse.ArgumentParser();parser.add_argument('root',type=Path);args=parser.parse_args();build_portal(args.root)


if __name__ == '__main__':
    main()
