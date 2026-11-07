"""Name the instruments in a whole song, quickly, with an audio tagger.

AST, trained on AudioSet (BSD-3-Clause), lives in `models/tagger/`. It hears
solo instruments that the transcription model rarely names without a hint, but
it is weak on the rhythm section of a dense mix. So its finds are offered as
suggestions, not added to the list.
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np

from studio.models import MODELS_DIR

logger = logging.getLogger(__name__)

TAGGER_DIR = MODELS_DIR / "tagger"
RATE = 16000
CLIP_SECONDS = 10
BATCH = 8
# The strongest clip must reach this. Tested on four songs: real solos scored
# 0.42 to 0.84, while instruments that weren't there stayed under 0.3.
MIN_SCORE = 0.3

# AudioSet label, the name to show, and the transcription instruments it can mean.
LABELS: dict[str, tuple[str, tuple[str, ...]]] = {
    "Saxophone": ("Saxophone", ("tenor_sax", "soprano_and_alto_sax", "baritone_sax")),
    "Trumpet": ("Trumpet", ("trumpet",)),
    "Trombone": ("Trombone", ("trombone",)),
    "French horn": ("French horn", ("french_horn",)),
    "Brass instrument": ("Brass section", ("brass_section",)),
    "Clarinet": ("Clarinet", ("clarinet",)),
    "Flute": ("Flute", ("flutes",)),
    "Piano": ("Piano", ("acoustic_piano",)),
    "Electric piano": ("Electric piano", ("electric_piano",)),
    "Organ": ("Organ", ("organ",)),
    "Hammond organ": ("Organ", ("organ",)),
    "Violin, fiddle": ("Violin", ("violin",)),
    "Cello": ("Cello", ("cello",)),
    "Double bass": ("Double bass", ("contrabass",)),
    "String section": ("Strings", ("string_ensemble",)),
    "Harp": ("Harp", ("orchestral_harp",)),
    "Acoustic guitar": ("Acoustic guitar", ("acoustic_guitar",)),
    "Electric guitar": ("Electric guitar", ("clean_electric_guitar", "distorted_electric_guitar")),
    "Bass guitar": ("Bass guitar", ("electric_bass",)),
    "Drum kit": ("Drums", ("drums",)),
    "Singing": ("Voice", ("voice",)),
    "Synthesizer": ("Synthesizer", ("synth_lead", "synth_pad")),
}


def suggestions_from(peaks: dict[str, float]) -> list[dict[str, Any]]:
    """Strongest first, one entry per instrument name, from peak score per label."""
    scores = dict(peaks)
    # The tagger hears any piano as both. Keep whichever it is surer of.
    piano, electric = scores.get("Piano", 0.0), scores.get("Electric piano", 0.0)
    if piano >= electric:
        scores.pop("Electric piano", None)
    else:
        scores.pop("Piano", None)

    best: dict[str, dict[str, Any]] = {}
    for label, score in scores.items():
        if label not in LABELS or score < MIN_SCORE:
            continue
        name, instruments = LABELS[label]
        if name not in best or score > best[name]["score"]:
            best[name] = {"label": name, "instruments": list(instruments), "score": round(float(score), 3)}
    return sorted(best.values(), key=lambda s: -s["score"])


def tag_instruments(wav: Any, sample_rate: int) -> list[dict[str, Any]]:
    """Suggestions for a whole song. Loads the tagger, and frees it after."""
    import torch
    import torchaudio
    from transformers import ASTFeatureExtractor, ASTForAudioClassification

    device = "cuda" if torch.cuda.is_available() else "cpu"
    extractor = ASTFeatureExtractor.from_pretrained(TAGGER_DIR, local_files_only=True)
    model = ASTForAudioClassification.from_pretrained(TAGGER_DIR, local_files_only=True)
    model.to(device).eval()
    try:
        audio = torch.as_tensor(np.asarray(wav), dtype=torch.float32)
        mono = audio.reshape(-1, audio.shape[-1]).mean(dim=0)
        mono = torchaudio.functional.resample(mono, sample_rate, RATE).numpy()
        size = CLIP_SECONDS * RATE
        clips = [mono[i : i + size] for i in range(0, max(1, len(mono) - RATE), size)]

        labels = model.config.id2label
        wanted = [i for i, name in labels.items() if name in LABELS]
        peaks = np.zeros(len(wanted))
        for start in range(0, len(clips), BATCH):
            batch = extractor(
                [c.astype(np.float64) for c in clips[start : start + BATCH]],
                sampling_rate=RATE,
                return_tensors="pt",
            )
            with torch.inference_mode():
                logits = model(batch["input_values"].to(device)).logits
            scores = torch.sigmoid(logits)[:, wanted].max(dim=0).values.cpu().numpy()
            peaks = np.maximum(peaks, scores)
        return suggestions_from({labels[i]: float(p) for i, p in zip(wanted, peaks)})
    finally:
        del model
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


def safe_tag(wav: Any, sample_rate: int) -> list[dict[str, Any]]:
    """Suggestions, or none if the tagger can't run: the scan still works without it."""
    try:
        return tag_instruments(wav, sample_rate)
    except Exception:
        logger.exception("audio tagger failed")
        return []
