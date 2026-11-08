import * as Tone from "tone";
import { WorkletSynthesizer } from "spessasynth_lib";
import type { Click } from "./metronome";
import workletUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url";

/**
 * Playback goes through spessasynth_lib, a full SoundFont synthesizer running
 * in an AudioWorklet, fed with MuseScore_General.sf3 (the vorbis-compressed
 * build of the same soundfont the backend's fluidsynth /auralize uses). The
 * backend serves it at /soundfonts/ from a locally-cached download — see
 * muscriptor/soundfonts.py.
 */
const SOUNDFONT_URL = "/soundfonts/MuseScore_General.sf3";

/** GM channel reserved for percussion. */
const DRUM_CHANNEL = 9;

/** Map a muscriptor instrument-group name to a General MIDI program number. */
const GM_PROGRAM: Record<string, number> = {
  acoustic_piano: 0,
  electric_piano: 4,
  chromatic_percussion: 9,
  organ: 19,
  acoustic_guitar: 24,
  clean_electric_guitar: 27,
  distorted_electric_guitar: 30,
  acoustic_bass: 32,
  electric_bass: 33,
  violin: 40,
  viola: 41,
  cello: 42,
  contrabass: 43,
  orchestral_harp: 46,
  timpani: 47,
  string_ensemble: 48,
  synth_strings: 50,
  voice: 52,
  orchestra_hit: 55,
  trumpet: 56,
  trombone: 57,
  tuba: 58,
  french_horn: 60,
  brass_section: 61,
  soprano_and_alto_sax: 65,
  tenor_sax: 66,
  baritone_sax: 67,
  oboe: 68,
  english_horn: 69,
  bassoon: 70,
  clarinet: 71,
  flutes: 73,
  synth_lead: 80,
  synth_pad: 89,
};

/**
 * Every instrument id the backend can emit, in its canonical order (mirrors
 * MT3_FULL_PLUS_GROUP_NAMES in muscriptor/tokenizer/mt3.py). Position in this
 * list is what gives each instrument its fixed piano-roll color, so the order
 * must stay stable. Drums are appended by hand because they have no GM
 * program number: GM plays percussion via the dedicated drum channel
 * (DRUM_CHANNEL), so they can't appear in GM_PROGRAM.
 */
export const INSTRUMENT_ORDER: string[] = [...Object.keys(GM_PROGRAM), "drums"];

/** Velocity used for every synthesized note. */
const NOTE_VELOCITY = 100;

type NoteOpts = {
  instrument: string;
  pitch: number;
  start: number;
  end: number;
};

/** Fade at each end of a looped pass of the audio, so the join doesn't click. */
const LOOP_FADE = 0.004;

/**
 * How far before a bar line a note still counts as on it. Played notes rarely
 * land exactly on the line, and a loop mustn't lose its first downbeat.
 */
const LOOP_EDGE = 0.03;

export class AudioEngine {
  private ctx!: AudioContext;
  private synth: WorkletSynthesizer | null = null;
  /** Notes scheduled while the synth / soundfont was still loading. */
  private pendingNotes: NoteOpts[] = [];
  /** MIDI channel assigned to each instrument group. */
  private channels = new Map<string, number>();
  /** Zero-gain shadow channel per instrument, used only to pre-decode samples. */
  private warmChannels = new Map<string, number>();
  /** `instrument:pitch` pairs already warmed (the synth caches per-pitch voices). */
  private warmedNotes = new Set<string>();
  private nextChannel = 0;
  /** All notes ever scheduled — kept so Play-from-0 can re-schedule them. */
  private allNotes: NoteOpts[] = [];
  private autoStopAt: number | null = null;
  /** Decoded original audio + live playback node, for the WAV/MIDI mix. */
  private wavBuffer: AudioBuffer | null = null;
  private wavSource: AudioBufferSourceNode | null = null;
  private wavGain: GainNode;
  private midiGain: GainNode;
  /** Panners on each bus: centered in mix mode, hard L/R in stereo mode. */
  private wavPanner: StereoPannerNode;
  private midiPanner: StereoPannerNode;
  private mutedInstruments = new Set<string>();
  /** The section playback repeats, or null. */
  private loop: { start: number; end: number } | null = null;
  /** The transport tick the loop starts on. */
  private loopFirstTick = 0;
  /** Metronome clicks. Always scheduled, so turning it on takes effect at once. */
  private clicks: Click[] = [];
  private metronomeOn = false;
  private clickLevel = 0.5;
  private mix = 0.75; // 0 = full WAV, 1 = full MIDI
  /** When true: original audio hard-left, synthesis hard-right (mix ignored). */
  private stereo = false;

