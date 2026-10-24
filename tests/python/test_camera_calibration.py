from pathlib import Path
import tempfile
import unittest
from cam.host.calibrate import board,fit


class CalibrationPreparationTests(unittest.TestCase):
    def test_board_has_physical_size_and_never_overwrites(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'target.svg';board(path,9,6,20)
            text=path.read_text();self.assertIn('width="240mm"',text);self.assertIn('height="180mm"',text)
            self.assertEqual(text.count('fill="black"'),35)
            with self.assertRaises(FileExistsError):board(path,9,6,20)
    def test_no_board_photos_does_not_produce_fake_calibration(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)/'calibration.json'
            with self.assertRaisesRegex(ValueError,'Need >=12'):fit(tmp,output,'fisheye',9,6,20)
            self.assertFalse(output.exists())


if __name__=='__main__':unittest.main()
