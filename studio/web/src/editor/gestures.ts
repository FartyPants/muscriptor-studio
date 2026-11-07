import type { ProjectNote } from "../api";
import type { Patch } from "./noteStore";

/** Shorter notes can't be grabbed, or heard. */
export const MIN_NOTE_SEC = 0.03;

export type PitchLimits = { low: number; high: number };

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const pitchName = (pitch: number) => `${NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;

/** The status text for a selection, or "" when nothing is selected. */
export function describeSelection(selected: ProjectNote[]): string {
  if (selected.length === 0) return "";
  if (selected.length > 1) return `${selected.length.toLocaleString()} selected`;
  const { pitch } = selected[0];
  return `1 selected ${pitchName(pitch)} · MIDI ${pitch}`;
}

/** The selection after clicking note `id`. */
export function clickSelection(selected: Set<string>, id: string, additive: boolean): Set<string> {
  if (!additive) return selected.has(id) ? selected : new Set([id]);
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

/**
 * `notes` moved as a group. Hitting a limit stops the whole group, so the notes
 * keep their spacing.
 */
export function moveNotes(
  notes: ProjectNote[],
  dt: number,
  dp: number,
  limits: PitchLimits,
): ProjectNote[] {
  if (notes.length === 0) return [];
  const earliest = Math.min(...notes.map((n) => n.start));
  const lowest = Math.min(...notes.map((n) => n.pitch));
  const highest = Math.max(...notes.map((n) => n.pitch));
  const time = Math.max(dt, -earliest);
  const pitch = Math.min(Math.max(dp, limits.low - lowest), limits.high - highest);
  return notes.map((n) => ({
    ...n,
    start: n.start + time,
    end: n.end + time,
    pitch: n.pitch + pitch,
  }));
}

/** `notes` with one edge moved by `dt`, each kept at least `MIN_NOTE_SEC` long. */
export function resizeNotes(notes: ProjectNote[], edge: "left" | "right", dt: number): ProjectNote[] {
  return notes.map((n) =>
    edge === "left"
      ? { ...n, start: Math.min(Math.max(0, n.start + dt), n.end - MIN_NOTE_SEC) }
      : { ...n, end: Math.max(n.end + dt, n.start + MIN_NOTE_SEC) },
  );
}

/** A patch from `before` to `after`, matched by position, skipping no-ops. */
export function updatePatch(before: ProjectNote[], after: ProjectNote[]): Patch {
  const update = before
    .map((b, i) => ({ before: b, after: after[i] }))
    .filter(
      ({ before: b, after: a }) =>
        b.start !== a.start || b.end !== a.end || b.pitch !== a.pitch,
    );
  return { update };
}

/** Copies of `clip` for `instrument`, its earliest note landing at `at`. */
export function pasteNotes(
  clip: ProjectNote[],
  at: number,
  instrument: string,
  makeId: () => string,
): ProjectNote[] {
  if (clip.length === 0) return [];
  const first = Math.min(...clip.map((n) => n.start));
  return clip.map((n) => ({
    ...n,
    id: makeId(),
    instrument,
    start: n.start - first + at,
    end: n.end - first + at,
  }));
}