  constructor() {
    // Tone.getContext() lazily creates a (suspended) AudioContext — no user
    // gesture needed. The synth and soundfont can load while suspended;
    // we only need to call Tone.start() to *resume* it on the play click.
    this.ctx = Tone.getContext().rawContext as AudioContext;
    // Each bus runs gain → panner → destination so we can both crossfade
    // (gain) and place the two sources L/R (pan) independently.
    this.midiPanner = this.ctx.createStereoPanner();
    this.midiPanner.connect(this.ctx.destination);
    this.midiGain = this.ctx.createGain();
    this.midiGain.connect(this.midiPanner);
    this.wavPanner = this.ctx.createStereoPanner();
    this.wavPanner.connect(this.ctx.destination);
    this.wavGain = this.ctx.createGain();
    this.wavGain.connect(this.wavPanner);
    this.initSynth().catch((e) => {
      console.error("Failed to initialize the synthesizer:", e);
    });
    this.applyMix();
    Tone.getTransport().on("start", (time) => this.startWavSource(time));
    Tone.getTransport().on("stop", () => this.stopWavSource());
    // Pause keeps the transport position but emits "pause", not "stop", so the
    // raw WAV buffer source must be torn down here too; "start" re-creates it at
    // the paused offset when playback resumes.
    Tone.getTransport().on("pause", () => this.stopWavSource());
    // Going round a loop isn't a "start", so the audio is restarted here.
    Tone.getTransport().on("loopStart", (time: number, offset: number) => {
      // The last pass ends by itself at the join. Stopping it would cut it
      // short, because this runs ahead of the audio.
      this.wavSource = null;
      this.startWavSource(time, offset);
    });
  }

  /** Load the worklet + soundfont, then flush notes queued in the meantime. */
  private async initSynth() {
    // Fetch the soundfont concurrently with the worklet setup.
    const soundfont = fetch(SOUNDFONT_URL).then((res) => {
      if (!res.ok) throw new Error(`${SOUNDFONT_URL}: HTTP ${res.status}`);
      return res.arrayBuffer();
    });
    // Tone wraps its AudioContext with standardized-audio-context, so the
    // worklet module and node must be created through Tone's own helpers —
    // spessasynth's audioNodeCreators hook exists for exactly this.
    const toneCtx = Tone.getContext();
    await toneCtx.addAudioWorkletModule(workletUrl);
    const synth = new WorkletSynthesizer(this.ctx, {
      audioNodeCreators: {
        worklet: (_ctx, name, options) =>
          toneCtx.createAudioWorkletNode(name, options),
      },
    });
    synth.connect(this.midiGain);
    await synth.isReady;
    await synth.soundBankManager.addSoundBank(
      await soundfont,
      "MuseScore_General",
    );
    this.synth = synth;
    const queued = this.pendingNotes;
    this.pendingNotes = [];
    for (const n of queued) this.scheduleNoteRaw(n);
  }

  /** Decode `file` and remember the buffer for synced WAV playback. */
  async loadWav(file: File) {
    this.stopWavSource();
    this.wavBuffer = null;
    const bytes = await file.arrayBuffer();
    try {
      this.wavBuffer = await this.ctx.decodeAudioData(bytes);
    } catch {
      // Non-decodable input — keep MIDI-only playback.
      this.wavBuffer = null;
    }
    // The stereo-mode WAV level depends on the buffer's channel count.
    this.applyMix();
  }

  /** Set the MIDI/WAV crossfade. `midiAmount` in [0, 1]. */
  setMix(midiAmount: number) {
    this.mix = Math.max(0, Math.min(1, midiAmount));
    this.applyMix();
  }

  /** Toggle stereo split: original → left, synthesis → right. Overrides mix. */
  setStereo(enabled: boolean) {
    this.stereo = enabled;
    this.applyMix();
  }

  private applyMix() {
    const t = this.ctx.currentTime;
    if (this.stereo) {
      // Panned hard to opposite channels. Hard-panning a stereo signal sums
      // its L+R into one channel (up to +6 dB), so halve the gain of stereo
      // sources to stay at roughly the level they have in mix mode. Mono
      // sources pass through a hard pan at unity, so they need no trim.
      const wavLevel = this.wavBuffer?.numberOfChannels === 1 ? 1 : 0.5;
      this.wavGain.gain.setTargetAtTime(wavLevel, t, 0.01);
      this.midiGain.gain.setTargetAtTime(0.5, t, 0.01); // synth is stereo
      this.wavPanner.pan.setTargetAtTime(-1, t, 0.01);
      this.midiPanner.pan.setTargetAtTime(1, t, 0.01);
    } else {
      // Centered crossfade between the two buses.
      this.wavGain.gain.setTargetAtTime(1 - this.mix, t, 0.01);
      this.midiGain.gain.setTargetAtTime(this.mix, t, 0.01);
      this.wavPanner.pan.setTargetAtTime(0, t, 0.01);
      this.midiPanner.pan.setTargetAtTime(0, t, 0.01);
    }
  }

