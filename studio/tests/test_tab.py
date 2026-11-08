import xml.etree.ElementTree as ET

from studio.engrave import measure_map
from studio.tab import _pitch_of, add_tab_staff, find_part

NAMES = {0: ("C", 0), 2: ("D", 0), 4: ("E", 0), 5: ("F", 0), 7: ("G", 0), 9: ("A", 0), 11: ("B", 0)}


def note(pitch=None, duration=4, voice=1, chord=False, tie=None, kind="quarter"):
    parts = []
    if chord:
        parts.append("<chord/>")
    if pitch is None:
        parts.append("<rest/>")
    else:
        step, _ = NAMES[pitch % 12]
        parts.append(f"<pitch><step>{step}</step><octave>{pitch // 12 - 1}</octave></pitch>")
    parts.append(f"<duration>{duration}</duration>")
    if tie:
        parts.append(f'<tie type="{tie}"/>')
    parts.append(f"<voice>{voice}</voice><type>{kind}</type><stem>up</stem>")
    if tie:
        parts.append(f'<notations><tied type="{tie}"/></notations>')
    return f'<note default-x="10">{"".join(parts)}</note>'


def score(measures, name="Classical Guitar, acoustic guitar", drums=False):
    """One part; each measure is a list of note/backup strings."""
    body = []
    for i, content in enumerate(measures):
        attrs = ""
        if i == 0:
            attrs = (
                "<attributes><divisions>4</divisions><key><fifths>0</fifths></key>"
                "<time><beats>4</beats><beat-type>4</beat-type></time>"
                "<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>"
                "</attributes>"
            )
        if drums:
            content = [c.replace("<pitch>", "<unpitched>").replace("</pitch>", "</unpitched>") for c in content]
        body.append(f'<measure number="{i + 1}">{attrs}<harmony><root><root-step>C</root-step></root>'
                    f'<kind>major</kind></harmony>{"".join(content)}</measure>')
    xml = (
        '<score-partwise><part-list><score-part id="P1"><part-name>'
        f"{name}</part-name></score-part></part-list>"
        f'<part id="P1">{"".join(body)}</part></score-partwise>'
    )
    return ET.fromstring(xml)


BACKUP = "<backup><duration>16</duration></backup>"


def tab_notes(measure):
    return [n for n in measure.findall("note") if n.findtext("staff") == "2"]


def staff_end(measure, staff):
    """Where the last element of `staff` ends, per voice, relative to the measure start."""
    pos, ends, last = 0, {}, 0
    for e in measure:
        if e.tag == "backup":
            pos -= int(e.findtext("duration"))
        elif e.tag == "forward":
            pos += int(e.findtext("duration"))
        elif e.tag == "note":
            if e.find("chord") is None:
                last = pos
                pos += int(e.findtext("duration"))
            if e.findtext("staff") == str(staff):
                voice = e.findtext("voice")
                ends[voice] = max(ends.get(voice, 0), last + int(e.findtext("duration")))
    return ends


def two_voices():
    return score([
        [note(48, 8, kind="half"), note(52, 8, chord=True, kind="half"), note(55, 8, chord=True, kind="half"),
         note(60, 4), note(62, 4), BACKUP, note(36, 16, voice=2, kind="whole")],
        [note(64, 16, kind="whole"), BACKUP, note(None, 16, voice=2, kind="whole")],
    ])


def test_each_voice_of_the_tab_staff_fills_the_measure():
    root = two_voices()
    report = add_tab_staff(root, "acoustic_guitar", "guitar", 0)
    assert report == {"moved": 1, "dropped": 0}  # the low C2 goes up to C3
    for measure in root.iter("measure"):
        ends = staff_end(measure, 2)
        assert ends and all(end == 16 for end in ends.values()), ends
        for n in tab_notes(measure):
            if n.find("pitch") is not None:
                assert n.findtext("notations/technical/string")
                assert n.findtext("notations/technical/fret")
                assert n.find("stem") is None and "default-x" not in n.attrib
            assert int(n.findtext("voice")) >= 5


