import { errorDetail } from "./export";
import type { BeatGrid } from "./pianoroll";

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
  audio_name: string;
  created: number;
  updated: number;
  opened: number;
};

async function json<T>(resp: Response): Promise<T> {
  if (!resp.ok) throw new Error(await errorDetail(resp));
  return resp.json();
}

const send = (doc: unknown, method: string): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(doc),
});

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

  async audioFile(doc: ProjectDoc): Promise<File> {
    const resp = await fetch(`/studio/api/projects/${doc.id}/audio`);
    if (!resp.ok) throw new Error(await errorDetail(resp));
    const blob = await resp.blob();
    return new File([blob], doc.audio_name, { type: blob.type });
  },
};
