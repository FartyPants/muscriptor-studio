import { instrumentColor } from "./colors";

/** A note's position while a drag previews it. */
export type RollOverride = { pitch: number; start: number; end: number };

export type Marquee = { x0: number; y0: number; x1: number; y1: number };

/** What the roll draws. All on by default, except pitch lines. */
export type GridDisplay = {
  secondMarkers: boolean;
  pitchLanes: boolean;
  pitchLines: boolean;
  keyboard: boolean;
  chords: boolean;
  /** How the timeline counts: bars and beats, or seconds. */
  timeUnit: "bars" | "seconds";
};

export const DEFAULT_DISPLAY: GridDisplay = {
  secondMarkers: true,
  pitchLanes: true,
  pitchLines: false,
  keyboard: true,
  chords: true,
  timeUnit: "bars",
};

/** A chord name with real sharp and flat signs. */
const prettyChord = (name: string) => name.replace(/#/g, "♯").replace(/([A-G])b/g, "$1♭");

/** A named chord, in display time. */
export type ChordSpan = {
  start: number;
  end: number;
  root: string;
  quality: string;
  label: string;
  /** Its Roman numeral in the current key, if there is a key. */
  numeral: string | null;
};

export interface RollNote {
  /** Project note id; unset for notes still streaming in. */
  id?: string;
  pitch: number;
  start: number;
  end: number;
  instrument: string;
  /**
   * `performance.now()` at which this note's geometry was finalized (its `end`
   * event arrived), driving the left-to-right reveal. Unset notes are drawn
   * with no reveal (full width), e.g. when loading a finished MIDI.
   */
  spawn?: number;
  /**
   * Number of same-pitch notes drawn in front of this one that overlap it in
   * time. The note is nudged up by this many steps so it peeks out from behind
   * them. Maintained in {@link PianoRoll.setNoteEnd}.
   */
  stackOffset?: number;
}

/** Beat grid from the backend (`transcription_complete`'s `beat_grid`). */
export interface BeatGrid {
  /** The constant tempo; for an unsteady grid, the average one. */
  bpm: number;
  /** null when the meter is unknown — then only beat lines are drawn. */
  beats_per_bar: number | null;
  /** Time of the first detected bar line, in seconds of the original audio. */
  first_downbeat: number;
  /**
   * Seconds the streamed note times sit late against these beats (see the
   * backend's `BeatGrid.onset_delay`). The beat tracker locates the beats more
   * accurately than the model locates its onsets, so the notes are the ones that
   * move: subtract this from every note time, as the MIDI file already does.
   */
  onset_delay: number;
  /** Steps per beat the onsets sit on (4 = sixteenths), or null if none: what
   *  /export quantizes to unless told otherwise. */
  beat_subdivision?: number | null;
  /** Whether `beats` fit the constant `bpm`. False: draw the bars on `beats`. */
  steady?: boolean;
  /** Tracked beat times, in seconds of the original audio. */
  beats?: number[] | null;
}

/**
 * The time of beat `k` of `grid`, counted from its first downbeat (k = 0).
 * A steady grid's beats are evenly spaced; an unsteady one's are the tracked
 * beats, continued at the edge intervals' tempo beyond them.
 */
function beatClock(grid: BeatGrid): {
  timeOf: (k: number) => number;
  /** The beat at or just before `t`. */
  indexAt: (t: number) => number;
  /** Seconds per beat, on average: for spacing decisions. */
  period: number;
} {
  const beats = grid.beats;
  if (grid.steady !== false || !beats || beats.length < 2) {
    const period = 60 / grid.bpm;
    return {
      timeOf: (k) => grid.first_downbeat + k * period,
      indexAt: (t) => Math.floor((t - grid.first_downbeat) / period),
      period,
    };
  }
  const n = beats.length;
  let d = 0;
  for (let i = 1; i < n; i++) {
    if (Math.abs(beats[i] - grid.first_downbeat) < Math.abs(beats[d] - grid.first_downbeat)) d = i;
  }
  const head = beats[1] - beats[0];
  const tail = beats[n - 1] - beats[n - 2];
  return {
    timeOf: (k) => {
      const i = k + d;
      if (i < 0) return beats[0] + i * head;
      if (i >= n) return beats[n - 1] + (i - n + 1) * tail;
      return beats[i];
    },
    indexAt: (t) => {
      if (t < beats[0]) return Math.floor((t - beats[0]) / head) - d;
      if (t >= beats[n - 1]) return n - 1 + Math.floor((t - beats[n - 1]) / tail) - d;
      // Binary search for the last beat at or before t.
      let lo = 0;
      let hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (beats[mid] <= t) lo = mid;
        else hi = mid;
      }
      return lo - d;
    },
    period: (beats[n - 1] - beats[0]) / (n - 1),
  };
}

/**
 * Shading on every other bar. Translucent so it tints the pitch rows underneath.
 */
const BAR_STRIP = "rgba(255, 255, 255, 0.022)";
/** Beat subdivisions are dropped below this spacing (px) rather than crowding the bars. */
const MIN_BEAT_PX = 12;
/** Height of the time ruler across the top of the note area. */
export const RULER_H = 26;
/** Height of the chord bar, under the ruler. */
const CHORD_H = 38;
/** Vertical lines, strongest first, drawn on the roll's black. */
/** Pitch rows while working in key. Everything else stays dark. */
const KEY_ROW = "#232a38";
const TONIC_ROW = "#37436a";
const LINE_COLORS = { bar: "#5d687e", beat: "#3a4252", step: "#262c38" };

/** Reveal duration in ms — how long a note takes to grow to full width. */
const REVEAL_MS = 280;

/** Shave this off each note's drawn width so adjacent notes keep a visible gap. */
const NOTE_GAP_PX = 1.5;

/** Upward nudge per overlapping same-pitch note drawn in front, so it peeks out. */
const NOTE_STACK_PX = 1.5;

