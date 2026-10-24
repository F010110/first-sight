"""Index ignored local artifacts without moving hash-bound evaluation evidence."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CURRENT = {
    'run/inspect-repair-full90-v1': 'v1.2.0正式版90题实测及独立评分',
    'run/inspect-repair-44-probe-v1': '44题捕获状态专项修复，不是完整成绩',
    'run/review-site': '人工审核网站及图像／视频',
    'run/school-calendar-v1': '用户授权的假设日历，不是实际拍摄日期',
    'dist/current': '当前源码构建，可再生',
    'dist/inspect-probe-grading-v1': '正式版评测所用冻结快照，不覆盖',
}


def build(base):
    directory = ROOT / base
    directory.mkdir(exist_ok=True)
    lines = ['# 本地产物索引', '', '此目录不进git。原始实验、失败与冻结路径保留，避免破坏绝对路径／哈希溯源。', '', '## 当前入口', '']
    for path, description in CURRENT.items():
        p = ROOT / path
        if p.parent == directory:
            lines.append(f'- [{p.name}]({p.name}/)：{description}')
    lines += ['', '## 其他保留目录', '']
    for p in sorted(directory.iterdir()):
        if p.is_dir() and p.relative_to(ROOT).as_posix() not in CURRENT:
            lines.append(f'- [{p.name}]({p.name}/)')
    lines += ['', '顶层日志／报告仍保留原名；查看发布说明和对应运行manifest，不将旧版输出混入当前分数。', '']
    (directory / 'INDEX.md').write_text('\n'.join(lines), encoding='utf8')


if __name__ == '__main__':
    for base in ['run', 'dist']:
        build(base)
    print('Updated run/INDEX.md and dist/INDEX.md; no evidence moved or removed')
