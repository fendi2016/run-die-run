# Repack a Super Pixel Effects sheet into a clean horizontal strip.
# usage: python3 tools/pack-fx.py <pack sheet dir> <out key>
# Writes public/assets/vfx/<key>.webp (lossless) and prints the
# PIXEL_FX_SHEETS frame size and count for Juice.ts.
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

src_dir, key = Path(sys.argv[1]), sys.argv[2]
sheet = Image.open(src_dir / 'spritesheet.png').convert('RGBA')
rects = [tuple(map(int, m.groups())) for m in
         re.finditer(r'= (\d+) (\d+) (\d+) (\d+)', (src_dir / 'spritesheet.txt').read_text())]
w, h = rects[0][2], rects[0][3]
strip = Image.new('RGBA', (w * len(rects), h))
for i, (x, y, fw, fh) in enumerate(rects):
    strip.paste(sheet.crop((x, y, x + fw, y + fh)), (i * w, 0))
out = Path('public/assets/vfx') / f'{key}.webp'
with tempfile.NamedTemporaryFile(suffix='.png') as tmp:
    strip.save(tmp.name)
    subprocess.run(['cwebp', '-quiet', '-lossless', tmp.name, '-o', str(out)], check=True)
print(f'{key}: frameWidth {w}, frameHeight {h}, frames {len(rects)} -> {out}')
