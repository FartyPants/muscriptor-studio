import type { DiagramShape } from "./chordDiagram";
import { errorDetail } from "./export";
import { readEvents } from "./sse";
import type { BeatGrid, ChordSpan } from "./pianoroll";

export type ModelSize = "large" | "medium" | "small";

export type ModelInfo = { size: ModelSize; available: boolean; active: boolean };

export type ModelsState = {
  models: ModelInfo[];
  active: ModelSize | null;
  busy: boolean;
  switching: boolean;
};

/**
 * A note in a project. `start` and `end` are streamed times, as /transcribe sent
 * them and /export expects them: the views subtract the grid's `onset_delay`.
 */
export type ProjectNote = {
  id: string;
  instrument: string;
  pitch: number;
  start: number;
  end: number;
};

/** `partial`: stopped early, with the notes transcribed up to then. */
export type ProjectStatus = "created" | "transcribing" | "completed" | "partial";

export type ChosenKey = { tonic: number; mode: "major" | "minor" };

export type ProjectSummary = {
  id: string;
  name: string;
  status: ProjectStatus;
  model: ModelSize | null;
  note_count: number;
  updated: number;
  created: number;
  opened: number;
  /** Seconds of audio. Null when the file's length can't be read. */
  duration: number | null;
  audio_size: number;
  hints?: string[];
};

export type InstrumentSuggestion = { label: string; instruments: string[]; score: number };

export type ProjectDoc = {
  id: string;
  name: string;
  status: ProjectStatus;
  model: ModelSize | null;
  notes: ProjectNote[];
  beat_grid: BeatGrid | null;
  /** Instruments to limit transcription to. Unset until a choice is made. */
  hints?: string[];
  /** The key set by hand. Unset or null follows detection. */
  key?: ChosenKey | null;
  /** Beats per bar set by hand. Unset or null follows detection. */
  meter?: number | null;
  /** Tab and chord diagram choices for the score. Unset means none. */
  fretboard?: Fretboard | null;
  audio_name: string;
  created: number;
  updated: number;
  opened: number;
};

type ScanEvent =
  | { type: "progress"; completed: number; total: number }
  | { type: "heard"; suggestions: InstrumentSuggestion[] }
  | { type: "error"; message: string }
  | { type: "instruments"; instruments: { name: string; notes: number }[] };

async function json<T>(resp: Response): Promise<T> {
  if (!resp.ok) throw new Error(await errorDetail(resp));
  return resp.json();
}

const send = (doc: unknown, method: string): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(doc),
});

type KeyInfo = { tonic: number; mode: string; label: string; confidence: number; scale: number[] };

export type Analysis = {
  /** The key in use: the chosen one, or else the detected one. */
  key: KeyInfo | null;
  detected: KeyInfo | null;
  chords: ChordSpan[];
};

async function blob(resp: Response): Promise<Blob> {
  if (!resp.ok) throw new Error(await errorDetail(resp));
  return resp.blob();
}

/** Sheet music for the Score tab. Times are transport seconds. */
export type Tuning = "guitar" | "drop_d" | "ukulele" | "ukulele_low_g";

export type Fretboard = {
  tuning: Tuning;
  /** 0 to 7. Frets count from the capo; chord names stay at concert pitch. */
  capo: number;
  /** The track that gets a tab staff, or null for none. */
  tab: string | null;
  /** Chord diagrams above the chord names. */
  diagrams: boolean;
};

export const NO_FRETBOARD: Fretboard = { tuning: "guitar", capo: 0, tab: null, diagrams: false };

/** What fitting the tab changed: notes moved by octaves, chord notes left out. */
export type TabReport = { moved: number; dropped: number };

export type ScoreView = {
  musicxml: string;
  /** Where each measure starts. */
  measures: number[];
  /** Where the last measure ends. */
  end: number;
  key: string | null;
  chords: number;
  /** Null when no tab was asked for, or its track isn't in the score. */
  tab: TabReport | null;
  /** One chord shape per chord symbol, in score order, when diagrams are on. */
  diagrams: DiagramShape[] | null;
};

