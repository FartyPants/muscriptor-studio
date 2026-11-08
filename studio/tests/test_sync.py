import hashlib

from studio.sync import build_sync


def at(rate=0.5, start=0.0):
    return lambda quarters: [round(start + q * rate, 4) for q in quarters]


def doc(measures=(0, 4), end=8.0, source="tempo-map", seconds=None, **audio):
    return build_sync(list(measures), seconds or at(), end, source, "a.musicxml", b"xml", **audio)


def test_the_fields_are_exactly_the_agreed_ones():
    sync = doc(audio_filename="a.wav", audio_duration=12.5)
    assert sync["format"] == "score-audio-sync"
    assert sync["version"] == 1
    assert sync["score"] == {"filename": "a.musicxml", "sha256": hashlib.sha256(b"xml").hexdigest()}
    assert sync["audio"] == {"filename": "a.wav", "durationSeconds": 12.5}
    assert sync["timingSource"] == "tempo-map"
    assert sync["endQuarter"] == 8.0 and sync["endSeconds"] == 4.0


def test_one_anchor_per_quarter_below_the_end():
    anchors = doc()["anchors"]
    assert [a["quarter"] for a in anchors] == [0, 1, 2, 3, 4, 5, 6, 7]
    assert anchors[3] == {"quarter": 3.0, "seconds": 1.5}


def test_a_measure_start_between_quarters_gets_its_own_anchor():
    quarters = [a["quarter"] for a in doc(measures=(0, 2.5, 5.0), end=7.5)["anchors"]]
    assert quarters == [0, 1, 2, 2.5, 3, 4, 5, 6, 7]


def test_seconds_are_never_clamped():
    sync = doc(seconds=at(start=-2.0), end=8.0)
    assert sync["anchors"][0]["seconds"] == -2.0
    late = doc(seconds=at(start=500.0), audio_duration=10.0)
    assert late["endSeconds"] == 504.0


def test_quarter_zero_comes_first_even_for_an_empty_score():
    sync = doc(measures=(), end=0.0)
    assert [a["quarter"] for a in sync["anchors"]] == [0.0]


def test_what_is_not_known_about_the_audio_is_left_out():
    assert "audio" not in doc()
    assert doc(audio_filename="a.wav")["audio"] == {"filename": "a.wav"}
    assert doc(audio_duration=3.0)["audio"] == {"durationSeconds": 3.0}


def test_anchors_strictly_increase():
    anchors = doc(measures=(0, 2.5, 5.0), end=7.5)["anchors"]
    quarters = [a["quarter"] for a in anchors]
    seconds = [a["seconds"] for a in anchors]
    assert all(b > a for a, b in zip(quarters, quarters[1:]))
    assert all(b > a for a, b in zip(seconds, seconds[1:]))


def test_nothing_is_anchored_at_or_past_the_end():
    assert [a["quarter"] for a in doc(measures=(0, 4, 8), end=8.0)["anchors"]][-1] == 7.0

