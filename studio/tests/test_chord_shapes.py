import pytest

from studio.chord_shapes import INTERVALS, WINDOW, chord_shape, pitch_class, shape_for_chord
from studio.fretboard import TUNINGS


def text(shape):
    """Low string first, as chord charts write it: x32010."""
    return "".join("x" if f is None else str(f) for f in reversed(shape.frets))


@pytest.mark.parametrize(
    "root, quality, expected",
    [("C", "", "x32010"), ("G", "", "320003"), ("D", "", "xx0232"), ("A", "7", "x02020"),
     ("A", "m", "x02210"), ("E", "", "022100"), ("E", "m", "022000")],
)  # fmt: skip
def test_open_guitar_shapes(root, quality, expected):
    assert text(chord_shape(pitch_class(root), quality, None, "guitar")) == expected


@pytest.mark.parametrize(
    "root, quality, expected",
    [("C", "", "0003"), ("A", "m", "2000"), ("F", "", "2010"), ("G", "", "0232")],
)
def test_ukulele_shapes(root, quality, expected):
    # Written G C E A, string 4 first.
    assert text(chord_shape(pitch_class(root), quality, None, "ukulele")) == expected


def test_a_capo_shifts_the_shape():
    assert text(chord_shape(pitch_class("D"), "", None, "guitar", capo=2)) == "x32010"


def test_a_slash_chord_puts_its_bass_lowest():
    shape = chord_shape(pitch_class("C"), "", pitch_class("G"), "guitar")
    strings = TUNINGS["guitar"]
    lowest = max(s for s, f in enumerate(shape.frets) if f is not None)
    assert (strings[lowest] + shape.frets[lowest]) % 12 == pitch_class("G")


def test_high_shapes_show_their_first_fret():
    shape = chord_shape(pitch_class("B"), "m7", None, "ukulele")
    fretted = [f for f in shape.frets if f]
    assert shape.first_fret == (1 if max(fretted) <= WINDOW else min(fretted))


def test_from_a_detected_chord():
    shape = shape_for_chord({"root": "F#", "quality": "sus4", "bass": None}, "guitar", 0)
    assert shape is not None


@pytest.mark.parametrize("tuning", sorted(TUNINGS))
def test_every_chord_has_a_playable_shape(tuning):
    strings = TUNINGS[tuning]
    for root in range(12):
        for quality, intervals in INTERVALS.items():
            shape = chord_shape(root, quality, None, tuning)
            assert shape is not None, (tuning, root, quality)
            played = [(s, f) for s, f in enumerate(shape.frets) if f is not None]
            sounding = {(strings[s] + f) % 12 for s, f in played}
            tones = {(root + i) % 12 for i in intervals}
            fifth = (root + 7) % 12
            assert tones - {fifth} <= sounding <= tones
            fretted = [f for _, f in played if f > 0]
            assert not fretted or max(fretted) - min(fretted) < WINDOW
            if not tuning.startswith("ukulele"):
                lowest = max(s for s, _ in played)
                assert (strings[lowest] + shape.frets[lowest]) % 12 == root
                assert all(shape.frets[s] is not None for s in range(lowest))
            else:
                assert len(played) == len(strings)
