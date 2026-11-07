import { describe, expect, it } from "vitest";
import { hitTest, NoteIndex, notesInBox, pitchAtY, type RollRect, type RollView } from "./hitTest";

const view: RollView = { keyWidth: 56, offsetSec: 0, pxPerSec: 100, pitchTop: 100, rowH: 10 };

const rect = (id: string, pitch: number, start: number, end: number, instrument = "violin"): RollRect => ({
  id,
  instrument,
  pitch,
  start,
  end,
});

/** The y at the middle of `pitch`'s row. */
const yOf = (pitch: number) => (view.pitchTop - pitch) * view.rowH + view.rowH / 2;
const xOf = (t: number) => view.keyWidth + t * view.pxPerSec;

describe("pitchAtY", () => {
  it("matches how the roll draws rows", () => {
    expect(pitchAtY((100 - 60) * 10, view)).toBe(60);
    expect(pitchAtY((100 - 60) * 10 + 9.9, view)).toBe(60);
    expect(pitchAtY((100 - 60) * 10 + 10.1, view)).toBe(59);
  });
});

describe("hitTest", () => {
  const notes = [rect("a", 60, 1, 2), rect("b", 62, 1, 2, "drums")];
  const index = new NoteIndex(notes);

  it("finds the body, and each edge", () => {
    const y = yOf(60);
    expect(hitTest(xOf(1.5), y, index, view, null)).toEqual({ noteId: "a", zone: "body" });
    expect(hitTest(xOf(1) + 2, y, index, view, null)).toEqual({ noteId: "a", zone: "left" });
    expect(hitTest(xOf(2) - 2, y, index, view, null)).toEqual({ noteId: "a", zone: "right" });
  });

  it("misses empty space, and the wrong row", () => {
    expect(hitTest(xOf(3), yOf(60), index, view, null)).toBeNull();
    expect(hitTest(xOf(1.5), yOf(61), index, view, null)).toBeNull();
  });

  it("ignores other instruments", () => {
    expect(hitTest(xOf(1.5), yOf(62), index, view, "violin")).toBeNull();
    expect(hitTest(xOf(1.5), yOf(62), index, view, "drums")?.noteId).toBe("b");
  });

  it("finds a note that spans several buckets from its middle", () => {
    const long = new NoteIndex([rect("l", 60, 0.5, 9.5)]);
    expect(hitTest(xOf(5), yOf(60), long, view, null)?.zone).toBe("body");
  });

  it("can grab a very short note", () => {
    const short = new NoteIndex([rect("s", 60, 1, 1.001)]);
    expect(hitTest(xOf(1) + 2, yOf(60), short, view, null)?.noteId).toBe("s");
  });

  it("picks the note drawn last when they overlap", () => {
    const both = new NoteIndex([rect("under", 60, 1, 2), rect("over", 60, 1.2, 1.8)]);
    expect(hitTest(xOf(1.5), yOf(60), both, view, null)?.noteId).toBe("over");
  });

  it("leaves a body zone on a short note", () => {
    const short = new NoteIndex([rect("s", 60, 1, 1.09)]);
    expect(hitTest(xOf(1.045), yOf(60), short, view, null)?.zone).toBe("body");
  });

  it("stays well under 1 ms on 10,000 notes", () => {
    const many = Array.from({ length: 10000 }, (_, i) =>
      rect(`n${i}`, 36 + (i % 48), (i / 10000) * 300, (i / 10000) * 300 + 0.4),
    );
    const big = new NoteIndex(many);
    const scrolled = { ...view, offsetSec: 100 };
    const started = performance.now();
    const runs = 2000;
    for (let i = 0; i < runs; i++) {
      hitTest(200 + (i % 800), 100 + (i % 400), big, scrolled, "violin");
    }
    expect((performance.now() - started) / runs).toBeLessThan(1);
  });
});

describe("notesInBox", () => {
  const index = new NoteIndex([
    rect("a", 60, 1, 2),
    rect("b", 72, 1, 2),
    rect("c", 60, 5, 6),
    rect("d", 60, 1, 2, "drums"),
  ]);

  it("selects notes touching the box", () => {
    const ids = notesInBox({ fromTime: 1.5, toTime: 3, lowPitch: 59, highPitch: 61 }, index, "violin");
    expect([...ids]).toEqual(["a"]);
  });

  it("includes every instrument when none is active", () => {
    const ids = notesInBox({ fromTime: 0, toTime: 3, lowPitch: 59, highPitch: 61 }, index, null);
    expect([...ids].sort()).toEqual(["a", "d"]);
  });

  it("counts a long note once", () => {
    const long = new NoteIndex([rect("l", 60, 0, 20)]);
    expect(notesInBox({ fromTime: 0, toTime: 20, lowPitch: 0, highPitch: 127 }, long, null).size).toBe(1);
  });
});
