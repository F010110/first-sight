"""Export browser-compatible H.264 side/front videos and an offline inspection page."""
import argparse
import json
import subprocess
from pathlib import Path


def main():
    import imageio_ffmpeg

    parser = argparse.ArgumentParser()
    parser.add_argument("episode", type=Path)
    parser.add_argument("--fps", type=float, default=2)
    parser.add_argument("--decisions-from", type=Path, help="Use decisions from the matching original episode for a visualization-only interpolation")
    args = parser.parse_args()
    root = args.episode.resolve()
    out = root / "viewer"
    out.mkdir(exist_ok=True)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    for name, folder in (("left", "left"), ("front", "frames"), ("right", "right"), ("triple", "triple")):
        command = [ffmpeg, "-y", "-framerate", str(args.fps), "-start_number", "0", "-i", str(root / folder / "%04d.jpg"), "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out / f"{name}.mp4")]
        subprocess.run(command, check=True, capture_output=True)
        print(f"exported {name}.mp4", flush=True)
    windows = [json.loads(line) for line in (root / "windows.jsonl").read_text(encoding="utf-8").splitlines()]
    poses = [json.loads(line) for line in (root / "observations.jsonl").read_text(encoding="utf-8").splitlines()]
    decisions = {}
    for mode in ("front", "triple"):
        report = (args.decisions_from or root) / f"eval-{mode}.json"
        if report.exists():
            data = json.loads(report.read_text(encoding="utf-8"))
            decisions[mode] = [json.loads(line) for line in (Path(data["layered"]["runDir"]) / "decisions.jsonl").read_text(encoding="utf-8").splitlines()]
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    payload = json.dumps({"fps": args.fps, "poses": poses, "windows": windows, "decisions": decisions, "substeps": manifest.get("substeps", 1)}, ensure_ascii=False).replace("</", "<\\/")
    html = TEMPLATE.replace("__DATA__", payload)
    (out / "index.html").write_text(html, encoding="utf-8")
    print(out / "index.html", flush=True)


TEMPLATE = r'''<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>First Sight 三视角模拟回放</title>
<style>
body{background:#111827;color:#e5e7eb;font:16px system-ui;margin:0;padding:24px}h1{font-size:24px}.views{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}video{width:100%;background:#000;border-radius:8px}.panel{background:#1f2937;padding:16px;border-radius:10px;margin:16px 0}button,select{padding:9px;margin:4px;border:0;border-radius:5px;cursor:pointer}input{width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px system-ui}.small{color:#9ca3af;font-size:14px}.decisions{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:700px){.views,.decisions{grid-template-columns:1fr}}
</style>
<h1>左 / 前 / 右：相同位置的模拟回放</h1>
<p class="small" id="disclaimer">静态场景下同光心分朝向渲染，非硬件同步。默认 2 个模拟动作/秒；不是实拍运动速度。GT 房间和坐标仅供人工检查，未传给 Agent。</p>
<div class="views"><div>左侧 −90°<video id="left" src="left.mp4" muted playsinline preload="auto"></video></div><div>正前方 0°<video id="front" src="front.mp4" muted playsinline preload="auto"></video></div><div>右侧 +90°<video id="right" src="right.mp4" muted playsinline preload="auto"></video></div></div>
<div class="panel"><button id="play">播放 / 暂停</button><button id="prev">上一帧</button><button id="next">下一帧</button><label>倍速 <select id="speed"><option>.25</option><option>.5</option><option selected>1</option><option>2</option></select></label><label>观察窗口 <select id="window"></select></label><input id="seek" type="range" min="0" step="1"><div id="status"></div></div>
<div class="panel"><div id="pose"></div><p class="small">下面是当时的原始判断（历史修订前）。整个观察窗口的结果，在结束帧才已知；窗口中途展示为离线回看注释，不表示 Agent 当时已判断。比较“当前窗口末帧”与“上一地点代表图”可核查图像/文字是否错绑。</p><div class="decisions"><div><h3>单前视角判断</h3><pre id="single"></pre></div><div><h3>三视角判断</h3><pre id="multi"></pre></div></div></div>
<details class="panel"><summary>三联图视频（独立播放器）</summary><video src="triple.mp4" controls preload="metadata"></video></details>
<script>
const data=__DATA__;
if(data.substeps>1)document.getElementById('disclaimer').textContent=`平滑展示：每个原始动作插入 ${data.substeps} 个相机位姿渲染，能看到转向过程。仅用于人工观察，不是录制的物理运动，也未送入 Agent。判断仍来自原始端点帧。中间帧 GT 房间沿用动作终点标签，穿越边界时可能暂不准确。`;
const videos=['front','left','right'].map(id=>document.getElementById(id));const master=videos[0];const seek=document.getElementById('seek');const n=data.poses.length;seek.max=n-1;
const win=document.getElementById('window');data.windows.forEach((w,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`${i+1}: 帧 ${w.startTick+1}–${w.endTick}`;win.append(o)});
function setFrame(tick){videos.forEach(v=>{v.pause();v.currentTime=(Math.max(0,Math.min(n-1,tick))+.08)/data.fps})}
function describe(mode,i){const d=data.decisions[mode]?.[i];if(!d)return '无记录';const r=d.result;return JSON.stringify({place:r.sceneId,label:r.label,confidence:r.confidence,sameAsPrevious:r.sameAsPrevious,anchors:r.anchors,localRelations:r.localRelations,identityReason:r.identityReason,positionMatchEvidence:r.positionMatchEvidence,positionalContradictions:r.positionalContradictions},null,2)}
function update(){const tick=Math.min(n-1,Math.floor(master.currentTime*data.fps));seek.value=tick;const p=data.poses[tick];const i=data.windows.findIndex(w=>tick>w.startTick&&tick<=w.endTick);document.getElementById('status').textContent=`帧 ${tick}/${n-1}　视频 ${master.currentTime.toFixed(1)} 秒　${i>=0?'窗口 '+(i+1):'初始帧'}`;document.getElementById('pose').textContent=p?`动作: ${p.action}　成功: ${p.success}　GT: ${p.room}　位置: (${p.x}, ${p.z})　朝向: ${p.yaw}°`:'';if(i>=0){win.value=i}document.getElementById('single').textContent=describe('front',i);document.getElementById('multi').textContent=describe('triple',i);for(const v of videos.slice(1)){if(Math.abs(v.currentTime-master.currentTime)>.12)v.currentTime=master.currentTime}requestAnimationFrame(update)}
document.getElementById('play').onclick=async()=>{if(master.paused){if(master.ended)setFrame(0);await Promise.all(videos.map(v=>v.play()))}else videos.forEach(v=>v.pause())};document.getElementById('prev').onclick=()=>setFrame(Math.floor(master.currentTime*data.fps)-1);document.getElementById('next').onclick=()=>setFrame(Math.floor(master.currentTime*data.fps)+1);seek.oninput=()=>setFrame(Number(seek.value));win.onchange=()=>setFrame(data.windows[Number(win.value)].endTick);document.getElementById('speed').onchange=e=>videos.forEach(v=>v.playbackRate=Number(e.target.value));requestAnimationFrame(update);
</script></html>'''


if __name__ == "__main__":
    main()
