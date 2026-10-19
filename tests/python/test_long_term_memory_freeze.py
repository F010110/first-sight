import hashlib
import json
from pathlib import Path
import unittest
import subprocess


class FreezeTests(unittest.TestCase):
    def test_frozen_sources(self):
        manifest=json.loads(Path('docs/application/long-term-memory-v1.json').read_text(encoding='utf8'))
        for name,expected in manifest['sha256OfLfNormalizedSources'].items():
            # This manifest describes the explicitly frozen October 15 version,
            # not current v1.2.0 sources (reassess/retrieval have since evolved).
            content=subprocess.check_output(['git','show','dcc270f:'+name]).replace(b'\r\n',b'\n')
            self.assertEqual(hashlib.sha256(content).hexdigest(),expected,name+' changed: make an explicit version/bugfix decision')


if __name__=='__main__':unittest.main()