export const api = {
  models: () => fetch("/studio/api/models").then(json<ModelsState>),

  chooseModel: (size: ModelSize) =>
    fetch("/studio/api/model", send({ size }, "POST")).then(json<{ active: ModelSize }>),

  createProject(file: File, model: ModelSize) {
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("model", model);
    return fetch("/studio/api/projects", { method: "POST", body: form }).then(json<ProjectDoc>);
  },

  getProject: (id: string) => fetch(`/studio/api/projects/${id}`).then(json<ProjectDoc>),

  saveProject: (doc: ProjectDoc) =>
    fetch(`/studio/api/projects/${doc.id}`, send(doc, "PUT")).then(json<ProjectDoc>),

  beatGrid: (id: string, onsets: number[]) =>
    fetch(`/studio/api/projects/${id}/beat-grid`, send({ onsets }, "POST"))
      .then(json<{ beat_grid: BeatGrid | null }>)
      .then((r) => r.beat_grid),

  projects: () => fetch("/studio/api/projects").then(json<ProjectSummary[]>),

  /** Note that a project was opened, for the Library's order. */
  markOpened: (id: string) => fetch(`/studio/api/projects/${id}/opened`, { method: "POST" }),

  analysis: (notes: ProjectNote[], beat_grid: BeatGrid | null, key: ChosenKey | null) =>
    fetch("/studio/api/analysis", send({ notes, beat_grid, key }, "POST")).then(json<Analysis>),

  scoreView: (body: unknown) =>
    fetch("/studio/api/score/view", send(body, "POST")).then(json<ScoreView>),
  scoreMusicXml: (body: unknown) =>
    fetch("/studio/api/score/musicxml", send(body, "POST")).then(blob),

  scorePdf: (body: unknown) => fetch("/studio/api/score/pdf", send(body, "POST")).then(blob),

  /** Part of the project's audio, as a file to transcribe. */
  async audioRange(id: string, range: { start: number; end: number }): Promise<File> {
    const query = `start=${range.start}&end=${range.end}`;
    const data = await fetch(`/studio/api/projects/${id}/audio-range?${query}`).then(blob);
    return new File([data], "range.wav", { type: "audio/wav" });
  },

  /** Load the model `doc` was set up for, if another one is in memory. */
  async ensureModel(doc: ProjectDoc, onLoading?: () => void) {
    const state = await api.models();
    if (doc.model && state.active !== doc.model) {
      onLoading?.();
      await api.chooseModel(doc.model);
    }
  },

  /** Suggested instrument names, most notes first. */
  async detectInstruments(
    doc: ProjectDoc,
    signal: AbortSignal,
    on: {
      onProgress: (done: number, total: number) => void;
      onLoading: () => void;
      onHeard: (suggestions: InstrumentSuggestion[]) => void;
    },
  ): Promise<string[]> {
    await api.ensureModel(doc, on.onLoading);
    const resp = await fetch(`/studio/api/projects/${doc.id}/detect-instruments`, {
      method: "POST",
      signal,
    });
    if (!resp.ok || !resp.body) throw new Error(await errorDetail(resp));
    for await (const raw of readEvents(resp.body)) {
      const event = raw as ScanEvent;
      if (event.type === "progress") on.onProgress(event.completed, event.total);
      else if (event.type === "heard") on.onHeard(event.suggestions);
      else if (event.type === "error") throw new Error(event.message);
      else return event.instruments.map((i) => i.name);
    }
    throw new Error("the analysis ended early");
  },

  async audioFile(doc: ProjectDoc): Promise<File> {
    const resp = await fetch(`/studio/api/projects/${doc.id}/audio`);
    if (!resp.ok) throw new Error(await errorDetail(resp));
    const blob = await resp.blob();
    return new File([blob], doc.audio_name, { type: blob.type });
  },
};
