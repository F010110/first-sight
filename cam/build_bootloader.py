"""Arduino 2.0.17 ships only dio_80m ELF; generate a DIO/40MHz image.

Do not modify the installed framework or ship private local backup binaries.
This reproduces the header conversion used by the originally tested bootloader.
"""
Import('env')
from pathlib import Path
import subprocess

platform = env.PioPlatform()
framework = Path(platform.get_package_dir('framework-arduinoespressif32'))
tool = Path(platform.get_package_dir('tool-esptoolpy')) / 'esptool.py'
source = framework / 'tools/sdk/esp32s3/bin/bootloader_dio_80m.elf'
output = Path(env.subst('$PROJECT_DIR')) / '.pio/generated/bootloader-dio40.bin'
output.parent.mkdir(parents=True, exist_ok=True)
subprocess.check_call([env.subst('$PYTHONEXE'), str(tool), '--chip', 'esp32s3',
                       'elf2image', '--flash_mode', 'dio', '--flash_freq', '40m',
                       '--flash_size', '16MB', '-o', str(output), str(source)])
env.BoardConfig().update('build.arduino.custom_bootloader', str(output))
