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

/**
 * The pitch to use when scale lock is on. Direction 0 finds the nearest in-key
 * pitch, and above or below searches that way, for a step up or down the scale.
 */
export function lockPitch(pitch: number, scale: ReadonlySet<number>, direction = 0): number {
  const inKey = (p: number) => p >= 0 && p <= 127 && scale.has(p % 12);
  if (scale.size === 0) return pitch;
  if (direction === 0 && inKey(pitch)) return pitch;
  for (let distance = direction === 0 ? 1 : 0; distance < 12; distance++) {
    if (direction >= 0 && inKey(pitch + distance)) return pitch + distance;
    if (direction <= 0 && inKey(pitch - distance)) return pitch - distance;
  }
  return pitch;
}

/**
 * Which stored notes a re-transcription replaces, as `[from, to)` in stored time.
 * `target` is in display time, and null means the whole song. `found` is already
 * in stored time, so a stop point taken from it needs no further shift. Stopped
 * early, only what was heard again goes: up to the last note found to start.
 */
export function replacedSpan(
  found: ProjectNote[],
  target: { start: number; end: number } | null,
  delay: number,
  stopped: boolean,
): { from: number; to: number } {
  const from = target ? target.start + delay : -Infinity;
  if (stopped) {
    const last = found.reduce((latest, n) => Math.max(latest, n.start), -Infinity);
    return { from, to: last + 0.001 };
  }
  return { from, to: target ? target.end + delay : Infinity };
}

/** Replace the notes that start in `[from, to)` with `found`, as one patch. */
export function replaceRange(
  notes: ProjectNote[],
  found: ProjectNote[],
  from: number,
  to: number,
): Patch {
  return { remove: notes.filter((n) => n.start >= from && n.start < to), add: found };
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
