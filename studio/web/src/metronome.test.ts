import { describe, expect, it } from "vitest";
import { metronomeClicks } from "./metronome";
import type { BeatGrid } from "./pianoroll";

const grid = (over: Partial<BeatGrid> = {}): BeatGrid => ({
  bpm: 120,
  beats_per_bar: 4,
  first_downbeat: 0,
  onset_delay: 0,
  ...over,
});

describe("metronomeClicks", () => {
  it("is empty without a grid", () => {
    expect(metronomeClicks(null, 10)).toEqual([]);
  });

  it("spaces a steady grid evenly and accents the bar", () => {
    const clicks = metronomeClicks(grid(), 2.5);
    expect(clicks.map((c) => c.time)).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
    expect(clicks.map((c) => c.accent)).toEqual([true, false, false, false, true, false]);
  });

  it("includes beats before the first downbeat, as a pickup", () => {
    const clicks = metronomeClicks(grid({ first_downbeat: 1.2 }), 2.2);
    expect(clicks[0].time).toBeCloseTo(0.2);
    expect(clicks.find((c) => c.accent)?.time).toBeCloseTo(1.2);
    expect(clicks.every((c) => c.time >= 0)).toBe(true);
  });

  it("follows tracked beats on an unsteady grid", () => {
    const beats = [0.1, 0.6, 1.2, 1.9, 2.4];
    const clicks = metronomeClicks(
      grid({ steady: false, beats, first_downbeat: 0.6, beats_per_bar: 3 }),
      10,
    );
    expect(clicks.map((c) => c.time)).toEqual(beats);
    expect(clicks.map((c) => c.accent)).toEqual([false, true, false, false, true]);
  });

  it("stops at the end", () => {
    const beats = [0, 1, 2, 3];
    expect(metronomeClicks(grid({ steady: false, beats }), 1.5).length).toBe(2);
  });

  it("has no accents when the meter is unknown", () => {
    const clicks = metronomeClicks(grid({ beats_per_bar: null }), 2);
    expect(clicks.some((c) => c.accent)).toBe(false);
    expect(clicks.length).toBe(5);
  });
});
