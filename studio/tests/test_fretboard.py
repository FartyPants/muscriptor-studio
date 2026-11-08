import random

import pytest

from studio.fretboard import MAX_FRET, TUNINGS, fit_pitch, fret_groups


def frets_by_string(group, strings):
    """Fret per string, from the lowest string to string 1; None for unplayed."""
    played = {f.string: f.fret for f in group if f.string is not None}
    return [played.get(s) for s in range(strings, 0, -1)]


def test_open_e_major():
    result = fret_groups([[40, 47, 52, 56, 59, 64]], "guitar")
    assert frets_by_string(result.groups[0], 6) == [0, 2, 2, 1, 0, 0]
    assert result.moved == 0 and result.dropped == 0


def test_c_major_scale_stays_in_first_position():
    scale = [48, 50, 52, 53, 55, 57, 59, 60]
    result = fret_groups([[p] for p in scale], "guitar")
    assert all(g[0].fret <= 3 for g in result.groups)


def test_a_repeated_chord_keeps_its_fingering():
    chord = [43, 47, 50, 55, 59, 67]  # G major
    result = fret_groups([chord] * 4, "guitar")
    shapes = [[(f.string, f.fret) for f in g] for g in result.groups]
    assert all(shape == shapes[0] for shape in shapes)


def test_ukulele_c_chord():
    result = fret_groups([[60, 64, 67, 72]], "ukulele")
    by_string = {f.string: f.fret for f in result.groups[0]}
    # Strings 1-4 are A, E, C and the high G.
    assert by_string == {4: 0, 3: 0, 2: 0, 1: 3}


def test_ukulele_moves_low_notes_up():
    result = fret_groups([[48]], "ukulele")
    assert result.groups[0][0].pitch == 60
    assert result.groups[0][0].source == 48
    assert result.moved == 1


def test_drop_d_and_capo():
    assert frets_by_string(fret_groups([[38]], "drop_d").groups[0], 6)[0] == 0
    spot = fret_groups([[42]], "guitar", capo=2).groups[0][0]
    assert (spot.string, spot.fret) == (6, 0)


def test_too_many_notes_keep_the_outer_ones():
    chord = [40, 45, 50, 55, 59, 64, 67]
    result = fret_groups([chord], "guitar")
    kept = [f.pitch for f in result.groups[0] if f.string is not None]
    assert len(kept) == 6 and 40 in kept and 67 in kept
    assert result.dropped == 1


def test_fit_pitch_reaches_down_from_the_top():
    assert fit_pitch(100, "guitar", 0) == 76
    assert fit_pitch(40, "guitar", 0) == 40


@pytest.mark.parametrize("tuning", sorted(TUNINGS))
def test_random_groups_are_playable(tuning):
    rng = random.Random(7)
    groups = [[rng.randint(30, 100) for _ in range(rng.randint(1, 7))] for _ in range(200)]
    capo = rng.randint(0, 7)
    result = fret_groups(groups, tuning, capo)
    assert len(result.groups) == len(groups)
    for group in result.groups:
        strings = [f.string for f in group if f.string is not None]
        assert strings, "every group sounds at least one note"
        assert len(strings) == len(set(strings))
        for f in group:
            if f.string is not None:
                assert 0 <= f.fret <= MAX_FRET
                assert TUNINGS[tuning][f.string - 1] + capo + f.fret == f.pitch