  /** Get (or assign) the MIDI channel for an instrument group. */
  private channelFor(instrument: string): number {
    let ch = this.channels.get(instrument);
    if (ch !== undefined) return ch;
    const synth = this.synth!;
    if (instrument === "drums") {
      ch = DRUM_CHANNEL;
    } else {
      ch = this.nextChannel++;
      if (this.nextChannel === DRUM_CHANNEL) this.nextChannel++;
      while (ch >= synth.channelCount) synth.addNewChannel();
      synth.programChange(ch, GM_PROGRAM[instrument] ?? 0);
    }
    if (this.mutedInstruments.has(instrument)) {
      synth.midiChannels[ch]?.setSystemParameter("isMuted", true);
    }
    this.channels.set(instrument, ch);
    return ch;
  }

  /**
   * Get (or create) the zero-gain shadow channel used to pre-warm `instrument`.
   *
   * The soundfont is vorbis-compressed (SF3): the worklet decodes each sample
   * lazily — synchronously, on the audio thread — the first time a voice needs
   * it, which audibly stutters playback (see {@link warmNote}). A shadow
   * channel with the same program but channel gain 0 lets us trigger those
   * decodes silently; the decoded samples and built voices land in synth-wide
   * caches keyed by (preset, key, velocity), so the real channel then plays
   * warm.
   */
  private warmChannelFor(instrument: string): number {
    let ch = this.warmChannels.get(instrument);
    if (ch !== undefined) return ch;
    const synth = this.synth!;
    ch = this.nextChannel++;
    if (this.nextChannel === DRUM_CHANNEL) this.nextChannel++;
    while (ch >= synth.channelCount) synth.addNewChannel();
    if (instrument === "drums") {
      synth.midiChannels[ch]?.setDrums(true);
    } else {
      synth.programChange(ch, GM_PROGRAM[instrument] ?? 0);
    }
    synth.midiChannels[ch]?.setSystemParameter("gain", 0);
    this.warmChannels.set(instrument, ch);
    return ch;
  }

  /**
   * Pre-decode the sample(s) behind a note by playing it once, immediately and
   * silently, on the instrument's shadow channel. Called as notes stream in
   * during transcription so first playback doesn't stall on vorbis decodes.
   * Velocity must match playback ({@link NOTE_VELOCITY}) — the synth's voice
   * cache is keyed on it.
   */
  private warmNote(instrument: string, pitch: number) {
    const key = `${instrument}:${pitch}`;
    if (this.warmedNotes.has(key)) return;
    this.warmedNotes.add(key);
    const synth = this.synth!;
    const ch = this.warmChannelFor(instrument);
    synth.noteOn(ch, pitch, NOTE_VELOCITY);
    synth.noteOff(ch, pitch);
  }

  /** Mute or unmute a single instrument on the MIDI track. Works live. */
  setInstrumentMuted(instrument: string, muted: boolean) {
    if (muted) this.mutedInstruments.add(instrument);
    else this.mutedInstruments.delete(instrument);
    const ch = this.channels.get(instrument);
    if (ch !== undefined) {
      this.synth?.midiChannels[ch]?.setSystemParameter("isMuted", muted);
    }
  }

  private startWavSource(at: number, from?: number) {
    this.stopWavSource();
    if (!this.wavBuffer) return;
    // It's important to use .getSecondsAtTime() and not .seconds because otherwise we get
    // a random ~25ms desync between the wav and the transcription
    const offset = from ?? Tone.getTransport().getSecondsAtTime(at);
    if (offset >= this.wavBuffer.duration) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.wavBuffer;
    if (this.loop) {
      const length = this.loop.end - offset;
      src.connect(this.loopFade(src, at, length));
      src.start(at, offset, length);
    } else {
      src.connect(this.wavGain);
      src.start(at, offset);
    }
    this.wavSource = src;
  }

  /** A gain that fades one pass of the loop in and out. */
  private loopFade(src: AudioBufferSourceNode, at: number, length: number): GainNode {
    const fade = this.ctx.createGain();
    const ramp = Math.min(LOOP_FADE, length / 2);
    fade.gain.setValueAtTime(0, at);
    fade.gain.linearRampToValueAtTime(1, at + ramp);
    fade.gain.setValueAtTime(1, at + length - ramp);
    fade.gain.linearRampToValueAtTime(0, at + length);
    fade.connect(this.wavGain);
    src.onended = () => fade.disconnect();
    return fade;
  }

