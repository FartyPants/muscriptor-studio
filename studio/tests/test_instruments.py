import json

import numpy as np
import pytest
import torch
from fastapi.testclient import TestClient

from muscriptor.events import NoteEndEvent, NoteStartEvent, ProgressEvent
from studio.app import create_studio_app
from studio.instruments import pick_windows, scan_instruments
from studio.models import SwitchableModel
from studio.tagger import LABELS, safe_tag, suggestions_from
from studio.tests.test_app import wav_bytes

RATE = 100


def tone(seconds, loud_at=()):
    wav = np.full(int(seconds * RATE), 0.001, dtype=np.float32)
    for at in loud_at:
        wav[int(at * RATE) : int((at + 5) * RATE)] = 0.9
    return wav[np.newaxis, :]


class Scripted:
    """Plays what `script` says for each passage, in order."""

    def __init__(self, script):
        self.script = iter(script)
        self.heard = []

    def transcribe(self, audio, **kwargs):
        wav, rate = audio
        self.heard.append((wav.shape[-1], rate, kwargs))
        yield ProgressEvent(completed=0, total=1)
        for i, name in enumerate(next(self.script, [])):
            start = NoteStartEvent(pitch=60, start_time=0.0, index=i, instrument=name)
            yield start
            yield NoteEndEvent(end_time=0.5, start_event=start)


def scan(model, wav=None):
    return list(scan_instruments(model, tone(100) if wav is None else wav, RATE))


class TestTaggerFirst:
    def test_suggestions_arrive_before_the_scan(self):
        heard = [{"label": "Saxophone", "instruments": ["tenor_sax"], "score": 0.8}]
        model = Scripted([["violin", "violin"]])
        events = list(scan_instruments(model, tone(100), RATE, lambda w, r: heard))
        assert events[0] == {"type": "heard", "suggestions": heard}
        assert events[1]["type"] == "progress"
        assert events[-1]["type"] == "instruments"

    def test_no_tagger_means_no_suggestions_event(self):
        assert "heard" not in [e["type"] for e in scan(Scripted([]))]


class TestSuggestions:
    def test_keeps_strong_labels_strongest_first(self):
        got = suggestions_from({"Saxophone": 0.84, "Trumpet": 0.5, "Guitar": 0.9, "Flute": 0.1})
        assert [s["label"] for s in got] == ["Saxophone", "Trumpet"]

    def test_saxophone_offers_each_type(self):
        got = suggestions_from({"Saxophone": 0.84})
        assert got[0]["instruments"] == ["tenor_sax", "soprano_and_alto_sax", "baritone_sax"]

    def test_a_piano_is_not_also_an_electric_piano(self):
        assert [s["label"] for s in suggestions_from({"Piano": 0.78, "Electric piano": 0.61})] == ["Piano"]
        assert [s["label"] for s in suggestions_from({"Piano": 0.4, "Electric piano": 0.7})] == [
            "Electric piano"
        ]

    def test_organ_labels_merge(self):
        got = suggestions_from({"Organ": 0.4, "Hammond organ": 0.6})
        assert [(s["label"], s["score"]) for s in got] == [("Organ", 0.6)]

    def test_every_suggestion_names_real_instruments(self):
        from muscriptor.tokenizer.mt3 import MT3_FULL_PLUS_GROUP_NAMES

        for _, instruments in LABELS.values():
            assert set(instruments) <= set(MT3_FULL_PLUS_GROUP_NAMES)

    def test_a_broken_tagger_gives_no_suggestions(self, monkeypatch):
        def boom(wav, rate):
            raise OSError("model missing")

        monkeypatch.setattr("studio.tagger.tag_instruments", boom)
        assert safe_tag(tone(1), RATE) == []


class TestPickWindows:
    def test_short_audio_is_used_whole(self):
        assert pick_windows(tone(3), RATE) == [(0, 300)]

    def test_uses_every_window_when_few_exist(self):
        assert pick_windows(tone(17), RATE) == [(0, 500), (500, 1000), (1000, 1500)]

    def test_spreads_across_the_piece(self):
        windows = pick_windows(tone(400), RATE, count=8)
        assert len(windows) == 8
        starts = [s for s, _ in windows]
        assert starts == sorted(starts)
        assert starts[0] < 50 * RATE
        assert starts[-1] >= 350 * RATE

    def test_prefers_the_loud_window_in_each_section(self):
        # Mostly near-silent, one loud passage late in the first half.
        windows = pick_windows(tone(100, loud_at=[40]), RATE, count=2)
        assert (40 * RATE, 45 * RATE) in windows

    def test_windows_are_five_seconds_and_inside_the_audio(self):
        for start, end in pick_windows(tone(123.4), RATE):
            assert end - start == 500
            assert end <= 12340

    def test_accepts_a_tensor(self):
        assert len(pick_windows(torch.from_numpy(tone(100)), RATE)) == 8


