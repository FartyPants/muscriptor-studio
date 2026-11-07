import { describe, expect, it } from "vitest";
import type { ProjectDoc } from "../api";
import { metronomeClicks } from "../metronome";
import type { BeatGrid } from "../pianoroll";
import { gridWithMeter } from "./useProject";

const grid: BeatGrid = {
  bpm: 120,
  beats_per_bar: null,
  first_downbeat: 0,
  onset_delay: 0,
  beat_subdivision: 4,
  steady: true,
  beats: [0, 0.5, 1, 1.5, 2, 2.5],
};
const docWith = (meter: number | null) => ({ beat_grid: grid, meter }) as unknown as ProjectDoc;

describe("gridWithMeter", () => {
  it("follows detection until a meter is chosen", () => {
    expect(gridWithMeter(docWith(null))).toBe(grid);
    expect(gridWithMeter(docWith(3))?.beats_per_bar).toBe(3);
    expect(gridWithMeter(null)).toBeNull();
  });

  it("moves the metronome's accents without touching the project's grid", () => {
    const accents = (meter: number) =>
      metronomeClicks(gridWithMeter(docWith(meter)), 3)
        .filter((click) => click.accent)
        .map((click) => click.time);
    expect(accents(3)).toEqual([0, 1.5, 3]);
    expect(accents(2)).toEqual([0, 1, 2, 3]);
    expect(grid.beats_per_bar).toBeNull();
  });
});
