"""Generate the bundled .scl temperament files from first principles.

Each historical temperament is defined by how much each fifth in the chain
Eb-Bb-F-C-G-D-A-E-B-F#-C#-G# departs from pure. Generating the cents values
from that definition -- rather than transcribing published tables -- makes the
files auditable and correct by construction.

Run:  python tools/make_temperaments.py
"""

from __future__ import annotations

import math
from pathlib import Path

PURE_FIFTH = 1200.0 * math.log2(3.0 / 2.0)          # 701.955 cents
PYTHAGOREAN_COMMA = 1200.0 * math.log2(3.0**12 / 2.0**19)   # 23.460 cents
SYNTONIC_COMMA = 1200.0 * math.log2(81.0 / 80.0)    # 21.506 cents
SCHISMA = PYTHAGOREAN_COMMA - SYNTONIC_COMMA        # 1.954 cents

# The chain of fifths, ascending from C. Index i is the fifth from CHAIN[i] to
# CHAIN[i+1]; the twelfth fifth closes the circle back onto C.
CHAIN = ["C", "G", "D", "A", "E", "B", "F#", "C#", "G#", "Eb", "Bb", "F"]

PITCH_CLASS = {
    "C": 0, "C#": 1, "D": 2, "Eb": 3, "E": 4, "F": 5,
    "F#": 6, "G": 7, "G#": 8, "A": 9, "Bb": 10, "B": 11,
}


def build(tempering: dict[str, float], description: str) -> str:
    """Build a .scl body. ``tempering`` maps 'C-G' to cents narrowed (positive)."""
    cents_by_name = {"C": 0.0}
    running = 0.0
    for i in range(11):
        lo, hi = CHAIN[i], CHAIN[i + 1]
        narrowing = tempering.get(f"{lo}-{hi}", 0.0)
        running += PURE_FIFTH - narrowing
        cents_by_name[hi] = running % 1200.0

    # Verify the circle closes: the twelfth fifth must land back on C.
    last_narrowing = tempering.get(f"{CHAIN[11]}-C", 0.0)
    closing = (running + PURE_FIFTH - last_narrowing) % 1200.0
    if min(closing, 1200.0 - closing) > 1e-6:
        raise AssertionError(
            f"{description}: circle of fifths fails to close (off by {closing:.4f}c)"
        )

    ordered = sorted(cents_by_name.items(), key=lambda kv: PITCH_CLASS[kv[0]])
    values = [c for _, c in ordered][1:] + [1200.0]

    lines = [
        f"! {description.split(',')[0].strip().lower().replace(' ', '_')}.scl",
        "!",
        description,
        " 12",
        "!",
    ]
    lines += [f" {v:.6f}" for v in values]
    return "\n".join(lines) + "\n"


def equal_temperament() -> str:
    lines = [
        "! equal.scl",
        "!",
        "12-tone equal temperament (control)",
        " 12",
        "!",
    ]
    lines += [f" {100.0 * i:.6f}" for i in range(1, 13)]
    return "\n".join(lines) + "\n"


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "data" / "temperaments"
    out.mkdir(parents=True, exist_ok=True)

    quarter_pc = PYTHAGOREAN_COMMA / 4.0
    sixth_pc = PYTHAGOREAN_COMMA / 6.0
    quarter_sc = SYNTONIC_COMMA / 4.0

    files = {
        "equal.scl": equal_temperament(),
        # Six fifths F-C-G-D-A-E-B each narrowed by 1/6 Pythagorean comma.
        "vallotti.scl": build(
            {
                "F-C": sixth_pc, "C-G": sixth_pc, "G-D": sixth_pc,
                "D-A": sixth_pc, "A-E": sixth_pc, "E-B": sixth_pc,
            },
            "Vallotti, 1/6-comma well temperament",
        ),
        # C-G, G-D, D-A, B-F# each narrowed by 1/4 Pythagorean comma.
        "werckmeister3.scl": build(
            {
                "C-G": quarter_pc, "G-D": quarter_pc,
                "D-A": quarter_pc, "B-F#": quarter_pc,
            },
            "Werckmeister III, 1/4-comma well temperament",
        ),
        # C-G-D-A-E narrowed by 1/4 syntonic comma (pure C-E third);
        # F#-C# absorbs the leftover schisma.
        "kirnberger3.scl": build(
            {
                "C-G": quarter_sc, "G-D": quarter_sc,
                "D-A": quarter_sc, "A-E": quarter_sc,
                "F#-C#": SCHISMA,
            },
            "Kirnberger III, pure C-E third",
        ),
    }

    # Quarter-comma meantone does not close the circle (it has a wolf fifth), so
    # it is built directly from its eleven pure-third-producing fifths.
    meantone_fifth = 1200.0 * math.log2(5.0 ** 0.25)
    cents = {"C": 0.0}
    running = 0.0
    for name in CHAIN[1:9]:            # G D A E B F# C# G#
        running += meantone_fifth
        cents[name] = running % 1200.0
    running = 0.0
    for name in ["F", "Bb", "Eb"]:     # downward from C
        running -= meantone_fifth
        cents[name] = running % 1200.0
    ordered = sorted(cents.items(), key=lambda kv: PITCH_CLASS[kv[0]])
    values = [c for _, c in ordered][1:] + [1200.0]
    files["meantone_quarter.scl"] = "\n".join(
        ["! meantone_quarter.scl", "!",
         "Quarter-comma meantone, pure major thirds, wolf G#-Eb", " 12", "!"]
        + [f" {v:.6f}" for v in values]
    ) + "\n"

    for name, body in files.items():
        (out / name).write_text(body, encoding="utf-8")
        print(f"wrote {name}")


if __name__ == "__main__":
    main()