class TestScan:
    def test_reports_progress_for_every_sample(self):
        events = scan(Scripted([]))
        steps = [e["completed"] for e in events if e["type"] == "progress"]
        assert steps == list(range(9))
        assert events[0]["total"] == 8

    def test_counts_across_samples_most_notes_first(self):
        events = scan(Scripted([["violin", "violin"], ["drums", "drums", "drums"], ["violin"]]))
        assert events[-1] == {
            "type": "instruments",
            "instruments": [{"name": "violin", "notes": 3}, {"name": "drums", "notes": 3}],
        }

    def test_drops_a_single_stray_note(self):
        events = scan(Scripted([["violin", "violin", "flute"]]))
        assert [i["name"] for i in events[-1]["instruments"]] == ["violin"]

    def test_finds_nothing_in_silence(self):
        assert scan(Scripted([]))[-1]["instruments"] == []

    def test_sends_only_the_passage_with_no_instrument_limit(self):
        model = Scripted([])
        scan(model)
        assert len(model.heard) == 8
        for length, rate, kwargs in model.heard:
            assert length == 500
            assert rate == RATE
            assert "instruments" not in kwargs


def post(c, pid):
    r = c.post(f"/studio/api/projects/{pid}/detect-instruments")
    events = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
    return r, events


@pytest.fixture
def weights(tmp_path):
    p = tmp_path / "large"
    p.write_bytes(b"x")
    return {"large": p}


def app_for(weights, tmp_path, model):
    holder = SwitchableModel(
        loader=lambda s, d: model, free=lambda: None, exporter=object(), weights=weights
    )
    return holder, TestClient(create_studio_app(holder, data_dir=tmp_path, tagger=None))


def project(c):
    return c.post("/studio/api/projects", files={"file": ("a.wav", wav_bytes())}).json()["id"]


class TestRoute:
    def test_streams_a_result(self, weights, tmp_path):
        holder, c = app_for(weights, tmp_path, Scripted([["violin", "violin"]]))
        holder.load("large")
        r, events = post(c, project(c))
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        assert events[-1]["instruments"] == [{"name": "violin", "notes": 2}]
        assert not holder.busy

    def test_unknown_project_is_404(self, weights, tmp_path):
        holder, c = app_for(weights, tmp_path, Scripted([]))
        holder.load("large")
        assert post(c, "f" * 32)[0].status_code == 404
        assert not holder.busy

    def test_needs_a_model(self, weights, tmp_path):
        _, c = app_for(weights, tmp_path, Scripted([]))
        r, _ = post(c, project(c))
        assert r.status_code == 503
        assert r.json() == {"detail": "no model loaded"}

    def test_refused_during_a_transcription(self, weights, tmp_path):
        holder, c = app_for(weights, tmp_path, Scripted([]))
        holder.load("large")
        pid = project(c)
        assert holder.try_enter_request() is None
        assert post(c, pid)[0].status_code == 503
        holder.leave_request()

    def test_a_scan_failure_is_reported_in_the_stream(self, weights, tmp_path):
        class Broken:
            def transcribe(self, *args, **kwargs):
                raise RuntimeError("CUDA out of memory")
                yield

        holder, c = app_for(weights, tmp_path, Broken())
        holder.load("large")
        _, events = post(c, project(c))
        assert events[-1] == {"type": "error", "message": "CUDA out of memory"}
        assert not holder.busy


class TestExclusion:
    def test_a_scan_blocks_transcribing_and_switching(self, weights, tmp_path):
        holder, _ = app_for(weights, tmp_path, Scripted([]))
        holder.load("large")
        assert holder.try_enter_scan() is None
        assert holder.busy
        assert holder.try_enter_request() == "instrument analysis running"
        assert holder.try_enter_scan() == "instrument analysis running"
        holder.leave_scan()
        assert not holder.busy
        assert holder.try_enter_request() is None
        holder.leave_request()
