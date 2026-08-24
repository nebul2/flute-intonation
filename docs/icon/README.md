# nebul2 icon

`nebul2-icon.svg` is the master. One-keyed baroque flute over a tuner arc, needle centred (in tune).

Regenerate PNGs after editing the SVG:

    pip install cairosvg
    python3 icon/build_icon.py

In `index.html`:

    <link rel="icon" href="icon/nebul2-icon.svg" type="image/svg+xml">
    <link rel="icon" href="icon/nebul2-icon-32.png" sizes="32x32">
    <link rel="apple-touch-icon" href="icon/nebul2-icon-180.png">
