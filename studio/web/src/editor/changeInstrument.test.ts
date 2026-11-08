import { describe, expect, it } from "vitest";
import type { ProjectNote } from "../api";
import { changeInstrument, instrumentTargets, movedFlag, restoredFlag } from "./changeInstrument";
import { NoteStore } from "./noteStore";

const note = (id: string, instrument: string, pitch = 60): ProjectNote => ({
  id,
  instrument,
  pitch,
  start: 1,
  end: 2,
});

describe("changeInstrument", () => {
  const notes = [note("a", "string_ensemble"), note("b", "string_ensemble", 64), note("c", "flutes")];

  it("moves every note of the track, keeping ids, pitches and times", () => {
    const store = new NoteStore(notes);
    store.apply(changeInstrument(store.notes, "string_ensemble", "violin"));
    expect(store.get("a")).toEqual({ ...notes[0], instrument: "violin" });
    expect(store.get("b")).toEqual({ ...notes[1], instrument: "violin" });
    expect(store.get("c")).toBe(notes[2]);
  });

  it("merges into a track that already plays the instrument, and undoes in one step", () => {
    const store = new NoteStore(notes);
    store.apply(changeInstrument(store.notes, "string_ensemble", "flutes"));
    expect(new Set(store.notes.map((n) => n.instrument))).toEqual(new Set(["flutes"]));
    store.undo();
    expect(store.notes.filter((n) => n.instrument === "string_ensemble")).toHaveLength(2);
    expect(store.canUndo).toBe(false);
  });

  it("keeps drums apart from pitched instruments", () => {
    const withDrums = [...notes, note("d", "drums", 36)];
    expect(changeInstrument(withDrums, "drums", "acoustic_piano")).toEqual({});
    expect(changeInstrument(withDrums, "flutes", "drums")).toEqual({});
    expect(changeInstrument(withDrums, "flutes", "flutes")).toEqual({});
  });
});

describe("instrumentTargets", () => {
  it("offers every pitched instrument but the track's own", () => {
    expect(instrumentTargets(["acoustic_piano", "flutes", "drums", "violin"], "flutes")).toEqual([
      "acoustic_piano",
      "violin",
    ]);
  });
});

describe("restoredFlag", () => {
  it("puts a renamed track's state back", () => {
    expect(restoredFlag(new Set(["violin"]), "flutes", "violin", false, true)).toEqual(new Set(["flutes"]));
  });

  it("gives an unmerged track its own state, and leaves the other track's", () => {
    expect(restoredFlag(new Set(["violin"]), "flutes", "violin", true, true)).toEqual(new Set(["flutes", "violin"]));
    const other = new Set(["violin"]);
    expect(restoredFlag(other, "flutes", "violin", true, false)).toBe(other);
  });
});

describe("a patch's effect", () => {
  it("runs on undo and redo, not on apply", () => {
    const calls: string[] = [];
    const store = new NoteStore([note("a", "flutes")]);
    store.apply({
      ...changeInstrument(store.notes, "flutes", "violin"),
      effect: { undo: () => calls.push("undo"), redo: () => calls.push("redo") },
    });
    expect(calls).toEqual([]);
    store.undo();
    store.redo();
    expect(calls).toEqual(["undo", "redo"]);
  });
});

describe("movedFlag", () => {
  it("carries a renamed track's mute or solo to its new name", () => {
    expect(movedFlag(new Set(["flutes"]), "flutes", "violin", false)).toEqual(new Set(["violin"]));
  });

  it("gives a merged track the state of the track it joined", () => {
    expect(movedFlag(new Set(["flutes"]), "flutes", "violin", true)).toEqual(new Set());
    const other = new Set(["drums"]);
    expect(movedFlag(other, "flutes", "violin", false)).toBe(other);
  });
});
