import type { ProjectNote } from "../api";
import type { Patch } from "./noteStore";

/** Drum notes are GM drum-map pitches, so they never trade places with pitched ones. */
export const DRUMS = "drums";

/** Whether the track of `name` can be changed to another instrument. */
export const canChangeInstrument = (name: string) => name !== DRUMS;

/** What the track of `from` can become: every pitched instrument but itself. */
export function instrumentTargets(available: string[], from: string): string[] {
  return available.filter((name) => name !== from && name !== DRUMS);
}

/**
 * Give every note of `from` to `to`, as one undo step. Notes keep their ids,
 * pitches and times, so a track that already plays `to` takes them in.
 */
export function changeInstrument(notes: ProjectNote[], from: string, to: string): Patch {
  if (from === to || !canChangeInstrument(from) || !canChangeInstrument(to)) return {};
  return {
    update: notes
      .filter((n) => n.instrument === from)
      .map((before) => ({ before, after: { ...before, instrument: to } })),
  };
}

/**
 * Mute or solo state after `from` became `to`. A renamed track keeps its own;
 * one merged into an existing track takes that track's.
 */
export function movedFlag(set: Set<string>, from: string, to: string, merged: boolean): Set<string> {
  if (!set.has(from)) return set;
  const next = new Set(set);
  next.delete(from);
  if (!merged) next.add(to);
  return next;
}
