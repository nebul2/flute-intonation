"""How far apart are the shipped temperaments, given a played scale?

The web app's "which temperament?" page fits a measured twelve-note scale
against every temperament at every root. Whether that can answer anything
depends entirely on how far apart the candidates are, so this prints the
table -- and the docs/core/identify.js confidence rules are set from it.

The instrument's overall pitch says nothing about its temperament, so every
shape has its mean removed before anything is compared; what remains is the
shape alone. Distance is RMS over the twelve pitch classes, in cents.

Run:  python -m flutetrainer.tools.temperament_separation
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from flutetrainer.core.tuning import parse_scala

DATA = Path(__file__).resolve().parents[1] / "data" / "temperaments"
NAMES = {
    "equal": "Equal",
    "vallotti": "Vallotti",
    "werckmeister3": "Werckmeister III",
    "kirnberger3": "Kirnberger III",
    "meantone_quarter": "1/4-comma meantone",
}
CLASSES = "C C# D Eb E F F# G G# A Bb B".split()


def shape(stem: str) -> np.ndarray:
    """Twelve deviations from equal, rooted on C, overall pitch removed."""
    scale = parse_scala(DATA.joinpath(f"{stem}.scl").read_text(encoding="utf-8"))
    dev = np.array(scale.degrees_cents[:12]) - np.arange(12) * 100.0
    return dev - dev.mean()


def distance(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.sqrt(((a - b) ** 2).mean()))


def main() -> int:
    shapes = {NAMES[s]: shape(s) for s in NAMES}
    names = list(shapes)

    print("Shape of each temperament (cents from equal, C-rooted, mean removed):\n")
    print(f"  {'':<20}" + "".join(f"{c:>6}" for c in CLASSES))
    for n in names:
        print(f"  {n:<20}" + "".join(f"{v:6.1f}" for v in shapes[n]))

    print("\nRMS distance between shapes, same root (cents):\n")
    print(f"  {'':<20}" + "".join(f"{n[:9]:>11}" for n in names))
    for a in names:
        print(f"  {a:<20}" + "".join(f"{distance(shapes[a], shapes[b]):11.1f}" for b in names))

    # The root is unknown too, so every temperament is offered at all twelve
    # roots. Equal is rotation-invariant and so has no root at all.
    candidates: dict[tuple[str, int], np.ndarray] = {}
    for n, v in shapes.items():
        for r in range(12):
            rot = np.roll(v, r)
            candidates[(n, r)] = rot - rot.mean()

    print("\nDistance to the nearest *wrong* candidate -- the hurdle to clear:\n")
    for n in names:
        mine = candidates[(n, 0)]
        others = [
            (distance(mine, v), k)
            for k, v in candidates.items()
            if k != (n, 0) and not (n == "Equal" and k[0] == "Equal")
        ]
        d, k = min(others)
        root = "" if k[0] == "Equal" else f" on {CLASSES[k[1]]}"
        print(f"  {n:<20} {d:5.1f} cents  ->  {k[0]}{root}")

    print("\nSame temperament, wrong root -- can the root itself be found?\n")
    for n in names:
        if n == "Equal":
            print(f"  {n:<20}   n/a   rotation-invariant: it has no root")
            continue
        d = min(distance(candidates[(n, 0)], candidates[(n, r)]) for r in range(1, 12))
        print(f"  {n:<20} {d:5.1f} cents to its nearest wrong root")

    print(
        "\nA harpsichord tuned by a careful human carries 1-2 cents of error per\n"
        "note, and that belongs to the instrument. So: meantone is nameable, a\n"
        "well temperament is separable from equal, and the individual well\n"
        "temperaments are not separable from each other."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
