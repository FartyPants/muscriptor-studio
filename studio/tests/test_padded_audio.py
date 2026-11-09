import io

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from studio.app import create_studio_app, read_audio
from studio.models import SwitchableModel


def padded_mp3() -> bytes:
    """An MP3 with zero bytes before its first frame, as some encoders leave."""
    buffer = io.BytesIO()
    tone = 0.2 * np.sin(np.linspace(0, 2000, 44100))
    sf.write(buffer, tone, 44100, format="MP3", subtype="MPEG_LAYER_III")
    return bytes(1044) + buffer.getvalue()


def test_zero_bytes_before_the_audio_do_not_stop_it_being_read(tmp_path):
    # Not .mp3: the name must not be what makes this work.
    path = tmp_path / "audio.bin"
    path.write_bytes(padded_mp3())
    wav, rate = read_audio(path)
    assert rate == 44100
    assert wav.shape[1] > 40000


def test_transcribe_accepts_such_a_file(tmp_path):
    weights = tmp_path / "medium"
    weights.write_bytes(b"x")
    holder = SwitchableModel(
        loader=lambda s, d: object(), free=lambda: None, exporter=None, weights={"medium": weights}
    )
    client = TestClient(create_studio_app(holder, data_dir=tmp_path, autoload="medium", tagger=None))
    # An unknown instrument is refused after decoding and before the model runs.
    r = client.post(
        "/transcribe",
        files={"file": ("song.mp3", padded_mp3(), "audio/mpeg")},
        data={"instruments": ["banana"]},
    )
    assert r.status_code == 400
    assert "unknown instrument" in r.json()["detail"]


def test_a_file_that_is_not_audio_is_still_refused(tmp_path):
    path = tmp_path / "audio.bin"
    path.write_bytes(bytes(1044) + b"not audio at all" * 50)
    with pytest.raises(sf.LibsndfileError):
        read_audio(path)
