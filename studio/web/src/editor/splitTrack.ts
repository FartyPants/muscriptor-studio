import type { ProjectNote } from "../api";
import type { Patch } from "./noteStore";

/** Notes repeating a pitch this many times, with no long gaps, are accompaniment. */
const MIN_RUN = 6;
/** Notes that start this close together, in seconds, were played together. */
const TOGETHER_SEC = 0.05;
/** Notes of a chord last about the same: within this share of the typical length. */
const SIMILAR_LENGTH = 0.5;
/** Different note names that make a chord. Octaves are one name: a doubled line. */
const MIN_CHORD_NAMES = 2;

/** The beat, in seconds, for a song with no detected tempo. */
export const NO_GRID_BEAT = 0.5;

export type SplitScope = { from: number; to: number };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The notes that aren't part of a pitch repeated at least `MIN_RUN` times. */
function outsideRuns(notes: ProjectNote[], beat: number): ProjectNote[] {
  const rows = new Map<number, ProjectNote[]>();
  for (const n of notes) {
    const row = rows.get(n.pitch);
    if (row) row.push(n);
    else rows.set(n.pitch, [n]);
  }
  const outside: ProjectNote[] = [];
  for (const row of rows.values()) {
    row.sort((a, b) => a.start - b.start);
    let run: ProjectNote[] = [];
    const endRun = () => {
      if (run.length < MIN_RUN) outside.push(...run);
      run = [];
    };
    for (const n of row) {
      if (run.length > 0 && n.start - run[run.length - 1].start > beat) endRun();
      run.push(n);
    }
    endRun();
  }
  return outside;
}

/** Of notes starting together, those that form a chord. */
function chordOf(group: ProjectNote[]): ProjectNote[] {
  const typical = median(group.map((n) => n.end - n.start));
  const alike = group.filter((n) => Math.abs(n.end - n.start - typical) <= SIMILAR_LENGTH * typical);
  return new Set(alike.map((n) => n.pitch % 12)).size >= MIN_CHORD_NAMES ? alike : [];
}

/**
 * Guess which notes of one track are the solo, leaving the chords. A pitch that
 * keeps repeating is accompaniment; of the rest, notes struck together as a
 * chord are too. Whatever remains is the solo.
 *
 * `beat` is in seconds. `scope` limits the guess to notes starting in it; the
 * repeats are still counted over the whole track. Empty when the guess can't
 * tell two parts apart in the scope.
 */
export function splitGuess(
  notes: ProjectNote[],
  beat: number,
  scope: SplitScope | null,
): Set<string> {
  const remaining = outsideRuns(notes, beat).sort((a, b) => a.start - b.start);
  const chords = new Set<string>();
  for (let at = 0; at < remaining.length; ) {
    let end = at + 1;
    while (end < remaining.length && remaining[end].start - remaining[at].start <= TOGETHER_SEC) end++;
    for (const n of chordOf(remaining.slice(at, end))) chords.add(n.id);
    at = end;
  }
  const inScope = (n: ProjectNote) => !scope || (n.start >= scope.from && n.start < scope.to);
  const marked = new Set(remaining.filter((n) => !chords.has(n.id) && inScope(n)).map((n) => n.id));
  return marked.size === notes.filter(inScope).length ? new Set() : marked;
}

/** Give the `marked` notes to the track `to`, as one undo step. */
export function splitPatch(notes: ProjectNote[], marked: ReadonlySet<string>, to: string): Patch {
  return {
    update: notes
      .filter((n) => marked.has(n.id))
      .map((before) => ({ before, after: { ...before, instrument: to } })),
  };
}
