"""Index owned documentation/code only; never mistake inventory for content review."""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ACTIVE = ["README.md", "01-spatial-memory-architecture.md", "02-current-state.md",
          "03-decisions.md", "04-code-map.md", "05-artifacts-and-results.md",
          "06-evaluation.md", "07-operations-and-assets.md", "08-maintenance.md"]
ACTIVE_PATHS = {"docs/active/" + name for name in ACTIVE}


def main():
    for name in ACTIVE:
        path = ROOT / "docs/active" / name
        if not path.is_file():
            raise ValueError("Missing active knowledge: " + name)
        for link in re.findall(r"\]\(([^)]+)\)", path.read_text(encoding="utf-8")):
            if "://" in link or link.startswith("#"):
                continue
            target = link.split("#", 1)[0]
            if not (path.parent / target).exists():
                raise ValueError(f"Broken link: {name}: {link}")
    entries = []
    roots = [ROOT / name for name in ("docs", "src", "scripts", "tests", "skills", "web")]
    paths = [p for root in roots if root.is_dir() for p in root.rglob("*")]
    paths += [p for p in ROOT.iterdir() if p.is_file() and p.suffix.lower() == ".md"]
    allowed = {".md", ".ts", ".js", ".mjs", ".cjs", ".py", ".html", ".css"}
    for path in sorted(set(paths)):
        rel = path.relative_to(ROOT).as_posix()
        if not path.is_file() or path.is_symlink() or path.suffix.lower() not in allowed:
            continue
        if any(part in {"node_modules", ".git", "__pycache__", "local", ".venv"} for part in path.parts):
            continue
        data = path.read_bytes()
        role = ("active-knowledge" if rel in ACTIVE_PATHS else
                "maintenance-instructions" if rel == "AGENTS.md" else
                "runtime-skill" if rel.startswith("skills/") else
                "historical-reference" if path.suffix.lower() == ".md" else "implementation-or-test")
        entries.append({"path": rel, "role": role, "bytes": len(data),
                        "sha256": hashlib.sha256(data).hexdigest(), "semanticReview": "not-implied-by-inventory"})
    output = {"schema": "active-knowledge-catalog-v1", "active": sorted(ACTIVE_PATHS),
              "hashScope": "Working-tree snapshot, including pre-existing uncommitted work; not a reproducible release freeze.",
              "policy": "Other explanatory documents are historical; code/evidence are not disabled. No claim of full content review.",
              "excluded": ["run", "data", "datasets", "research", "cam/local", "node_modules", ".git"],
              "entries": entries}
    (ROOT / "docs/active/source-catalog.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"active": len(ACTIVE_PATHS), "indexed": len(entries), "links": "passed"}))


if __name__ == "__main__":
    main()
