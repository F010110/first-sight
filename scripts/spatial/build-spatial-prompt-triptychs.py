"""Native-pixel diagnostic packaging, never a calibrated panoramic synthesis."""
import hashlib
import json
import pathlib
import sys
from PIL import Image

spec = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
root = pathlib.Path(sys.argv[2])
root.mkdir(parents=True, exist_ok=True)
receipts = []
for row in spec:
    sources = []
    panels = []
    for direction in ["left", "front", "right"]:
        path = pathlib.Path(row["cameras"][direction])
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        assert digest == row["sha256"][direction], "Source image hash mismatch"
        with Image.open(path) as image:
            assert image.mode == "RGB", "No implicit color conversion allowed"
            panels.append(image.copy())
        sources.append({"direction": direction, "path": str(path), "sha256": digest})
    assert len({p.height for p in panels}) == 1
    composite = Image.new("RGB", (sum(p.width for p in panels), panels[0].height))
    x = 0
    for panel in panels:
        composite.paste(panel, (x, 0))
        assert composite.crop((x, 0, x + panel.width, panel.height)).tobytes() == panel.tobytes()
        x += panel.width
    path = root / (row["id"] + ".png")
    assert not path.exists(), "Never overwrite diagnostic image artifacts"
    composite.save(path)
    receipts.append({"id": row["id"], "path": str(path.resolve()), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "sources": sources, "width": composite.width, "height": composite.height, "nativePixelsUnchanged": True, "note": "left/front/right native panels; no resize, interpolation, overlay or geometric stitching"})
(root / "provenance.json").write_text(json.dumps(receipts, indent=2), encoding="utf-8")
