import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from sim.spatial.temporal_text_index import build,search

class TextIndexTest(unittest.TestCase):
    def test_scope_provenance_restart_and_missing_modality(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);archive=root/'archive';archive.mkdir();(archive/'complete.json').write_text('{}')
            db=sqlite3.connect(archive/'evidence.sqlite');db.execute('CREATE TABLE observations(raw TEXT)')
            rows=[{'id':str(i),'sessionId':session,'atMs':at,'sha256':{'front':'hash'+str(i)}} for i,(session,at) in enumerate([('a',10),('a',20),('b',5)])]
            for row in rows:db.execute('INSERT INTO observations VALUES(?)',(json.dumps(row),))
            db.commit();db.close()
            docs=[{'id':'d'+r['id'],'observationId':r['id'],'channel':'ocr','text':'brick library sign','producer':'test fixture, not actual OCR','sourceImageSha256':list(r['sha256'].values())} for r in rows]
            source=root/'docs.jsonl';source.write_text('\n'.join(map(json.dumps,docs)));build(archive,source,root/'index')
            result=search(root/'index','a',20,'library');self.assertEqual([r['observation_id'] for r in result],['0'])
            self.assertEqual(search(root/'index','a',20,'library'),result)
            self.assertEqual(search(root/'index','a',20,'library',channels=['asr']),[])
            self.assertEqual(search(root/'index','a',20,'absent'),[])
            with self.assertRaises(ValueError):search(root/'index','a',20,'library',limit=25)
            docs[0]['sourceImageSha256']=['invented'];source.write_text(json.dumps(docs[0]))
            with self.assertRaises(ValueError):build(archive,source,root/'bad')
            docs[0]['sourceImageSha256']=['hash0'];docs[0]['channel']='asr';source.write_text(json.dumps(docs[0]))
            with self.assertRaises(ValueError):build(archive,source,root/'fake-audio')

if __name__=='__main__':unittest.main()