export type GridLine = {
  t: number;
  kind: "bar" | "beat" | "step";
  /** The bar number or time to print on the ruler, where one belongs. */
  label?: string;
};

export type RollGrid = { lines: GridLine[]; strips: { from: number; to: number }[] };

/** Bars of four, when the meter wasn't detected: a usable ruler beats none. */
const DEFAULT_BEATS_PER_BAR = 4;
/** The meters a user can choose, in beats per bar. */
export const METERS = [2, 3, 4, 5, 6, 7, 8];
/** Steps per beat, when no subdivision was measured. */
const DEFAULT_STEPS = 4;
const MIN_LABEL_PX = 42;
const MIN_STEP_PX = 11;

/**
 * Bars, beats and beat subdivisions for the span `[from, to]` seconds. Counted
 * from the first downbeat, so bar 1 starts there, and it follows the tracked
 * beats when the tempo moves. Finer lines drop out as they get too close.
 */
export function musicalGrid(grid: BeatGrid, from: number, to: number, pxPerSec: number): RollGrid {
  const clock = beatClock(grid);
  const perBar = grid.beats_per_bar ?? DEFAULT_BEATS_PER_BAR;
  const barPx = perBar * clock.period * pxPerSec;
  // Label every bar when there's room, otherwise every 2, 4, 8 or more.
  let labelEvery = 1;
  while (labelEvery * barPx < MIN_LABEL_PX) labelEvery *= 2;
  const showBeats = clock.period * pxPerSec >= MIN_BEAT_PX;
  const steps = grid.beat_subdivision ?? DEFAULT_STEPS;
  const showSteps = (clock.period / steps) * pxPerSec >= MIN_STEP_PX;

  const lines: GridLine[] = [];
  const strips: { from: number; to: number }[] = [];
  for (let beat = clock.indexAt(from); ; beat++) {
    const t = clock.timeOf(beat);
    if (t > to) break;
    const next = clock.timeOf(beat + 1);
    const bar = Math.floor(beat / perBar);
    const startsBar = beat === bar * perBar;
    if (t >= 0 && t >= from) {
      if (startsBar) {
        const labelled = bar >= 0 && bar % labelEvery === 0;
        lines.push({ t, kind: "bar", label: labelled ? String(bar + 1) : undefined });
      } else if (showBeats) {
        lines.push({ t, kind: "beat" });
      }
    }
    if (showSteps) {
      for (let step = 1; step < steps; step++) {
        const at = t + ((next - t) * step) / steps;
        if (at >= Math.max(0, from) && at <= to) lines.push({ t: at, kind: "step" });
      }
    }
    // Every other bar is shaded, so bars read as blocks.
    if (startsBar && ((bar % 2) + 2) % 2 === 1) {
      const end = clock.timeOf(beat + perBar);
      if (end > 0) strips.push({ from: Math.max(0, t), to: end });
    }
  }
  return { lines, strips };
}

/**
 * The whole bars nearest a drag from `from` to `to` seconds. A drag that would
 * collapse to nothing takes the bar under its middle.
 */
export function barSpan(grid: BeatGrid, from: number, to: number): { start: number; end: number } {
  const clock = beatClock(grid);
  const perBar = grid.beats_per_bar ?? DEFAULT_BEATS_PER_BAR;
  const barAt = (t: number) => Math.floor(clock.indexAt(t) / perBar);
  const barTime = (bar: number) => clock.timeOf(bar * perBar);
  const nearest = (t: number) => {
    const bar = barAt(t);
    return t - barTime(bar) < barTime(bar + 1) - t ? bar : bar + 1;
  };
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  let first = nearest(low);
  let last = nearest(high);
  if (last <= first) {
    first = barAt((low + high) / 2);
    last = first + 1;
  }
  return { start: Math.max(0, barTime(first)), end: barTime(last) };
}

/** Whole seconds, spaced so the labels never crowd. */
export function secondsGrid(from: number, to: number, pxPerSec: number): RollGrid {
  const every = [1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * pxPerSec >= 60) ?? 600;
  const lines: GridLine[] = [];
  for (let t = Math.max(0, Math.ceil(from / every) * every); t <= to; t += every) {
    lines.push({ t, kind: "bar", label: `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}` });
  }
  return { lines, strips: [] };
}

