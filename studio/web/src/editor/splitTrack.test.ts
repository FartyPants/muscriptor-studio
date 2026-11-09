import { describe, expect, it } from "vitest";
import type { ProjectNote } from "../api";
import { splitGuess, splitPatch } from "./splitTrack";

const GUITAR = "acoustic_guitar";
let nextId = 0;

function note(pitch: number, start: number, length = 0.3): ProjectNote {
  return { id: `n${nextId++}`, instrument: GUITAR, pitch, start, end: start + length };
}

const ids = (notes: ProjectNote[]) => new Set(notes.map((n) => n.id));

/** Three rows repeating under a figure on the same grid, like the Witcher guitar. */
function riffWithFigure(bars = 4) {
  const rows: ProjectNote[] = [];
  const figure: ProjectNote[] = [];
  for (let bar = 0; bar < bars; bar++) {
    for (let step = 0; step < 12; step++) {
      for (const pitch of [50, 57, 62]) rows.push(note(pitch, bar * 4 + (step * 4) / 12));
    }
    [
      [64, 0],
      [65, 2],
      [64, 5],
      [60, 8],
    ].forEach(([pitch, step]) => figure.push(note(pitch, bar * 4 + (step * 4) / 12)));
  }
  return { rows, figure };
}

/** Four-note chords changing every bar, held, under a solo in eighths. */
function chordsAndSolo() {
  const chords: ProjectNote[] = [];
  const solo: ProjectNote[] = [];
  [48, 53, 55, 50, 48, 53, 55, 50].forEach((root, bar) => {
    for (const up of [0, 7, 12, 16]) chords.push(note(root + up, bar * 4, 3.9));
    [76, 77, 79, 81, 79, 77, 76, 74].forEach((pitch, step) =>
      solo.push(note(pitch + (bar % 3), bar * 4 + step * 0.5, 0.45)),
    );
  });
  return { chords, solo };
}

describe("splitGuess", () => {
  it("marks a figure played on the same grid as a repeating riff", () => {
    const { rows, figure } = riffWithFigure();
    expect(splitGuess([...rows, ...figure], 1, null)).toEqual(ids(figure));
  });

  it("marks the solo over chords that keep changing, even where they start together", () => {
    const { chords, solo } = chordsAndSolo();
    expect(splitGuess([...chords, ...solo], 1, null)).toEqual(ids(solo));
  });

  it("keeps a line doubled at the octave as solo", () => {
    const { rows } = riffWithFigure();
    const line = [note(64, 1), note(76, 1), note(65, 3), note(77, 3)];
    expect(splitGuess([...rows, ...line], 1, null)).toEqual(ids(line));
  });

  it("reads two different note names struck together as a chord", () => {
    const { rows } = riffWithFigure();
    const fifth = [note(45, 1), note(52, 1)];
    const lone = note(70, 3);
    expect(splitGuess([...rows, ...fifth, lone], 1, null)).toEqual(ids([lone]));
  });

  it("marks nothing when there is nothing but chords", () => {
    const { rows } = riffWithFigure();
    expect(splitGuess(rows, 1, null).size).toBe(0);
  });

  it("marks nothing when every note would move", () => {
    const line = [note(60, 0), note(62, 1), note(64, 2), note(65, 3)];
    expect(splitGuess(line, 1, null).size).toBe(0);
  });

  it("limits the marks to the scope", () => {
    const { rows, figure } = riffWithFigure(4);
    const marks = splitGuess([...rows, ...figure], 1, { from: 4, to: 8 });
    expect(marks).toEqual(ids(figure.filter((n) => n.start >= 4 && n.start < 8)));
  });

  it("counts a run across the edge of the scope in full", () => {
    // Only three of this run's notes are in the scope, but it is six long.
    const run = [0, 0.5, 1, 1.5, 2, 2.5].map((t) => note(50, t));
    const lone = note(70, 2.2);
    expect(splitGuess([...run, lone], 1, { from: 1.5, to: 3 })).toEqual(ids([lone]));
  });

  it("uses the beat to tell repeats from separate notes", () => {
    const spaced = [0, 2, 4, 6, 8, 10].map((t) => note(50, t));
    const other = [0, 0.4, 0.8, 1.2, 1.6, 2].map((t) => note(40, t));
    expect(splitGuess([...spaced, ...other], 1, null)).toEqual(ids(spaced));
    expect(splitGuess([...spaced, ...other], 3, null).size).toBe(0);
  });
});

describe("splitGuess edges", () => {
  const riff = () => [0, 1, 2, 3, 4, 5].map((t) => note(50, t));

  it("counts a gap of exactly one beat as the same run, and a longer one as not", () => {
    const lone = note(70, 2.5);
    expect(splitGuess([...riff(), lone], 1, null)).toEqual(ids([lone]));
    const broken = [0, 1, 2, 3, 4, 5.01].map((t) => note(50, t));
    expect(splitGuess([...broken, ...riff().map((n) => ({ ...n, pitch: 45 }))], 1, null)).toEqual(ids(broken));
  });

  it("reads notes within 50 ms as struck together, and later ones as not", () => {
    const pair = [note(45, 1), note(52, 1.04)];
    expect(splitGuess([...riff(), ...pair], 1, null).size).toBe(0);
    const apart = [note(45, 1), note(52, 1.06)];
    expect(splitGuess([...riff(), ...apart], 1, null)).toEqual(ids(apart));
  });
});

describe("splitPatch", () => {
  it("moves only the marked notes and keeps everything else about them", () => {
    const a = note(60, 0);
    const b = note(64, 1);
    const patch = splitPatch([a, b], new Set([b.id]), `${GUITAR}#2`);
    expect(patch.update).toEqual([{ before: b, after: { ...b, instrument: `${GUITAR}#2` } }]);
  });
});
