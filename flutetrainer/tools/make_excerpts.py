"""Cut short excerpts from the reference recordings, for the repository.

The full takes are minutes of audio and tens of megabytes, and they are
recordings of one person playing; they stay out of the repository. But the
behaviour they revealed -- a slur reported as a phantom note between two real
ones, a trill absorbed as an immaculate sustained note, a substituted trill
fingering -- is worth pinning where anyone cloning the project can run it.

A few seconds carries each case. Excerpts are written as 16-bit PCM rather
than the 32-bit the recorder captures: the detector reads them identically,
and 16-bit puts the quantisation floor near -96 dBFS, far below the -68 dBFS
room these were made in, so nothing measurable is lost.

Run:  python -m flutetrainer.tools.make_excerpts
"""

from __future__ import annotations

import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "recordings"
TARGET = ROOT / "docs" / "tests" / "fixtures"


@dataclass(frozen=True)
class Excerpt:
    """One cut, named for the behaviour it pins rather than for its source."""

    name: str
    source: str
    start: float
    seconds: float
    note: str


EXCERPTS: tuple[Excerpt, ...] = (
    Excerpt(
        "sustained", "longtones", 0.20, 5.0,
        "Two held notes. Nothing here may be taken for an ornament, and the "
        "detector must read them steadily: the false-positive case.",
    ),
    Excerpt(
        "tongued", "attacks", 0.90, 4.5,
        "The same note tongued several times. Repetition is not alternation, "
        "because the pitch never changes.",
    ),
    Excerpt(
        "trill", "trills", 0.85, 4.5,
        "An accelerating trill, slow to fast. Its alternations shorten from "
        "about half a second to a twentieth, every one long enough to be a "
        "region of its own -- which is why the first trill rule, written to "
        "catch a pitch leaving and returning within one region, never fired.",
    ),
    Excerpt(
        "trill_fingering", "trillfingering", 0.85, 4.5,
        "A trill whose fingering gives way as it accelerates: the upper pole "
        "drifts up by tens of cents and settles about 155 cents above the "
        "main note, between the written auxiliary and its neighbour.",
    ),
    Excerpt(
        "slurred", "piece", 2.40, 3.0,
        "A slurred passage. The pitch genuinely sounds the notes in between, "
        "so a region that is still travelling is a transition, not a note -- "
        "the fault that reported an F natural in a prelude that has none.",
    ),
)


def read(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as handle:
        rate = handle.getframerate()
        width = handle.getsampwidth()
        channels = handle.getnchannels()
        raw = handle.readframes(handle.getnframes())

    if width == 2:
        data = np.frombuffer(raw, dtype="<i2").astype(np.float64) / 2**15
    elif width == 4:
        data = np.frombuffer(raw, dtype="<i4").astype(np.float64) / 2**31
    else:
        raise ValueError(f"{path.name}: unsupported width {width * 8}-bit")
    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)
    return data, rate


def write16(path: Path, samples: np.ndarray, rate: int) -> int:
    scaled = np.rint(np.clip(samples, -1.0, 1.0) * (2**15 - 1)).astype("<i2")
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(scaled.tobytes())
    return path.stat().st_size


def main() -> int:
    missing = [e.source for e in EXCERPTS if not (SOURCE / f"{e.source}.wav").exists()]
    if missing:
        print(f"missing recordings: {', '.join(sorted(set(missing)))}\n"
              f"capture them with: python -m flutetrainer.tools.record --take <name>")
        return 2

    total = 0
    lines = ["# Test fixtures", "",
             "Short excerpts cut from real flute recordings by",
             "`python -m flutetrainer.tools.make_excerpts`. The full takes stay out of",
             "the repository; these carry the behaviour worth pinning.", ""]
    for excerpt in EXCERPTS:
        samples, rate = read(SOURCE / f"{excerpt.source}.wav")
        start = int(round(excerpt.start * rate))
        stop = min(samples.size, start + int(round(excerpt.seconds * rate)))
        size = write16(TARGET / f"{excerpt.name}.wav", samples[start:stop], rate)
        total += size
        print(f"  {excerpt.name:<16} {(stop - start) / rate:4.1f}s  {size / 1024:6.0f} KB")
        lines += [f"**{excerpt.name}.wav** — {excerpt.note}", ""]

    (TARGET / "README.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"  {'total':<16} {'':4}   {total / 1024:6.0f} KB -> {TARGET.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
