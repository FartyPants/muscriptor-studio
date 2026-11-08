# MuScriptor Studio

Turn a recording into notes you can edit, hear and export. Studio is a local web interface built on [MuScriptor](https://github.com/muscriptor/muscriptor): a piano roll with note editing, sheet music with chord names, guitar and ukulele tablature and chord diagrams, MIDI, MusicXML and PDF export, and a library of your transcriptions.

![The piano roll, with chords, instruments and playback](media/ddimage40.jpg)

| Sheet music | Editing notes |
|---|---|
| ![The Score tab, with chord names and a playhead](media/ddimage41.jpg) | ![Editing one instrument's notes on the roll](media/ddimage42.jpg) |

**Tested on Windows.** Everything runs on your own computer, from this folder: Python, the packages, MuseScore and the models all stay inside it.

## What you need

- Windows 10 or 11, and [Git](https://git-scm.com/download/win).
- About 6 GB of disk, plus the models below.
- An NVIDIA GPU makes transcription much faster. Without one, Studio uses the CPU: choose the Small model.
- A free [Hugging Face](https://huggingface.co/join) account, to download the transcription models.
- Keep the folder path short, such as `C:\MuScriptor`. MuseScore's installer fails on very long paths.

## Install with install.bat

```bat
git clone <repository-url> C:\MuScriptor
cd /d C:\MuScriptor
install.bat
```

`install.bat` fetches uv, Python and the packages, unpacks MuseScore into the folder, and asks which models to download. If it stops, fix what it says and run it again: finished steps are skipped.

Then start Studio with `start-studio.bat`.

Before the models download, accept each model's licence on its page (see [Models](#models)). `install.bat` asks you to log in to Hugging Face when it first needs to: paste an access token from [your settings](https://huggingface.co/settings/tokens). A token with read access is enough.

## Manual install

The same steps by hand, in a Command Prompt (`cmd`), not PowerShell:

```bat
git clone <repository-url> C:\MuScriptor
cd /d C:\MuScriptor
call env.bat
powershell -NoProfile -ExecutionPolicy Bypass -File install\uv.ps1
.tools\uv\uv.exe python install 3.13 --no-bin --no-registry
.tools\uv\uv.exe venv .venv --python 3.13 --managed-python
.tools\uv\uv.exe pip install --python .venv\Scripts\python.exe --torch-backend=cu128 -c install\constraints.txt -e . -r studio\requirements.txt
```

Without an NVIDIA GPU, use `--torch-backend=cpu`. Don't use `uv sync`: it replaces the GPU build of PyTorch with the CPU one.

**MuseScore** draws the Score tab and the PDFs. Either unpack it into this folder:

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File install\musescore.ps1 -Force
```

or install it the usual way from [musescore.org](https://musescore.org/en/download). Studio finds either one, and everything else works without it.

**Models:** download them as described next, then start Studio with `start-studio.bat`.

## Models

The models aren't in this repository. Their licence is [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/): **non-commercial use only**. Open each model's page and accept the licence first.

| Model | Page | Download | Parameters | GPU memory | Good for |
|---|---|---|---|---|---|
| Small | [muscriptor-small](https://huggingface.co/MuScriptor/muscriptor-small) | 0.4 GB | 100M | 1.5 GB | Computers without a GPU |
| Medium (recommended) | [muscriptor-medium](https://huggingface.co/MuScriptor/muscriptor-medium) | 1.2 GB | 300M | 3 GB | CPU or GPU |
| Large | [muscriptor-large](https://huggingface.co/MuScriptor/muscriptor-large) | 5.5 GB | 1.4B | 12 GB | GPU, most accurate |
| Instrument detection | [ast-finetuned-audioset](https://huggingface.co/MIT/ast-finetuned-audioset-10-10-0.4593) | 0.3 GB | | | The Detect instruments button |

You need at least one transcription model.

**With the script,** from Command Prompt in this folder (`huggingface` will ask you to log in if needed):

```bat
call env.bat home
.venv\Scripts\python.exe -m studio.install_models medium tagger
```

Name any of `small`, `medium`, `large` and `tagger`. It also fetches the soundfonts and the beat tracker.

**By hand,** download these files from each model's *Files and versions* tab and put them here:

| Model | File on its page | Goes to |
|---|---|---|
| Small | `model.safetensors`, `config.json` | `models\small\` |
| Medium | `model.safetensors`, `config.json` | `models\medium\` |
| Large | `model.safetensors` | `models\muscriptor-large.safetensors` (renamed) |
| Large | `config.json` | `models\config.json` |
| Instrument detection | `model.safetensors`, `config.json`, `preprocessor_config.json` | `models\tagger\` |

Studio only offers the models it finds. The soundfonts and the beat tracker download into `models\` the first time they're needed.

## Moving to another computer

Install on the new computer the same way, choosing no models with `install.bat none`, then copy `models\` across. Copy `studio\data\` too if you want your transcriptions.

## What stays in the folder

| Where | What |
|---|---|
| `.tools\` | uv, Python, MuseScore, your Hugging Face login, and MuseScore's settings and logs |
| `.venv\` | Python packages |
| `models\` | Models, soundfonts, beat tracker |
| `studio\data\` | Your transcriptions |

Nothing is added to the Windows app list or to Program Files, and deleting the folder removes it all. If MuseScore was already installed, Studio uses that copy instead, and it's left as it is.

If you change the web code, rebuild it (`npm run build` in `studio\web`) and commit `studio\web_dist`, since the repository ships the built pages.

---

The rest of this page is MuScriptor's own documentation. The code is MIT licensed, by Kyutai and Mirelo; the model weights are CC BY-NC 4.0.

<p align="center">
  <img src="web/logo_muscriptor_final.png" alt="MuScriptor logo" width="300">
</p>

# MuScriptor

MuScriptor is a multi-instrument music transcription model developed by [Kyutai](https://kyutai.org) and [Mirelo](https://www.mirelo.ai).
It turns a recording into MIDI and into sheet music.
It's the most accurate open-source transcription model.
You can use the model [here](https://muscriptor.kyutai.org) or self-host it using this repository.


[Use it](https://muscriptor.kyutai.org) | [Paper](https://arxiv.org/abs/2607.08168v2) | [HuggingFace](https://huggingface.co/MuScriptor)

<!-- TODO: record the demo GIF (web UI piano roll), save it as assets/demo.gif,
     then uncomment:
<p align="center">
  <img src="assets/demo.gif" alt="MuScriptor web UI: live piano roll while transcribing" width="700">
</p>
-->

## HuggingFace login (required)

To use MuScriptor locally, you first need to log into [HuggingFace](https://huggingface.co/MuScriptor)
and accept the CC BY-NC 4.0 license.

1. Accept the model license on the model page for the [small](https://huggingface.co/MuScriptor/muscriptor-small),
   [medium](https://huggingface.co/MuScriptor/muscriptor-medium) or [large](https://huggingface.co/MuScriptor/muscriptor-large) model
   (access is granted automatically).
2. Authenticate on your machine:

   ```bash
   uvx hf auth login
   ```

   or set a token (create one at
   [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)):

   ```bash
   export HF_TOKEN=hf_...
   ```

The weights are then automatically downloaded on first use and cached locally.

## Try it locally

After Hugging Face authentication, you can use MuScriptor with `uvx` without having to clone this repo.

Some platforms need an extra `uvx` flag, on every `uvx muscriptor` command:

| Platform | Command |
|---|---|
| Linux, macOS with Apple Silicon | `uvx muscriptor serve` |
| Windows (to use the GPU) | `uvx --torch-backend=cu128 muscriptor serve` |
| macOS with Intel | `uvx --python 3.12 muscriptor serve` |

On Windows the default PyTorch backend is `cpu`, so the GPU needs
`--torch-backend=cu128`. On Intel Macs, PyTorch stopped shipping x86_64 wheels
after torch 2.2.2, which supports Python ≤ 3.12, so the Python version has to
be pinned (if you install with pip/uv instead, use Python 3.10–3.12).

## Web UI

You can host the web UI locally with:

```bash
uvx muscriptor serve
```

This gives you the same UI as hosted on https://muscriptor.kyutai.org/, just with a different look.

The sheet music download needs **MuseScore 4 or newer** installed separately (see
[Sheet music](#sheet-music) below). Without it, everything except that download still works.

## Command-line interface (CLI)

```bash
uvx muscriptor transcribe path/to/audio_file.wav
```

See `--help` for all the options.

### Tempo and quantization

The beats, time signature and bar lines are detected from the audio and written into the MIDI.
When the tempo isn't steady (no metronome), the MIDI gets a tempo map that follows the
performance, so the bar lines stay on the music; `--fixed-tempo` writes one average tempo instead.
When the detection is off, you can correct it, and tidy the notes up for notation software or a
DAW grid:

```bash
muscriptor transcribe audio.wav --bpm 96 --beats-per-bar 3 --first-downbeat 1.2 \
    --quantize --grid 4 --fill-gaps 0.25 --trim-leading-bars
```

- `--quantize` snaps notes onto the beat grid (`--grid 4` = sixteenths, `3` = eighth triplets;
  by default the one the notes sit on best), `--quantize-strength 0.5` only halfway.
- `--fill-gaps` holds notes until the next one across rests of up to that many beats, which
  notation software such as Guitar Pro would otherwise write out.
- `--trim-leading-bars` drops the empty bars before the first note.
- `--beat-scale 2` (or `0.5`) when the detected tempo is half (or double) what it should be.

The web UI has the same settings: the "Tempo & bars" panel and the MIDI download dialog.

### Sheet music

Using the CLI with `--format sheets` engraves the transcription as readable notation instead of
writing a single MIDI file.

```bash
muscriptor transcribe audio.wav --format sheets --output score/
```

The output structure looks like this:

```
score/
├── score.mid                       the transcription, as quantized MIDI
├── score.musicxml                  the engraved score, as MusicXML
├── full_score.pdf                  every instrument on one system
├── 01_electric_guitar.pdf          one PDF per instrument …
├── 01_electric_guitar_tab.pdf      … and a tablature PDF for fretted ones
├── 02_electric_bass.pdf
├── 02_electric_bass_tab.pdf
└── 03_drum_kit.pdf
```

This needs **MuseScore 4 or newer** installed separately. Downloads for every
platform are at [musescore.org/en/download](https://musescore.org/en/download).
Set `$MUSCRIPTOR_MUSESCORE` if it lives somewhere unusual.

It works best if there is a clear beat, because that allows us to quantize the notes (snap
them to a grid) for a cleaner transcription. Without a steady tempo the score follows the
performance's tempo changes; rubato recordings will still work noticeably worse.

## Using from Python

MuScriptor is also on PyPI, so you can install it with with uv (recommended) or with pip:

```bash
uv add muscriptor
```

```bash
pip install muscriptor
```

Ask your coding agent to show you around the codebase.

## Models

Three variants are published under the [MuScriptor](https://huggingface.co/MuScriptor)
HuggingFace organization. Everywhere a model is selected (`load_model()`, the
CLI's `--model`, `serve --model`) you can pass the bare size keyword and the
weights are downloaded and cached automatically. The architecture is a transformer decoder only. Here are the detailed model sizes:

| Variant | Parameters | Layers | Dim | HuggingFace repo |
|---|---|---|---|---|
| `small` | 103M | 14 | 768 | [muscriptor-small](https://huggingface.co/MuScriptor/muscriptor-small) |
| `medium` (default) | 307M | 24 | 1024 | [muscriptor-medium](https://huggingface.co/MuScriptor/muscriptor-medium) |
| `large` | 1.4B | 48 | 1536 | [muscriptor-large](https://huggingface.co/MuScriptor/muscriptor-large) |

`small` is the practical choice on CPU-only machines, `medium` is the default
speed/accuracy trade-off, and `large` is the most accurate but really wants a
GPU. On Apple Silicon the model runs on Metal (MPS) automatically.

## Developing

To set up for development, get [uv](https://docs.astral.sh/uv/getting-started/installation/),
clone this repo and run:
```bash
uv sync
```

For the web UI, you also need [pnpm](https://pnpm.io/installation) and Node
(can be installed [via pnpm](https://pnpm.io/cli/runtime)).
Then run:

```bash
cd web
pnpm install
pnpm run build
```

If you're not editing the frontend, you only need to do this once.
If you are, run `pnpm dev` instead for a hot-reloading dev server.
Start the backend alongside it with it using `uv run muscriptor serve --port 8222`
and then open the frontend on http://localhost:5173/.

### Run

After this setup, you can run Muscriptor from your local repository using
`uv` (note - not `uvx` like before):

```bash
uv run muscriptor serve
# or 
uv run muscriptor transcribe path/to/audio_file.wav
```

Again, see `--help` for more options.

## License

The code in this repository is released under the [MIT license](LICENSE).

The model weights, published on
[HuggingFace](https://huggingface.co/MuScriptor), are released under the
[CC BY-NC 4.0 license](https://creativecommons.org/licenses/by-nc/4.0/)
(non-commercial use).

The MuseScore General SoundFont downloaded for playback is
distributed under its own (MIT) license.

## Citation

```bibtex
@misc{rouard2026muscriptoropenmodelmultiinstrument,
      title={MuScriptor: An Open Model for Multi-Instrument Music Transcription}, 
      author={Simon Rouard and Michael Krause and Axel Roebel and Carl-Johann Simon-Gabriel and Alexandre Défossez},
      year={2026},
      eprint={2607.08168},
      archivePrefix={arXiv},
      primaryClass={cs.SD},
      url={https://arxiv.org/abs/2607.08168}, 
}
```