/** Ease-out cubic: fast start, slowing as it reaches the end. */
function easeOut(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

/**
 * Where in the content area the followed position sits, as a fraction of the
 * view width. Shared by playhead-follow and transcription-follow.
 */
const FOLLOW_ANCHOR_FRACTION = 0.66;
/**
 * A playhead below this (seconds) counts as "at the start" i.e. the user
 * hasn't begun listening yet, and we will auto-follow the transcription progress.
 */
const PLAYHEAD_START_EPS = 0.05;
/** Per-frame easing of the frontier value. */
const FRONTIER_SMOOTHING = 0.12;
/** Per-frame easing of the *view offset* toward the anchored frontier */
const FRONTIER_FOLLOW_SMOOTHING = 0.06;
/** Idle time (ms) after a scroll gesture before auto-follow may re-engage. */
const RESUME_IDLE_MS = 1000;

const PX_PER_SEC = 80;
const MIN_PX_PER_SEC = 10;
const MAX_PX_PER_SEC = 2000;
const MAX_PX_PER_PITCH = 160;
export const PITCH_MIN = 21; // A0
export const PITCH_MAX = 108; // C8
/** Top of the auto-fit view; higher pitches are reachable only by zooming. */
const DEFAULT_PITCH_TOP = 84; // C6
const DEFAULT_PITCH_RANGE = DEFAULT_PITCH_TOP - PITCH_MIN + 1; // 64

/** Width in px of the piano-key strip on the left edge. */
export const KEY_WIDTH = 56;

/** Black keys within an octave (C=0): C#, D#, F#, G#, A#. */
function isBlackKey(pitch: number): boolean {
  const n = ((pitch % 12) + 12) % 12;
  return n === 1 || n === 3 || n === 6 || n === 8 || n === 10;
}

export { instrumentColor };

/**
 * The canvas can't use Tailwind classes, so the skin exposes its palette as
 * CSS custom properties on :root (see style.css); read once and cache.
 */
let rollPalette: {
  bodyFont: string;
  stripe: string;
  grid: string;
  playhead: string;
  keyBlack: string;
  keyWhite: string;
  labelFont: string;
} | null = null;

function palette() {
  if (rollPalette === null) {
    const style = getComputedStyle(document.documentElement);
    const v = (name: string) => style.getPropertyValue(name).trim();
    rollPalette = {
      stripe: v("--roll-stripe"),
      grid: v("--roll-grid"),
      playhead: v("--roll-playhead"),
      keyBlack: v("--roll-key-black"),
      keyWhite: v("--roll-key-white"),
      labelFont: `10px ${v("--font-sans")}`,
      bodyFont: v("--font-sans"),
    };
  }
  return rollPalette;
}

export class PianoRoll {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private notes: RollNote[] = [];
  private hiddenInstruments = new Set<string>();
  private mutedInstruments = new Set<string>();
  /** Instrument hovered in the instrument list; all others draw faded. */
  private highlightedInstrument: string | null = null;
  private playhead = 0;
  /**
   * Chunk-completion estimate of how far transcription has reached (seconds), or
   * null when not transcribing. Combined with `latestNoteStart` into the tinted
   * [0, t) frontier; the chunk estimate is what advances the frontier across
   * silent spans where no notes arrive.
   */
  private chunkFrontier: number | null = null;
  /**
   * Whether the frontier is still advancing. False once transcription is done
   * and the frontier is pinned at the full duration: the wash stays (light =
   * transcribed) but the view must not chase the frontier to the end.
   */
  private frontierLive = true;
  /** Start time of the latest note seen — a precise lower bound on the frontier. */
  private latestNoteStart = 0;
  /** Frontier actually drawn; eases toward the target each frame for a smooth glide. */
  private transcribedSmooth = 0;
  /** Seconds-from-start of the left edge when the user has taken over scrolling. */
  private userOffset: number | null = null;
  /**
   * `performance.now()` of the last user scroll/zoom gesture, and whether that
   * gesture (as opposed to the explicit follow toggle) is what stopped
   * following. Together they drive the auto-resume in {@link render}: a scroll
   * that leaves the transcription frontier in view re-engages follow mode after
   * {@link RESUME_IDLE_MS} of quiet, while an explicit unfollow stays put.
   */
  private lastGestureAt = 0;
  private resumeArmed = false;
  /** Set when the auto-resume fired; read (and cleared) by {@link consumeAutoResumed}. */
  private autoResumed = false;
  /** Last offset we rendered with — handy so external code knows what's visible. */
  private lastOffset = 0;
  /** Time-axis zoom, in pixels per second. */
  private _pxPerSec = PX_PER_SEC;
  /** Row height in px when the user has zoomed the pitch axis; null = auto-fit all 88 keys. */
  private pxPerPitch: number | null = null;
  /** Pitch value at the top edge, used only while pitch-zoomed. */
  private pitchTop = DEFAULT_PITCH_TOP;
  /** Loaded audio length in seconds; caps how far the time axis can scroll. */
  private contentDuration = 0;
  /** Detected beat grid; null until the final `midi` event arrives (then: seconds grid). */
  private beatGrid: BeatGrid | null = null;
  /** Editing: the only instrument at full strength, or null when not editing. */
  private activeInstrument: string | null = null;
  private selectedNotes: Set<string> = new Set();
  private overrides: Map<string, RollOverride> | null = null;
  private marquee: Marquee | null = null;
  private chords: ChordSpan[] = [];
  private display: GridDisplay = DEFAULT_DISPLAY;
  /** The key to show on the pitch rows, or null for the usual lanes. */
  private keyLanes: { tonic: number; scale: Set<number> } | null = null;
  private range: { start: number; end: number } | null = null;
  private looping = false;
  private lastRowH = 1;
  private lastPitchTop = DEFAULT_PITCH_TOP;

  get pxPerSec(): number {
    return this._pxPerSec;
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    // The layout changes the canvas too (a progress bar leaving, a side panel),
    // and a stale buffer draws stretched.
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Replace every note. Times are display times, already on the beats. */
  setNotes(notes: RollNote[]) {
    this.notes = notes;
    this.latestNoteStart = notes.reduce((max, n) => Math.max(max, n.start), 0);
    // One sweep per pitch: how many later-drawn notes each one sits behind.
    const byPitch = new Map<number, RollNote[]>();
    for (const n of notes) {
      n.stackOffset = 0;
      const row = byPitch.get(n.pitch);
      if (row) row.push(n);
      else byPitch.set(n.pitch, [n]);
    }
    for (const row of byPitch.values()) {
      row.sort((a, b) => a.start - b.start);
      for (let i = 0; i < row.length; i++) {
        for (let j = i + 1; j < row.length && row[j].start < row[i].end; j++) {
          row[i].stackOffset!++;
        }
      }
    }
  }

  setChords(chords: ChordSpan[]) {
    this.chords = chords;
  }

  /** Light the key's rows and dim the rest, for working in key. */
  setKeyLanes(key: { tonic: number; scale: number[] } | null) {
    this.keyLanes = key && { tonic: key.tonic, scale: new Set(key.scale) };
  }

  setDisplay(display: GridDisplay) {
    this.display = display;
  }

  /** The time span chosen on the ruler, or null. */
  setRange(range: { start: number; end: number } | null) {
    this.range = range;
  }

  /** Whether playback is repeating the chosen span, which the ruler then shows. */
  setLooping(looping: boolean) {
    this.looping = looping;
  }

  /** A drag on the ruler, moved onto the bars when the timeline shows bars. */
  snapToBars(from: number, to: number): { start: number; end: number } {
    if (this.display.timeUnit === "bars" && this.beatGrid) return barSpan(this.beatGrid, from, to);
    return { start: Math.min(from, to), end: Math.max(from, to) };
  }

  /** Height of the ruler and chord bar across the top. */
  get headerHeight(): number {
    return RULER_H + (this.display.chords && this.chords.length > 0 ? CHORD_H : 0);
  }

  setEditState(active: string | null, selected: Set<string>) {
    this.activeInstrument = active;
    this.selectedNotes = selected;
  }

  /** Draw these notes at new positions, until cleared with null. */
  setOverrides(overrides: Map<string, RollOverride> | null) {
    this.overrides = overrides;
  }

  setMarquee(marquee: Marquee | null) {
    this.marquee = marquee;
  }

  /** How time and pitch map to pixels in the last frame drawn. */
  view() {
    return {
      keyWidth: KEY_WIDTH,
      offsetSec: this.lastOffset,
      pxPerSec: this._pxPerSec,
      pitchTop: this.lastPitchTop,
      rowH: this.lastRowH,
    };
  }

  /** Put the view back at the start of the song. */
  showStart() {
    this.userOffset = null;
    this.lastOffset = 0;
  }

  /** Back to the default zoom: all 88 keys, default time scale. */
  resetZoom() {
    this._pxPerSec = PX_PER_SEC;
    this.pxPerPitch = null;
    this.pitchTop = DEFAULT_PITCH_TOP;
    this.noteGesture();
  }

  /** Zoom around the view's center, for the toolbar buttons. */
  zoomStep(factor: number) {
    this.zoomTime(factor, this.canvas.getBoundingClientRect().width / 2);
  }

  /** Frame every note, in both time and pitch. */
  fitNotes() {
    if (!this.notes.length) return;
    const rect = this.canvas.getBoundingClientRect();
    const end = this.maxEnd();
    const pitches = this.notes.map((n) => n.pitch);
    const low = Math.min(...pitches);
    const high = Math.max(...pitches);
    this._pxPerSec = Math.max(1, (rect.width - KEY_WIDTH) / Math.max(1, end));
    this.pxPerPitch = (rect.height - this.headerHeight) / (high - low + 3);
    // One row above the highest note, plus room for the ruler.
    this.pitchTop = high + 2 + this.headerHeight / this.pxPerPitch;
    this.userOffset = 0;
    this.noteGesture();
  }

  addNote(n: RollNote) {
    this.notes.push(n);
    // The transcribed frontier never lags behind the most recent note's onset.
    if (n.start > this.latestNoteStart) this.latestNoteStart = n.start;
  }

  /**
   * Record a note's final end time (its `end` event arrived). Beyond driving the
   * left-to-right reveal, this restacks same-pitch notes that overlap `n` in
   * time: whichever of an overlapping pair is drawn behind gets one more upward
   * step ({@link NOTE_STACK_PX}) so it peeks out above the note in front.
   *
   * Iteration order matches draw order (insertion order), so notes seen before
   * `n` are behind it and notes seen after are in front. Each overlapping pair
   * is settled exactly once — when the later of the two to arrive finalizes —
   * since only already-finalized notes (`spawn` set) take part.
   */
  setNoteEnd(n: RollNote, end: number) {
    n.end = end;
    n.spawn = performance.now();
    let behindN = true;
    for (const e of this.notes) {
      if (e === n) {
        behindN = false;
        continue;
      }
      if (e.spawn === undefined || e.pitch !== n.pitch) continue;
      // Half-open overlap test on the final time ranges.
      if (e.start < n.end && n.start < e.end) {
        if (behindN) e.stackOffset = (e.stackOffset ?? 0) + 1;
        else n.stackOffset = (n.stackOffset ?? 0) + 1;
      }
    }
  }

  /** Spotlight `name`'s notes (fading all other instruments); null clears it. */
  setHighlightedInstrument(name: string | null) {
    this.highlightedInstrument = name;
  }

  setPlayhead(seconds: number) {
    this.playhead = seconds;
  }

  /**
   * Switch the time grid from seconds to bars/beats, moving the notes onto it by
   * the grid's `onset_delay`. The grid itself is drawn in original-audio time, so
   * 0s stays at 0s and the first bar line lands on the detected downbeat (with
   * earlier bar lines extrapolated backwards). null keeps the seconds grid.
   *
   * The caller has to shift the scheduled audio to match (AudioEngine.shiftNotes).
   */
  setBeatGrid(grid: BeatGrid | null) {
    this.beatGrid = grid;
    if (!grid?.onset_delay) return;
    for (const n of this.notes) {
      n.start -= grid.onset_delay;
      n.end -= grid.onset_delay;
    }
    this.latestNoteStart -= grid.onset_delay;
  }

  /**
   * Redraw the bar lines for a corrected grid (the user's tempo, meter or
   * downbeat) without moving any notes: they were moved onto the beats once, by
   * setBeatGrid, and a different tempo does not change where they sound.
   */
  setGridLines(grid: BeatGrid | null) {
    this.beatGrid = grid;
  }

  /** Tell the roll the loaded audio length, which bounds the time-axis scroll. */
  setDuration(seconds: number) {
    this.contentDuration = seconds;
  }

  /**
   * Feed the chunk-completion estimate of the transcribed span, or null when not
   * transcribing (which disables the tint). The drawn frontier is the max of this
   * and the latest note onset, eased over a few frames.
   */
  setTranscribedUntil(seconds: number | null, live = true) {
    this.chunkFrontier = seconds;
    this.frontierLive = live;
  }

  /** Show or hide every note belonging to `instrument`. */
  setInstrumentVisible(instrument: string, visible: boolean) {
    if (visible) this.hiddenInstruments.delete(instrument);
    else this.hiddenInstruments.add(instrument);
  }

  /** Dim every note belonging to `instrument` (drawn at 10% alpha) when muted. */
  setInstrumentMuted(instrument: string, muted: boolean) {
    if (muted) this.mutedInstruments.add(instrument);
    else this.mutedInstruments.delete(instrument);
  }

  clear() {
    this.notes = [];
    this.hiddenInstruments.clear();
    // Unmounting the instrument list mid-hover fires no mouseleave, so drop
    // any stale spotlight here.
    this.highlightedInstrument = null;
    this.playhead = 0;
    this.chunkFrontier = null;
    this.frontierLive = true;
    this.latestNoteStart = 0;
    this.transcribedSmooth = 0;
    this.userOffset = null;
    this.lastGestureAt = 0;
    this.resumeArmed = false;
    this.autoResumed = false;
    this.lastOffset = 0;
    this._pxPerSec = PX_PER_SEC;
    this.pxPerPitch = null;
    this.pitchTop = DEFAULT_PITCH_TOP;
    this.contentDuration = 0;
    this.beatGrid = null;
  }

  /**
   * Mark a user scroll/zoom gesture: restarts the auto-resume idle timer and
   * arms it, so follow mode may come back on its own once the gesture settles.
   */
  private noteGesture() {
    this.lastGestureAt = performance.now();
    this.resumeArmed = true;
  }

  /** Add `deltaSeconds` to the left-edge offset, taking the view out of follow mode. */
  scrollBy(deltaSeconds: number) {
    const base = this.userOffset ?? this.lastOffset;
    this.userOffset = this.clampOffset(base + deltaSeconds, this._pxPerSec);
    this.noteGesture();
  }

  /** Move the view's left edge to `offsetSec`, taking it out of follow mode. */
  scrollTo(offsetSec: number) {
    this.userOffset = this.clampOffset(offsetSec, this._pxPerSec);
    this.noteGesture();
  }

  /** What a scrollbar needs to show. */
  get scrollState() {
    const contentW = this.canvas.getBoundingClientRect().width - KEY_WIDTH;
    return {
      offsetSec: this.lastOffset,
      viewSec: contentW / this._pxPerSec,
      totalSec: this.contentEnd(),
    };
  }

  /** Pan the pitch axis by `deltaPx` pixels. */
  scrollPitchBy(deltaPx: number) {
    this.noteGesture();
    const H = this.canvas.getBoundingClientRect().height;
    if (this.pxPerPitch === null) {
      // Auto-fit hides everything above C6; entering a panned window at the
      // same row height lets the user scroll up to it without zooming first.
      this.pxPerPitch = H / DEFAULT_PITCH_RANGE;
      this.pitchTop = DEFAULT_PITCH_TOP;
    }
    this.pitchTop = this.clampPitchTop(
      this.pitchTop + deltaPx / this.pxPerPitch,
      this.pxPerPitch,
      H,
    );
  }

  /**
   * Zoom the time axis by `factor`, keeping the second under `anchorX` fixed.
   * `anchorX` is canvas-relative (including the key strip); the gutter is
   * subtracted here so the content area starts at zero seconds-from-offset.
   */
  zoomTime(factor: number, anchorX: number) {
    this.noteGesture();
    const old = this._pxPerSec;
    const next = Math.min(
      MAX_PX_PER_SEC,
      Math.max(MIN_PX_PER_SEC, old * factor),
    );
    if (next === old) return;
    const ax = anchorX - KEY_WIDTH;
    const base = this.userOffset ?? this.lastOffset;
    const anchorSec = base + ax / old;
    this._pxPerSec = next;
    this.userOffset = this.clampOffset(anchorSec - ax / next, next);
  }

  /** Zoom the pitch axis by `factor`, keeping the pitch under `anchorY` (px) fixed. */
  zoomPitch(factor: number, anchorY: number) {
    this.noteGesture();
    const H = this.canvas.getBoundingClientRect().height;
    const fit = H / DEFAULT_PITCH_RANGE;
    const oldRowH = this.pxPerPitch ?? fit;
    const oldTop = this.pxPerPitch === null ? DEFAULT_PITCH_TOP : this.pitchTop;
    const next = Math.min(MAX_PX_PER_PITCH, oldRowH * factor);
    if (next <= fit) {
      // Zoomed back out to where all 88 keys fit — return to auto-fit mode.
      this.pxPerPitch = null;
      return;
    }
    const anchorPitch = oldTop - anchorY / oldRowH;
    this.pxPerPitch = next;
    this.pitchTop = this.clampPitchTop(anchorPitch + anchorY / next, next, H);
  }

  /** Keep the zoomed pitch window inside [A0, C8]. */
  private clampPitchTop(top: number, rowH: number, H: number): number {
    const visible = H / rowH;
    const min = Math.min(PITCH_MIN + visible, PITCH_MAX);
    return Math.min(PITCH_MAX, Math.max(min, top));
  }

  /** Resume auto-following the playhead. */
  follow() {
    this.userOffset = null;
    this.resumeArmed = false;
  }

  /** Take over scrolling: freeze the view at its current offset. */
  unfollow() {
    this.userOffset = this.lastOffset;
    // An explicit unfollow means it, so it isn't undone by the auto-resume.
    this.resumeArmed = false;
  }

  get isFollowing(): boolean {
    return this.userOffset === null;
  }

  /**
   * True once after follow mode re-engaged on its own (the user scrolled back to
   * the live transcription frontier and then sat still). Lets the React side
   * light the "following" indicator back up without polling `isFollowing`, which
   * would also override the toggle in cases the roll doesn't own.
   */
  consumeAutoResumed(): boolean {
    const v = this.autoResumed;
    this.autoResumed = false;
    return v;
  }

  /** Translate a canvas-relative x pixel coordinate to a transport-time in seconds. */
  xToSeconds(x: number): number {
    return Math.max(0, this.lastOffset + (x - KEY_WIDTH) / this._pxPerSec);
  }

  /** Latest note end across all notes — drives x-axis scroll. */
  private maxEnd(): number {
    let m = 0;
    for (const n of this.notes) if (n.end > m) m = n.end;
    return m;
  }

  /** End of the scrollable content: the further of the audio length and last note. */
  private contentEnd(): number {
    return Math.max(this.contentDuration, this.maxEnd());
  }

  /**
   * Clamp a left-edge offset (seconds) to [0, contentEnd - viewSec] so the view
   * can't scroll past the start or beyond the end of the audio. `pxPerSec` is
   * passed in because callers (zoomTime) may be mid-change to it.
   */
  private clampOffset(offsetSec: number, pxPerSec: number): number {
    const contentW = this.canvas.getBoundingClientRect().width - KEY_WIDTH;
    const viewSec = contentW / pxPerSec;
    const max = Math.max(0, this.contentEnd() - viewSec);
    return Math.max(0, Math.min(offsetSec, max));
  }

  render() {
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;
    ctx.clearRect(0, 0, W, H);

    // The note area starts after the key strip; only that width shows time.
    const contentW = W - KEY_WIDTH;
    const maxT = Math.max(this.maxEnd(), this.playhead + 1);
    const viewSec = contentW / this._pxPerSec;

    // Ease the transcribed frontier toward its target.
    // null = not transcribing, which turns both the tint and the follow off.
    if (this.chunkFrontier !== null) {
      const target = Math.max(this.chunkFrontier, this.latestNoteStart);
      // Snap once effectively there, so it doesn't creep forever.
      this.transcribedSmooth +=
        (target - this.transcribedSmooth) * FRONTIER_SMOOTHING;
      if (Math.abs(target - this.transcribedSmooth) < 0.01) {
        this.transcribedSmooth = target;
      }
    } else {
      this.transcribedSmooth = 0; // tint off when there's nothing transcribed
    }
    const frontier =
      this.chunkFrontier !== null ? this.transcribedSmooth : null;
    // Until the user starts listening, the frontier is the interesting edge, so
    // the view follows it instead of the playhead parked at zero.
    const followFrontier =
      frontier !== null &&
      this.frontierLive &&
      this.playhead <= PLAYHEAD_START_EPS;

    // A scroll gesture (unlike the explicit follow toggle) only pauses
    // following: if it leaves the moving frontier in view, follow re-engages
    // once the user has been still for a second — so glancing back and
    // returning doesn't cost them the auto-scroll.
    if (this.userOffset !== null && this.resumeArmed && followFrontier) {
      const inView =
        frontier >= this.userOffset && frontier <= this.userOffset + viewSec;
      if (inView && performance.now() - this.lastGestureAt >= RESUME_IDLE_MS) {
        this.userOffset = null;
        this.resumeArmed = false;
        this.autoResumed = true;
      }
    }

    // Auto-scroll: keep the view still while the playhead is inside it; only
    // scroll once the playhead reaches the right third (or leaves the view to
    // the left, e.g. on stop). Manual scrolling (userOffset !== null) wins.
    let offsetSec: number;
    if (this.userOffset !== null) {
      // Re-clamp each frame so a window resize or newly-streamed notes can't
      // leave the frozen view stranded past the content end.
      offsetSec = Math.max(
        0,
        Math.min(this.userOffset, Math.max(0, this.contentEnd() - viewSec)),
      );
    } else if (followFrontier) {
      // Ease toward parking the frontier at the follow anchor. The frontier is
      // already smoothed, so this second ease just adds a little give.
      const target = Math.max(
        0,
        Math.min(
          frontier - viewSec * FOLLOW_ANCHOR_FRACTION,
          Math.max(0, this.contentEnd() - viewSec),
        ),
      );
      offsetSec =
        this.lastOffset +
        (target - this.lastOffset) * FRONTIER_FOLLOW_SMOOTHING;
      if (Math.abs(target - offsetSec) < 0.005) offsetSec = target;
    } else {
      offsetSec = this.lastOffset;
      if (this.playhead > offsetSec + viewSec * FOLLOW_ANCHOR_FRACTION) {
        offsetSec = this.playhead - viewSec * FOLLOW_ANCHOR_FRACTION;
      } else if (
        this.playhead > PLAYHEAD_START_EPS &&
        this.playhead < offsetSec
      ) {
        // A playhead parked at zero (transcription just finished, nothing
        // playing) isn't a reason to yank the view back to the start.
        offsetSec = this.playhead;
      }
      offsetSec = Math.max(0, Math.min(offsetSec, Math.max(0, maxT - viewSec)));
    }
    this.lastOffset = offsetSec;
    const pxPerSec = this._pxPerSec;

    // Pitch axis: auto-fit all 88 keys, or use the zoomed window if the user
    // has pinched vertically.
    const rowH = this.pxPerPitch ?? H / DEFAULT_PITCH_RANGE;
    const pitchTop =
      this.pxPerPitch === null ? DEFAULT_PITCH_TOP : this.pitchTop;
    this.lastRowH = rowH;
    this.lastPitchTop = pitchTop;

    // Everything time-indexed lives in the content area to the right of the
    // key strip; clip so notes/grid can't bleed under the keyboard.
    ctx.save();
    ctx.beginPath();
    ctx.rect(KEY_WIDTH, 0, contentW, H);
    ctx.clip();

    // Pitch grid: darker rows under the black keys, so each octave's shape is
    // readable at a glance (the keyboard's own pattern, mirrored into the notes).
    if (this.keyLanes) {
      const { tonic, scale } = this.keyLanes;
      for (let p = PITCH_MIN; p <= PITCH_MAX; p++) {
        if (!scale.has(p % 12)) continue;
        ctx.fillStyle = p % 12 === tonic ? TONIC_ROW : KEY_ROW;
        ctx.fillRect(KEY_WIDTH, (pitchTop - p) * rowH, contentW, rowH - 1);
      }
    } else if (this.display.pitchLanes) {
      ctx.fillStyle = palette().stripe;
      for (let p = PITCH_MIN; p <= PITCH_MAX; p++) {
        if (isBlackKey(p)) {
          const y = (pitchTop - p) * rowH;
          ctx.fillRect(KEY_WIDTH, y, contentW, rowH);
        }
      }
    }
    if (this.display.pitchLines) {
      ctx.strokeStyle = palette().grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let p = PITCH_MIN; p <= PITCH_MAX; p++) {
        const y = Math.round((pitchTop - p) * rowH) + 0.5;
        ctx.moveTo(KEY_WIDTH, y);
        ctx.lineTo(KEY_WIDTH + contentW, y);
      }
      ctx.stroke();
    }

    // Time grid: alternating bar shading plus beat lines once the tempo is
    // known, else a plain one-second ruler. The shading is translucent, so it
    // lifts the black-key rows above too instead of painting over them.
    const { lines, strips } = this.gridFor(offsetSec, offsetSec + viewSec, pxPerSec);
    const xAt = (t: number) => KEY_WIDTH + (t - offsetSec) * pxPerSec;
    ctx.fillStyle = BAR_STRIP;
    for (const s of strips)
      ctx.fillRect(xAt(s.from), 0, xAt(s.to) - xAt(s.from), H);
    if (this.display.secondMarkers) {
      ctx.lineWidth = 1;
      // Finest first, so a bar line is never painted over by a beat line.
      for (const kind of ["step", "beat", "bar"] as const) {
        ctx.strokeStyle = LINE_COLORS[kind];
        ctx.beginPath();
        for (const line of lines) {
          if (line.kind !== kind) continue;
          const x = Math.round(xAt(line.t)) + 0.5;
          ctx.moveTo(x, 0);
          ctx.lineTo(x, H);
        }
        ctx.stroke();
      }
    }

    if (this.range) {
      ctx.fillStyle = "rgba(143, 168, 255, 0.16)";
      const from = xAt(this.range.start);
      ctx.fillRect(from, 0, xAt(this.range.end) - from, H);
    }

    // Transcribed-so-far overlay: a faint light wash over the [0, t) time span
    // the backend has already processed. The frontier is the furthest of the
    // chunk-completion estimate (which advances across silent spans) and the
    // latest note onset (precise where notes exist); it's eased above, before
    // the scroll decision. Drawn over the grid but under the notes so they stay
    // crisp; clipped to content.
    if (frontier !== null) {
      const x0 = KEY_WIDTH + (0 - offsetSec) * pxPerSec;
      const x1 = KEY_WIDTH + (frontier - offsetSec) * pxPerSec;
      ctx.fillStyle = "rgba(255, 255, 255, 0.025)";
      ctx.fillRect(x0, 0, x1 - x0, H);
    }

    // Notes
    const now = performance.now();
    // Sliver of background between adjacent semitones, so notes on
    // consecutive pitches read as separate bars at any zoom level.
    const rowGap = Math.max(0.5, Math.min(4, rowH * 0.1));
    // Stack-shift budget for overlapping same-pitch notes: at most 3px, and
    // never past the row gap (minus a 1px border) — so a shifted note can't
    // collide with a note one semitone up. At the unzoomed row height this
    // rounds to no shift at all.
    const maxShift = Math.min(3, Math.max(0, rowGap - 1));
    const active = this.activeInstrument;
    const anySelected = this.selectedNotes.size > 0;
    for (const original of this.notes) {
      const n = (original.id && this.overrides?.get(original.id)) || original;
      const instrument = original.instrument;
      if (n.pitch < PITCH_MIN || n.pitch > PITCH_MAX) continue;
      if (this.hiddenInstruments.has(instrument)) continue;
      const x = KEY_WIDTH + (n.start - offsetSec) * pxPerSec;
      const full = Math.max(2, (n.end - n.start) * pxPerSec - NOTE_GAP_PX);
      // Left-to-right reveal: grow from the note's onset to its full width,
      // easing out over REVEAL_MS. Unstamped notes draw at full width.
      const reveal =
        original.spawn === undefined
          ? 1
          : easeOut(Math.min(1, (now - original.spawn) / REVEAL_MS));
      const w = full * reveal;
      if (x + w < KEY_WIDTH || x > W) continue;
      // Nudge up so notes hidden behind an overlapping same-pitch note peek
      // out. stackOffset counts overlapping notes, so it can grow large (a
      // sustained note under a run of staccato hits collects +1 per hit) —
      // cap the TOTAL shift at the budget above.
      const shift = Math.min((original.stackOffset ?? 0) * NOTE_STACK_PX, maxShift);
      const y = (pitchTop - n.pitch) * rowH - shift;
      if (y + rowH < 0 || y > H) continue;
      // Muting dims a track; while an instrument is highlighted (hovered in
      // the instrument list), every other track fades even further back.
      let alpha = this.mutedInstruments.has(instrument) ? 0.2 : 1;
      if (
        this.highlightedInstrument !== null &&
        instrument !== this.highlightedInstrument
      ) {
        alpha = Math.min(alpha, 0.15);
      }
      const selected = original.id !== undefined && this.selectedNotes.has(original.id);
      if (active !== null) {
        if (instrument !== active) alpha = Math.min(alpha, 0.12);
        else if (anySelected && !selected) alpha = Math.min(alpha, 0.45);
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = instrumentColor(instrument);
      const tall = Math.max(2, rowH - rowGap);
      const corner = Math.min(2, w / 2, tall / 2);
      ctx.beginPath();
      ctx.roundRect(x, y, w, tall, corner);
      ctx.fill();
      if (selected) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    if (this.marquee) {
      const { x0, y0, x1, y1 } = this.marquee;
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
      ctx.lineWidth = 1;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }

    this.drawRuler(ctx, contentW, offsetSec, pxPerSec);
    if (this.headerHeight > RULER_H) this.drawChords(ctx, contentW, offsetSec, pxPerSec);

    // Playhead
    const px = KEY_WIDTH + (this.playhead - offsetSec) * pxPerSec;
    ctx.strokeStyle = palette().playhead;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, H);
    ctx.stroke();

    ctx.restore();

    if (this.display.keyboard) {
      this.drawKeyboard(ctx, H, rowH, pitchTop);
    } else {
      ctx.fillStyle = palette().keyBlack;
      ctx.fillRect(0, 0, KEY_WIDTH, H);
    }
  }

  /** Time labels across the top, spaced so they never crowd. */
  private drawRuler(
    ctx: CanvasRenderingContext2D,
    contentW: number,
    offsetSec: number,
    pxPerSec: number,
  ) {
    ctx.fillStyle = "#191d26";
    ctx.fillRect(KEY_WIDTH, 0, contentW, RULER_H);
    if (this.range) {
      const from = KEY_WIDTH + (this.range.start - offsetSec) * pxPerSec;
      const to = KEY_WIDTH + (this.range.end - offsetSec) * pxPerSec;
      ctx.fillStyle = this.looping ? "#8fa8ff" : "rgba(143, 168, 255, 0.45)";
      ctx.fillRect(from, RULER_H - 4, to - from, 4);
    }
    ctx.font = `500 11px ${palette().bodyFont}`;
    ctx.textBaseline = "middle";
    ctx.lineWidth = 1;
    const { lines } = this.gridFor(offsetSec, offsetSec + contentW / pxPerSec, pxPerSec);
    for (const line of lines) {
      const tall = line.label !== undefined;
      if (!tall && line.kind !== "bar") continue;
      const x = Math.round(KEY_WIDTH + (line.t - offsetSec) * pxPerSec) + 0.5;
      ctx.strokeStyle = tall ? "#6b7487" : "#3d4659";
      ctx.beginPath();
      ctx.moveTo(x, tall ? RULER_H - 9 : RULER_H - 5);
      ctx.lineTo(x, RULER_H);
      ctx.stroke();
      if (tall) {
        ctx.fillStyle = "#c3c9d6";
        ctx.fillText(line.label!, x + 4, RULER_H / 2 - 2);
      }
    }
    ctx.strokeStyle = "#2c3342";
    ctx.beginPath();
    ctx.moveTo(KEY_WIDTH, RULER_H + 0.5);
    ctx.lineTo(KEY_WIDTH + contentW, RULER_H + 0.5);
    ctx.stroke();
  }

  /** The grid for a span: musical if there's a beat grid and it's chosen. */
  private gridFor(from: number, to: number, pxPerSec: number): RollGrid {
    return this.beatGrid && this.display.timeUnit === "bars"
      ? musicalGrid(this.beatGrid, from, to, pxPerSec)
      : secondsGrid(from, to, pxPerSec);
  }

  /** The chord bar: one block per chord, the one at the playhead lit up. */
  private drawChords(
    ctx: CanvasRenderingContext2D,
    contentW: number,
    offsetSec: number,
    pxPerSec: number,
  ) {
    const right = KEY_WIDTH + contentW;
    ctx.fillStyle = "#12151c";
    ctx.fillRect(KEY_WIDTH, RULER_H, contentW, CHORD_H);
    ctx.textBaseline = "middle";
    for (const chord of this.chords) {
      const from = KEY_WIDTH + (chord.start - offsetSec) * pxPerSec;
      const to = KEY_WIDTH + (chord.end - offsetSec) * pxPerSec;
      if (to < KEY_WIDTH) continue;
      if (from > right) break;
      const current = this.playhead >= chord.start && this.playhead < chord.end;
      ctx.fillStyle = current ? "rgba(143, 168, 255, 0.28)" : "#191d26";
      ctx.beginPath();
      ctx.roundRect(from + 1, RULER_H + 2, Math.max(1, to - from - 2), CHORD_H - 4, 3);
      ctx.fill();
      // Keep the name on screen when its chord began to the left of the view.
      const textX = Math.max(from, KEY_WIDTH) + 6;
      const room = to - textX - 4;
      ctx.font = `600 13px ${palette().bodyFont}`;
      const names = [chord.label, chord.root + chord.quality, chord.root].map(prettyChord);
      const text = names.find((t) => ctx.measureText(t).width <= room);
      if (text) {
        ctx.fillStyle = current ? "#ffffff" : "#c3c9d6";
        ctx.fillText(text, textX, RULER_H + 13);
      }
      ctx.font = `500 11px ${palette().bodyFont}`;
      if (chord.numeral && ctx.measureText(chord.numeral).width <= room) {
        ctx.fillStyle = current ? "#c9d4ff" : "#98a1b3";
        ctx.fillText(chord.numeral, textX, RULER_H + 27);
      }
    }
  }

  /** Draw the piano-key strip down the left edge, aligned to the pitch axis. */
  private drawKeyboard(
    ctx: CanvasRenderingContext2D,
    H: number,
    rowH: number,
    pitchTop: number,
  ) {
    const showLabels = rowH >= 8;
    if (showLabels) {
      ctx.font = palette().labelFont;
      ctx.textBaseline = "middle";
    }
    for (let p = PITCH_MIN; p <= PITCH_MAX; p++) {
      const y = (pitchTop - p) * rowH;
      if (y + rowH < 0 || y > H) continue;
      ctx.fillStyle = isBlackKey(p) ? palette().keyBlack : palette().keyWhite;
      ctx.fillRect(0, y, KEY_WIDTH, rowH);
      if (this.keyLanes && !this.keyLanes.scale.has(p % 12)) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.fillRect(0, y, KEY_WIDTH, rowH);
      } else if (this.keyLanes && p % 12 === this.keyLanes.tonic) {
        ctx.fillStyle = "rgba(143, 168, 255, 0.45)";
        ctx.fillRect(0, y, KEY_WIDTH, rowH);
      }
      // Thin separator between adjacent keys.
      ctx.strokeStyle = palette().stripe;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(KEY_WIDTH, y + 0.5);
      ctx.stroke();
      // Octave label on each C (MIDI 60 = C4).
      if (showLabels && p % 12 === 0) {
        ctx.fillStyle = "#c3c9d6";
        ctx.fillText(`C${p / 12 - 1}`, 4, y + rowH / 2);
      }
    }
    // Boundary between keyboard and note area.
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(KEY_WIDTH + 0.5, 0);
    ctx.lineTo(KEY_WIDTH + 0.5, H);
    ctx.stroke();
  }
}
