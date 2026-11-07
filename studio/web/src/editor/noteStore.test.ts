import { describe, expect, it, vi } from "vitest";
import type { ProjectNote } from "../api";
import { NoteStore } from "./noteStore";

const note = (id: string, pitch = 60, start = 0.1 + 0.2, end = 1 / 3): ProjectNote => ({
  id,
  instrument: "violin",
  pitch,
  start,
  end,
});

describe("NoteStore", () => {
  it("starts with the given notes", () => {
    expect(new NoteStore([note("a"), note("b")]).notes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("adds, removes and updates", () => {
    const a = note("a");
    const s = new NoteStore([a, note("b")]);
    s.apply({
      add: [note("c")],
      remove: [s.get("b")!],
      update: [{ before: a, after: { ...a, pitch: 72 } }],
    });
    expect(s.notes.map((n) => n.id).sort()).toEqual(["a", "c"]);
    expect(s.get("a")!.pitch).toBe(72);
  });

  it("undo restores exact values, including awkward floats", () => {
    const a = note("a");
    const s = new NoteStore([a]);
    s.apply({ update: [{ before: a, after: { ...a, start: 5, end: 6 } }] });
    s.undo();
    expect(s.get("a")).toEqual(a);
    expect(s.get("a")!.start).toBe(0.1 + 0.2);
    expect(s.get("a")!.end).toBe(1 / 3);
  });

  it("undo and redo walk through several steps", () => {
    const s = new NoteStore();
    s.apply({ add: [note("a")] });
    s.apply({ add: [note("b")] });
    s.undo();
    expect(s.notes.map((n) => n.id)).toEqual(["a"]);
    s.undo();
    expect(s.notes).toEqual([]);
    s.redo();
    s.redo();
    expect(s.notes.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });

  it("undoes a delete", () => {
    const a = note("a");
    const s = new NoteStore([a]);
    s.apply({ remove: [a] });
    expect(s.notes).toEqual([]);
    s.undo();
    expect(s.get("a")).toEqual(a);
  });

  it("a new edit clears redo", () => {
    const s = new NoteStore();
    s.apply({ add: [note("a")] });
    s.undo();
    expect(s.canRedo).toBe(true);
    s.apply({ add: [note("b")] });
    expect(s.canRedo).toBe(false);
  });

  it("ignores empty patches", () => {
    const s = new NoteStore([note("a")]);
    const heard = vi.fn();
    s.subscribe(heard);
    s.apply({ update: [] });
    expect(s.canUndo).toBe(false);
    expect(heard).not.toHaveBeenCalled();
  });

  it("notifies on every change and stops after unsubscribe", () => {
    const s = new NoteStore();
    const heard = vi.fn();
    const off = s.subscribe(heard);
    s.apply({ add: [note("a")] });
    s.undo();
    s.redo();
    expect(heard).toHaveBeenCalledTimes(3);
    off();
    s.undo();
    expect(heard).toHaveBeenCalledTimes(3);
  });

  it("keeps the same array until something changes", () => {
    const s = new NoteStore([note("a")]);
    const first = s.notes;
    expect(s.notes).toBe(first);
    s.apply({ add: [note("b")] });
    expect(s.notes).not.toBe(first);
  });

  it("does not change notes in place", () => {
    const a = note("a");
    const s = new NoteStore([a]);
    s.apply({ update: [{ before: a, after: { ...a, pitch: 72 } }] });
    expect(a.pitch).toBe(60);
  });
});
