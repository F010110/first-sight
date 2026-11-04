"""Evaluation-only visual overview. Never reads position labels or writes the producer."""
import hashlib
import json
import pathlib
import sys
from PIL import Image, ImageDraw

bundle_path, output_path = map(pathlib.Path, sys.argv[1:])
bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
output_path.mkdir(exist_ok=False)
images = {row["id"]: row for row in bundle["observations"]}
manifest = []
for state in bundle["states"]:
    ids = state["memberIds"]
    sheet = Image.new("RGB", (1200, len(ids) * 250), "white")
    draw = ImageDraw.Draw(sheet)
    sources = []
    for row_index, source_id in enumerate(ids):
        row = images[source_id]
        for column, view in enumerate(row["views"]):
            raw = pathlib.Path(view["path"]).read_bytes()
            if hashlib.sha256(raw).hexdigest() != view["sha256"]:
                raise ValueError("Original hash changed: " + source_id)
            with Image.open(view["path"]) as image:
                image.thumbnail((400, 225))
                sheet.paste(image.convert("RGB"), (column * 400, row_index * 250 + 25))
            draw.text((column * 400 + 4, row_index * 250 + 4),
                      f"v{state['version']} {source_id} {view['direction']}", fill="black")
            sources.append({"id": source_id, "direction": view["direction"], "sha256": view["sha256"]})
    path = output_path / f"window-{state['version']:04d}.png"
    sheet.save(path)
    manifest.append({"id": f"sheet:{state['version']}", "direction": "overview-not-original",
                     "path": str(path.resolve()), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                     "version": state["version"], "sources": sources})
(output_path / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(json.dumps({"sheets": len(manifest), "sourceImages": sum(len(x["sources"]) for x in manifest)}))
