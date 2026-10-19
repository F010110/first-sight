import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from sim.benchmarks.pack_ground_pilot import pack

class GroundTests(unittest.TestCase):
    def test_pose_is_private_and_original_frame_index_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'School'/'Data_omni'/'P0000';source.mkdir(parents=True)
            with zipfile.ZipFile(source/'metadata.zip','w') as archive:
                archive.writestr('P0000_metadata.json',json.dumps({'time_step':0.1,'num_poses':3,'path_length':2}))
                archive.writestr('pose_lcam_front.txt','0 0 0 0 0 0 1\n1 0 0 0 0 0 1\n2 0 0 0 0 0 1\n')
            for view in ['front','left','right']:
                with zipfile.ZipFile(source/f'image_lcam_{view}.zip','w') as archive:
                    for i in range(3):archive.writestr(f'image_lcam_{view}/{i:06d}_lcam_{view}.png',b'original-image-bytes')
            output=Path(directory)/'pack';pack(source,output,'P0000',10)
            rows=[json.loads(line) for line in (output/'observations.jsonl').read_text().splitlines()]
            self.assertEqual([r['sourceFrameIndex'] for r in rows],[0,2]);self.assertEqual([r['atMs'] for r in rows],[0,200])
            self.assertNotIn('poseXYZQuaternion',str(rows));self.assertTrue((output/'evaluation-only'/'poses.jsonl').exists())
            self.assertEqual((output/rows[0]['cameras']['front']).read_bytes(),b'original-image-bytes')
            with self.assertRaises(FileExistsError):pack(source,output,'P0000',10)

if __name__=='__main__':unittest.main()
