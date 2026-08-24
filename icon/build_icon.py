#!/usr/bin/env python3
"""Rasterize nebul2-icon.svg to PNG at the sizes the app needs.

    pip install cairosvg
    python3 icon/build_icon.py

Edit nebul2-icon.svg (flute, tuner arc, colours) and re-run.
"""
from pathlib import Path
import cairosvg

HERE = Path(__file__).parent
SRC = HERE / "nebul2-icon.svg"
SIZES = (32, 180, 192, 512)   # favicon, apple-touch-icon, android, PWA/GitHub

for s in SIZES:
    out = HERE / f"nebul2-icon-{s}.png"
    cairosvg.svg2png(url=str(SRC), write_to=str(out), output_width=s, output_height=s)
    print("wrote", out.name)
