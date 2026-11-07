import { BasicMIDI } from "spessasynth_core";
import { audioBufferToWav, WorkletSynthesizer } from "spessasynth_lib";
import workletUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url";

const RATE = 44100;
/** Room for the last notes to ring out. */
const TAIL_SECONDS = 3;

/**
 * A WAV of `midi`, rendered in the browser with the same synthesizer and
 * soundfont as playback, so it sounds like what the user hears and needs no
 * other program.
 */
export async function renderAudio(midi: Blob): Promise<Blob> {
  const [midiBytes, soundBankBuffer] = await Promise.all([
    midi.arrayBuffer(),
    fetch("/soundfonts/MuseScore_General.sf3").then((resp) => {
      if (!resp.ok) throw new Error("The soundfont isn't available, so audio can't be rendered.");
      return resp.arrayBuffer();
    }),
  ]);
  const sequence = BasicMIDI.fromArrayBuffer(midiBytes);
  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    sampleRate: RATE,
    length: Math.ceil((sequence.duration + TAIL_SECONDS) * RATE),
  });
  await context.audioWorklet.addModule(workletUrl);
  const synth = new WorkletSynthesizer(context);
  synth.connect(context.destination);
  await synth.startOfflineRender({
    midiSequence: sequence,
    loopCount: 0,
    soundBankList: [{ bankOffset: 0, soundBankBuffer }],
  });
  const rendered = await context.startRendering();
  synth.destroy();
  return audioBufferToWav(rendered);
}