def test_the_part_gets_two_staves_and_the_tuning():
    root = two_voices()
    add_tab_staff(root, "acoustic_guitar", "ukulele", 2)
    attributes = root.find("part/measure/attributes")
    assert attributes.findtext("staves") == "2"
    clefs = attributes.findall("clef")
    assert [c.get("number") for c in clefs] == ["1", "2"]
    assert clefs[1].findtext("sign") == "TAB"
    details = attributes.find("staff-details")
    assert details.findtext("staff-lines") == "4"
    # The bottom line is string 4, the ukulele's high G.
    lines = {t.get("line"): (t.findtext("tuning-step"), t.findtext("tuning-octave")) for t in details.findall("staff-tuning")}
    assert lines == {"1": ("G", "4"), "2": ("C", "4"), "3": ("E", "4"), "4": ("A", "4")}
    assert details.findtext("capo") == "2"
    tags = [c.tag for c in attributes]
    assert tags.index("time") < tags.index("staves") < tags.index("clef")


def test_the_notation_staff_is_kept_and_marked():
    root = two_voices()
    before = [_pitch_of(n) for n in root.iter("note")]
    add_tab_staff(root, "acoustic_guitar", "guitar", 0)
    first = [n for n in root.iter("note") if n.findtext("staff") == "1"]
    assert [_pitch_of(n) for n in first] == before
    assert all(n.find("stem") is not None for n in first if n.find("pitch") is not None)


def test_moved_notes_show_their_played_octave_in_the_tab():
    root = two_voices()
    add_tab_staff(root, "acoustic_guitar", "guitar", 0)
    pitches = [_pitch_of(n) for n in tab_notes(root.find("part/measure"))]
    assert 48 in pitches and 36 not in pitches


def test_a_chord_too_wide_keeps_its_outer_notes_and_a_lead():
    chord = [40, 45, 50, 55, 59, 64, 67]
    measure = [note(p, 16, chord=i > 0, kind="whole") for i, p in enumerate(chord)]
    root = score([measure])
    report = add_tab_staff(root, "acoustic_guitar", "guitar", 0)
    assert report["dropped"] == 1
    tab = tab_notes(root.find("part/measure"))
    assert len(tab) == 6
    assert tab[0].find("chord") is None
    assert all(n.find("chord") is not None for n in tab[1:])
    assert {_pitch_of(n) for n in tab} >= {40, 67}


def test_a_dropped_lead_hands_over_to_the_next_note():
    # Ukulele: the chord's first written note is the one left out.
    chord = [64, 48, 60, 67, 69, 71]
    measure = [note(p, 16, chord=i > 0, kind="whole") for i, p in enumerate(chord)]
    root = score([measure])
    add_tab_staff(root, "acoustic_guitar", "ukulele", 0)
    tab = tab_notes(root.find("part/measure"))
    assert len(tab) == 4
    assert tab[0].find("chord") is None and all(n.find("chord") is not None for n in tab[1:])
    assert staff_end(root.find("part/measure"), 2) == {"5": 16}


def test_a_tie_keeps_its_string_and_fret():
    root = score([
        [note(None, 12, kind="half"), note(57, 4, tie="start")],
        [note(57, 16, tie="stop", kind="whole")],
    ])
    add_tab_staff(root, "acoustic_guitar", "guitar", 0)
    measures = root.findall("part/measure")
    start = [n for n in tab_notes(measures[0]) if n.find("pitch") is not None][0]
    stop = tab_notes(measures[1])[0]
    where = lambda n: (n.findtext("notations/technical/string"), n.findtext("notations/technical/fret"))
    assert where(start) == where(stop) != (None, None)


def test_measure_starts_and_chords_are_unchanged():
    root = two_voices()
    measures = root.findall("part/measure")
    before = measure_map(measures)
    harmony_before = [list(m).index(m.find("harmony")) for m in measures]
    add_tab_staff(root, "acoustic_guitar", "guitar", 0)
    assert measure_map(root.findall("part/measure")) == before
    # The chord symbols stay ahead of every note, so their offsets still count from the bar.
    for m, at in zip(root.findall("part/measure"), harmony_before):
        assert list(m).index(m.find("harmony")) == at


def test_no_part_no_tab():
    assert add_tab_staff(two_voices(), "violin", "guitar", 0) is None
    drums = score([[note(36, 16, kind="whole")]], name="Percussion, drums", drums=True)
    assert add_tab_staff(drums, "drums", "guitar", 0) is None


def test_find_part_by_track_name():
    root = two_voices()
    assert find_part(root, "acoustic_guitar") is root.find("part")
    assert find_part(root, "electric_guitar") is None
