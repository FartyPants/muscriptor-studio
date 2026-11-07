import { errorDetail } from "./export";
import { readEvents } from "./sse";
import type { BeatGrid, ChordSpan } from "./pianoroll";

export type ModelSize = "large" | "medium";

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

export type ProjectDoc = {
  id: string;
  name: string;
  status: ProjectStatus;
  model: ModelSize | null;
  notes: ProjectNote[];
  beat_grid: BeatGrid | null;
  /** Instruments to limit transcription to. Unset until a choice is made. */
  hints?: string[];
  audio_name: string;
  created: number;
  updated: number;
  opened: number;
};

type ScanEvent =
  | { type: "progress"; completed: number; total: number }
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

export type Analysis = {
  key: { label: string; mode: string; confidence: number } | null;
  chords: ChordSpan[];
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

  analysis: (notes: ProjectNote[], beat_grid: BeatGrid | null) =>
    fetch("/studio/api/analysis", send({ notes, beat_grid }, "POST")).then(json<Analysis>),

  /** Load the model `doc` was set up for, if another one is in memory. */
  async ensureModel(doc: ProjectDoc) {
    const state = await api.models();
    if (doc.model && state.active !== doc.model) await api.chooseModel(doc.model);
  },

  /** Suggested instrument names, most notes first. */
  async detectInstruments(
    doc: ProjectDoc,
    signal: AbortSignal,
    onProgress: (done: number, total: number) => void,
  ): Promise<string[]> {
    await api.ensureModel(doc);
    const resp = await fetch(`/studio/api/projects/${doc.id}/detect-instruments`, {
      method: "POST",
      signal,
    });
    if (!resp.ok || !resp.body) throw new Error(await errorDetail(resp));
    for await (const raw of readEvents(resp.body)) {
      const event = raw as ScanEvent;
      if (event.type === "progress") onProgress(event.completed, event.total);
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