  private stopWavSource() {
    if (!this.wavSource) return;
    try {
      this.wavSource.stop();
    } catch {
      // already stopped
    }
    this.wavSource.disconnect();
    this.wavSource = null;
  }

  /** Schedule a note at transport time `start` for `duration` seconds. */
  scheduleNote(opts: NoteOpts) {
    this.allNotes.push({ ...opts });
    this.scheduleNoteRaw(opts);
  }

  /**
   * Replace every note, keeping the transport where it is. Anything still to
   * come plays from the new list. `stopAt` is when playback ends by itself.
   */
  replaceNotes(notes: NoteOpts[], stopAt: number | null, clicks: Click[]) {
    this.allNotes = notes.map((n) => ({ ...n }));
    this.pendingNotes = [];
    this.autoStopAt = stopAt;
    this.clicks = clicks;
    this.seek(Tone.getTransport().seconds);
  }

  /** Sound one note now, as feedback for an edit. */
  audition(instrument: string, pitch: number) {
    const synth = this.synth;
    if (!synth) return;
    Tone.start().catch(() => {});
    const channel = this.channelFor(instrument);
    const time = this.ctx.currentTime;
    synth.noteOn(channel, pitch, NOTE_VELOCITY, { time });
    synth.noteOff(channel, pitch, { time: time + 0.25 });
  }

  setMetronome(on: boolean) {
    this.metronomeOn = on;
  }

  setMetronomeLevel(level: number) {
    this.clickLevel = level;
  }

  /** Run `callback` at transport time `when`: on every pass, inside a loop. */
  private at(callback: (time: number) => void, when: number) {
    const transport = Tone.getTransport();
    if (this.loop) {
      const tick = Math.max(this.loopFirstTick, Math.floor(transport.toTicks(when)));
      transport.schedule(callback, `${tick}i`);
    } else {
      transport.scheduleOnce(callback, when);
    }
  }

  private inLoop(seconds: number): boolean {
    return this.loop !== null && seconds >= this.loop.start && seconds < this.loop.end;
  }

  /** Whether something at `seconds` plays in the loop's section. */
  private belongsToLoop(seconds: number): boolean {
    return this.loop !== null && seconds >= this.loop.start - LOOP_EDGE && seconds < this.loop.end - LOOP_EDGE;
  }

