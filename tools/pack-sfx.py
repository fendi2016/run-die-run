# Convert a pack sound into the game's SFX format (see Sfx.ts): mono 22kHz
# 16-bit WAV, trimmed to its first audible sample, optionally cut to a max
# length with a short fade, and peak-normalized to match the other sounds.
# usage: python3 tools/pack-sfx.py <source.wav> <out name> [max seconds]
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

RATE = 22050
PEAK = 0.89
FADE_S = 0.03

src, name = sys.argv[1], sys.argv[2]
max_s = float(sys.argv[3]) if len(sys.argv) > 3 else None
with tempfile.NamedTemporaryFile(suffix='.wav') as tmp:
    subprocess.run(['afconvert', '-f', 'WAVE', '-d', f'LEI16@{RATE}', '-c', '1', src, tmp.name], check=True)
    with wave.open(tmp.name) as w:
        audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
start = int(np.argmax(np.abs(audio) > np.abs(audio).max() * 0.02))
audio = audio[start:]
if max_s is not None and len(audio) > max_s * RATE:
    audio = audio[: int(max_s * RATE)]
    fade = int(FADE_S * RATE)
    audio[-fade:] *= np.linspace(1, 0, fade)
audio *= PEAK / np.abs(audio).max()
out = Path('public/assets/sfx') / f'{name}.wav'
with wave.open(str(out), 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes((audio * 32767).astype(np.int16).tobytes())
print(f'{out}: {len(audio) / RATE:.2f}s')
