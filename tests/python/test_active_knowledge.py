"""Active-document registry is reproducible and does not index private/raw trees."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location(
    "active_catalog", Path(__file__).resolve().parents[2] / "scripts/maintenance/catalog-active-knowledge.py")
catalog = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(catalog)


class ActiveKnowledgeTests(unittest.TestCase):
    def test_registry_excludes_raw_and_private_and_marks_old_documents(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            active = root / "docs/active"
            active.mkdir(parents=True)
            for name in catalog.ACTIVE:
                (active / name).write_text("# Active\n", encoding="utf-8")
            for rel in ("docs/old.md", "src/code.ts", "run/raw.md", "cam/local/private.md", "research/private.md"):
                path = root / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("fixture", encoding="utf-8")
            original = catalog.ROOT
            catalog.ROOT = root
            try:
                (root / "opencode.json").write_text(json.dumps({"instructions": ["docs/active/" + name for name in catalog.ACTIVE]}), encoding="utf-8")
                catalog.main()
                first = (active / "source-catalog.json").read_bytes()
                catalog.main()
                self.assertEqual(first, (active / "source-catalog.json").read_bytes())
                records = {entry["path"]: entry for entry in json.loads(first)["entries"]}
                self.assertEqual(records["docs/old.md"]["role"], "historical-reference")
                self.assertEqual(records["src/code.ts"]["role"], "implementation-or-test")
                self.assertFalse(any(key.startswith(("run/", "cam/", "research/")) for key in records))
                (active / "README.md").write_text("[broken](missing.md)", encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "Broken link"):
                    catalog.main()
                (root / "opencode.json").write_text(json.dumps({"instructions": ["TODO.md"]}), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "OpenCode instructions"):
                    catalog.main()
            finally:
                catalog.ROOT = original


if __name__ == "__main__":
    unittest.main()
