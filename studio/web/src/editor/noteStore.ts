import type { ProjectNote } from "../api";

/** A change to the notes, reversible by swapping each side. */
export type Patch = {
  add?: ProjectNote[];
  remove?: ProjectNote[];
  update?: { before: ProjectNote; after: ProjectNote }[];
};

const UNDO_LIMIT = 500;

function inverse(patch: Patch): Patch {
  return {
    add: patch.remove,
    remove: patch.add,
    update: patch.update?.map(({ before, after }) => ({ before: after, after: before })),
  };
}

const isEmpty = (p: Patch) => !p.add?.length && !p.remove?.length && !p.update?.length;

/**
 * The one source of the project's notes. The roll, playback, export and autosave
 * all follow it. Notes are never changed in place: each edit replaces objects,
 * so a reader can tell whether anything moved by comparing `notes`.
 */
export class NoteStore {
  private byId = new Map<string, ProjectNote>();
  private undoStack: Patch[] = [];
  private redoStack: Patch[] = [];
  private listeners = new Set<() => void>();
  private cached: ProjectNote[] | null = null;

  constructor(notes: ProjectNote[] = []) {
    for (const n of notes) this.byId.set(n.id, n);
  }

  /** The current notes. The same array until the next change. */
  get notes(): ProjectNote[] {
    return (this.cached ??= [...this.byId.values()]);
  }

  get(id: string): ProjectNote | undefined {
    return this.byId.get(id);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Apply `patch` as one undo step. */
  apply(patch: Patch): void {
    if (isEmpty(patch)) return;
    this.run(patch);
    this.undoStack.push(patch);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.notify();
  }

  undo(): void {
    const patch = this.undoStack.pop();
    if (!patch) return;
    this.run(inverse(patch));
    this.redoStack.push(patch);
    this.notify();
  }

  redo(): void {
    const patch = this.redoStack.pop();
    if (!patch) return;
    this.run(patch);
    this.undoStack.push(patch);
    this.notify();
  }

  /** Call `fn` after every change. Returns the unsubscribe function. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private run(patch: Patch) {
    for (const n of patch.remove ?? []) this.byId.delete(n.id);
    for (const { after } of patch.update ?? []) this.byId.set(after.id, after);
    for (const n of patch.add ?? []) this.byId.set(n.id, n);
    this.cached = null;
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }
}
