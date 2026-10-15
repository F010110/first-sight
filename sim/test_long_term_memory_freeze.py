import hashlib
import json
from pathlib import Path
import unittest


class FreezeTests(unittest.TestCase):
    def test_frozen_sources(self):
        manifest=json.loads(Path('docs/application/long-term-memory-v1.json').read_text(encoding='utf8'))
        for name,expected in manifest['sha256OfLfNormalizedSources'].items():
            content=Path(name).read_bytes().replace(b'\r\n',b'\n')
            self.assertEqual(hashlib.sha256(content).hexdigest(),expected,name+' changed: make an explicit version/bugfix decision')


if __name__=='__main__':unittest.main()
