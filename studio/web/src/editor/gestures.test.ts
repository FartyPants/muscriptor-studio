import { describe, expect, it } from "vitest";
import type { ProjectNote } from "../api";
import {
  clickSelection,
  describeSelection,
  lockPitch,
  MIN_NOTE_SEC,
  moveNotes,
  pasteNotes,
  pitchName,
  replaceRange,
  resizeNotes,
  updatePatch,
} from "./gestures";

const note = (id: string, pitch: number, start: number, end: number): ProjectNote => ({
  id,
  instrument: "violin",
  pitch,
  start,
  end,
});
const limits = { low: 21, high: 108 };

describe("pitch names", () => {
  it("matches the screenshot's example", () => {
    expect(pitchName(74)).toBe("D5");
    expect(pitchName(60)).toBe("C4");
    expect(pitchName(61)).toBe("C#4");
    expect(pitchName(21)).toBe("A0");
  });

  it("describes selections", () => {
    expect(describeSelection([])).toBe("");
    expect(describeSelection([note("a", 74, 0, 1)])).toBe("1 selected D5 · MIDI 74");
    expect(describeSelection([note("a", 74, 0, 1), note("b", 60, 0, 1)])).toBe("2 selected");
  });
});

describe("clickSelection", () => {
  it("selects only the clicked note", () => {
    expect([...clickSelection(new Set(["a"]), "b", false)]).toEqual(["b"]);
  });

  it("keeps a group when clicking inside it, so it can be dragged", () => {
    const group = new Set(["a", "b"]);
    expect(clickSelection(group, "a", false)).toBe(group);
  });

  it("toggles with shift", () => {
    expect([...clickSelection(new Set(["a"]), "b", true)].sort()).toEqual(["a", "b"]);
    expect([...clickSelection(new Set(["a", "b"]), "a", true)]).toEqual(["b"]);
  });
});

describe("moveNotes", () => {
  it("moves time and pitch", () => {
    expect(moveNotes([note("a", 60, 1, 2)], 0.5, 2, limits)[0]).toMatchObject({
      pitch: 62,
      start: 1.5,
      end: 2.5,
    });
  });

  it("stops a group at time 0, keeping spacing", () => {
    const moved = moveNotes([note("a", 60, 0.5, 1), note("b", 60, 2, 3)], -5, 0, limits);
    expect(moved.map((n) => n.start)).toEqual([0, 1.5]);
    expect(moved[1].end).toBe(2.5);
  });

  it("stops a group at the pitch limits, keeping intervals", () => {
    const up = moveNotes([note("a", 100, 0, 1), note("b", 106, 0, 1)], 0, 12, limits);
    expect(up.map((n) => n.pitch)).toEqual([102, 108]);
    const down = moveNotes([note("a", 22, 0, 1), note("b", 30, 0, 1)], 0, -12, limits);
    expect(down.map((n) => n.pitch)).toEqual([21, 29]);
  });

  it("leaves the instrument and id alone", () => {
    expect(moveNotes([note("a", 60, 1, 2)], 1, 0, limits)[0]).toMatchObject({
      id: "a",
      instrument: "violin",
    });
  });

  it("handles nothing", () => {
    expect(moveNotes([], 1, 1, limits)).toEqual([]);
  });
});

describe("resizeNotes", () => {
  it("moves each edge", () => {
    expect(resizeNotes([note("a", 60, 1, 2)], "right", 0.5)[0].end).toBe(2.5);
    expect(resizeNotes([note("a", 60, 1, 2)], "left", 0.5)[0].start).toBe(1.5);
  });

  it("enforces a minimum length", () => {
    expect(resizeNotes([note("a", 60, 1, 2)], "right", -5)[0].end).toBeCloseTo(1 + MIN_NOTE_SEC);
    expect(resizeNotes([note("a", 60, 1, 2)], "left", 5)[0].start).toBeCloseTo(2 - MIN_NOTE_SEC);
  });

  it("never starts before 0", () => {
    expect(resizeNotes([note("a", 60, 0.2, 2)], "left", -5)[0].start).toBe(0);
  });
});

describe("updatePatch", () => {
  it("skips notes that did not change", () => {
    const a = note("a", 60, 0, 1);
    const b = note("b", 62, 0, 1);
    const patch = updatePatch([a, b], [a, { ...b, pitch: 63 }]);
    expect(patch.update).toEqual([{ before: b, after: { ...b, pitch: 63 } }]);
  });
});

describe("lockPitch", () => {
  const cMajor = new Set([0, 2, 4, 5, 7, 9, 11]);

  it("leaves an in-key pitch", () => {
    expect(lockPitch(60, cMajor)).toBe(60);
  });

  it("finds the nearest in-key pitch", () => {
    expect(lockPitch(61, cMajor)).toBe(62);
    expect(lockPitch(66, cMajor)).toBe(67);
  });

  it("steps along the scale in the direction of travel", () => {
    expect(lockPitch(61, cMajor, 1)).toBe(62);
    expect(lockPitch(61, cMajor, -1)).toBe(60);
    expect(lockPitch(63, cMajor, -1)).toBe(62);
  });

  it("stays in range", () => {
    expect(lockPitch(127, new Set([0]), 1)).toBeLessThanOrEqual(127);
    expect(lockPitch(0, new Set([1]), -1)).toBeGreaterThanOrEqual(0);
  });

  it("does nothing without a scale", () => {
    expect(lockPitch(61, new Set())).toBe(61);
  });
});

describe("replaceRange", () => {
  const notes = [note("a", 60, 1, 2), note("b", 60, 3, 4), note("c", 60, 5, 6)];

  it("removes only notes starting inside, and adds the new ones", () => {
    const fresh = [note("n", 62, 3.5, 4)];
    const patch = replaceRange(notes, fresh, 3, 5);
    expect(patch.remove?.map((n) => n.id)).toEqual(["b"]);
    expect(patch.add).toEqual(fresh);
  });

  it("a note starting at the end of the range stays", () => {
    expect(replaceRange(notes, [], 3, 5).remove?.map((n) => n.id)).toEqual(["b"]);
  });

  it("covers the whole song with an open end", () => {
    expect(replaceRange(notes, [], 0, Infinity).remove?.length).toBe(3);
  });
});

describe("pasteNotes", () => {
  it("keeps timing, lands on the target, and uses new ids", () => {
    let i = 0;
    const out = pasteNotes(
      [note("a", 60, 2, 2.5), note("b", 64, 3, 3.5)],
      10,
      "drums",
      () => `new${i++}`,
    );
    expect(out.map((n) => n.start)).toEqual([10, 11]);
    expect(out.map((n) => n.end)).toEqual([10.5, 11.5]);
    expect(out.map((n) => n.id)).toEqual(["new0", "new1"]);
    expect(out[0].instrument).toBe("drums");
  });
});