  private scheduleClick(click: Click) {
    if (this.loop && !this.belongsToLoop(click.time)) return;
    this.at((time) => {
      if (!this.metronomeOn || this.clickLevel <= 0) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.frequency.value = click.accent ? 1600 : 1000;
      gain.gain.setValueAtTime(this.clickLevel, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(time);
      osc.stop(time + 0.06);
    }, click.time);
  }

  /**
   * Move every note by `seconds`, re-scheduling what hasn't played yet. Used to
   * take out the lag the transcribed onsets carry against the detected beats,
   * once the beat grid arrives at the end of the stream.
   */
  shiftNotes(seconds: number) {
    if (!seconds) return;
    for (const n of [...this.allNotes, ...this.pendingNotes]) {
      n.start += seconds;
      n.end += seconds;
    }
    // Queued scheduleOnce callbacks are one-shot and hold the old times; seeking
    // to where we already are cancels and re-schedules them from the new ones.
    this.seek(Tone.getTransport().seconds);
  }

  private scheduleNoteRaw(opts: NoteOpts) {
    if (!this.synth) {
      this.pendingNotes.push(opts);
      return;
    }
    if (this.loop && !this.belongsToLoop(opts.start)) return;
    const synth = this.synth;
    const channel = this.channelFor(opts.instrument);
    this.warmNote(opts.instrument, opts.pitch);
    // A note crossing the end of a loop stops there, not in the next pass.
    const end = this.loop ? Math.min(opts.end, this.loop.end) : opts.end;
    const start = this.loop ? Math.max(opts.start, this.loop.start) : opts.start;
    const duration = Math.max(0.05, end - start);
    // The callback fires slightly ahead of the audio time; passing `time`
    // through lets the worklet apply both events sample-accurately. Pairing
    // the noteOff with its noteOn also guarantees no stuck notes.
    this.at((time) => {
      synth.noteOn(channel, opts.pitch, NOTE_VELOCITY, { time });
      synth.noteOff(channel, opts.pitch, { time: time + duration });
    }, start);
  }

  /** Resume the AudioContext. Must be called from a user-gesture handler. */
  async unlock() {
    await Tone.start();
  }

  async play() {
    await Tone.start();
    const t = Tone.getTransport();
    if (this.loop && !this.inLoop(t.seconds)) {
      this.seek(this.loop.start);
    } else if (t.seconds < 0.001) {
      // If we're at the very start, every previously-fired scheduleOnce is gone;
      // re-schedule every known note (and the auto-stop) from scratch.
      t.cancel();
      this.scheduleFrom(0);
    }
    t.start();
  }

  pause() {
    Tone.getTransport().pause();
    this.synth?.stopAll();
  }

  /** Jump the transport to `seconds`, re-scheduling notes from that point. */
  seek(seconds: number) {
    const t = Tone.getTransport();
    const wasPlaying = t.state === "started";
    let target = Math.max(0, seconds);
    // Playing stays inside the section. Paused, the playhead can go anywhere,
    // and Play comes back to the section.
    if (this.loop && wasPlaying && !this.inLoop(target)) target = this.loop.start;
    if (wasPlaying) t.pause();
    this.synth?.stopAll();
    // scheduleOnce events are one-shot, so a jump (especially backwards) needs
    // a full re-schedule of everything that starts after the new position.
    t.cancel();
    t.seconds = target;
    this.scheduleFrom(target);
    // Restarting the transport re-fires the "start" handler, which restarts
    // the WAV source at the new offset.
    if (wasPlaying) t.start();
  }

  /** Schedule what plays from `target` on: a loop needs all of its section. */
  private scheduleFrom(target: number) {
    const first = this.loop ? this.loop.start - LOOP_EDGE : target;
    for (const n of this.allNotes) {
      if (n.start >= first) this.scheduleNoteRaw(n);
    }
    for (const c of this.clicks) {
      if (c.time >= first) this.scheduleClick(c);
    }
    if (this.autoStopAt !== null && this.autoStopAt > target) {
      this.scheduleStopRaw(this.autoStopAt);
    }
  }

  /** Repeat `section` while playing, or play straight through with null. */
  setLoop(section: { start: number; end: number } | null) {
    if (!section && !this.loop) return;
    const t = Tone.getTransport();
    this.loop = null;
    if (section) {
      // Whole ticks: after going round, Tone looks for events at exactly the
      // loop's start tick, and a fractional one matches nothing.
      const tick = 60 / (t.bpm.value * t.PPQ);
      this.loopFirstTick = Math.floor(section.start / tick);
      const lastTick = Math.ceil(section.end / tick);
      this.loop = { start: this.loopFirstTick * tick, end: lastTick * tick };
      t.setLoopPoints(`${this.loopFirstTick}i`, `${lastTick}i`);
    }
    t.loop = section !== null;
    this.seek(t.seconds);
  }

  /** Move the transport clock only — a cheap per-frame seek for live
   *  scrubbing. Call while paused; the one-shot note schedule is left stale,
   *  so follow up with a real seek() before resuming playback. */
  scrubTo(seconds: number) {
    Tone.getTransport().seconds = Math.max(0, seconds);
  }

  stop() {
    const t = Tone.getTransport();
    t.stop();
    t.cancel();
    t.seconds = 0;
    this.synth?.stopAll();
  }

  /** Wipe scheduled state for a brand-new transcription. */
  reset() {
    this.stop();
    this.loop = null;
    Tone.getTransport().loop = false;
    this.allNotes = [];
    this.pendingNotes = [];
    this.clicks = [];
    this.autoStopAt = null;
    this.stopWavSource();
    this.wavBuffer = null;
    // The instrument list is rebuilt from scratch, so unmute everything.
    this.mutedInstruments.clear();
    for (const ch of this.channels.values()) {
      this.synth?.midiChannels[ch]?.setSystemParameter("isMuted", false);
    }
  }

  /** Remember the auto-stop time and schedule it for the current run. */
  scheduleStop(t: number) {
    this.autoStopAt = t;
    this.scheduleStopRaw(t);
  }

  private scheduleStopRaw(at: number) {
    if (this.loop) return;
    Tone.getTransport().scheduleOnce(() => {
      Tone.getTransport().stop();
      Tone.getTransport().seconds = 0;
      this.synth?.stopAll();
    }, at);
  }

  /** Current playback position in seconds. */
  get seconds(): number {
    return Tone.getTransport().seconds;
  }

  /** Duration of the decoded source audio in seconds, or 0 if not yet loaded. */
  get duration(): number {
    return this.wavBuffer?.duration ?? 0;
  }

  get state(): "started" | "stopped" | "paused" {
    return Tone.getTransport().state;
  }
}
