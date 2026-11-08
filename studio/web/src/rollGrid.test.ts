import { describe, expect, it } from "vitest";
import { barSpan, musicalGrid, secondsGrid, type BeatGrid } from "./pianoroll";

const grid = (over: Partial<BeatGrid> = {}): BeatGrid => ({
  bpm: 120,
  beats_per_bar: 4,
  first_downbeat: 0,
  onset_delay: 0,
  beat_subdivision: 4,
  ...over,
});

const times = (lines: { t: number; kind: string }[], kind: string) =>
  lines.filter((l) => l.kind === kind).map((l) => l.t);

describe("musicalGrid", () => {
  it("puts bar 1 on the first downbeat", () => {
    const { lines } = musicalGrid(grid({ first_downbeat: 1.5 }), 0, 8, 80);
    const bars = lines.filter((l) => l.kind === "bar");
    expect(bars.find((l) => l.label === "1")?.t).toBeCloseTo(1.5);
    expect(bars.find((l) => l.label === "2")?.t).toBeCloseTo(3.5);
  });

  it("gives a pickup a bar line but no number", () => {
    const { lines } = musicalGrid(grid({ first_downbeat: 2.5 }), 0, 4, 80);
    const pickup = lines.find((l) => l.kind === "bar" && Math.abs(l.t - 0.5) < 0.001);
    expect(pickup).toBeDefined();
    expect(pickup?.label).toBeUndefined();
  });

  it("follows the meter", () => {
    const { lines } = musicalGrid(grid({ beats_per_bar: 3 }), 0, 4, 80);
    const bars = times(lines, "bar");
    expect(bars[0]).toBeCloseTo(0);
    expect(bars[1]).toBeCloseTo(1.5);
    expect(bars[2]).toBeCloseTo(3);
  });

  it("assumes bars of four when the meter is unknown", () => {
    const { lines } = musicalGrid(grid({ beats_per_bar: null }), 0, 5, 80);
    expect(times(lines, "bar")[1]).toBeCloseTo(2);
  });

  it("draws beats between bars, not on them", () => {
    const { lines } = musicalGrid(grid(), 0, 2, 80);
    const beats = times(lines, "beat");
    expect(beats).toHaveLength(3);
    expect(beats[0]).toBeCloseTo(0.5);
  });

  it("follows tracked beats when the tempo moves", () => {
    const beats = [0, 0.6, 1.1, 1.8, 2.5, 3.0, 3.7, 4.3, 5.0];
    const { lines } = musicalGrid(grid({ steady: false, beats }), 0, 5, 80);
    const bars = times(lines, "bar");
    expect(bars[0]).toBeCloseTo(0);
    expect(bars[1]).toBeCloseTo(2.5);
    expect(times(lines, "beat")[0]).toBeCloseTo(0.6);
  });

  it("shows subdivisions only when zoomed in", () => {
    expect(times(musicalGrid(grid(), 0, 1, 80).lines, "step")).toHaveLength(0);
    const close = times(musicalGrid(grid(), 0, 0.5, 400).lines, "step");
    expect(close).toHaveLength(3);
    expect(close[0]).toBeCloseTo(0.125);
  });

  it("uses the measured subdivision", () => {
    const steps = times(musicalGrid(grid({ beat_subdivision: 3 }), 0, 0.5, 400).lines, "step");
    expect(steps).toHaveLength(2);
    expect(steps[0]).toBeCloseTo(1 / 6);
  });

  it("thins out labels when zoomed out, keeping bar 1", () => {
    const labels = musicalGrid(grid(), 0, 32, 10)
      .lines.filter((l) => l.label)
      .map((l) => l.label);
    expect(labels.slice(0, 3)).toEqual(["1", "5", "9"]);
  });

  it("hides beats when they would crowd", () => {
    expect(times(musicalGrid(grid(), 0, 8, 10).lines, "beat")).toHaveLength(0);
  });

  it("shades every other bar", () => {
    const { strips } = musicalGrid(grid(), 0, 8, 80);
    expect(strips[0].from).toBeCloseTo(2);
    expect(strips[0].to).toBeCloseTo(4);
    expect(strips[1].from).toBeCloseTo(6);
  });

  it("only draws inside the span", () => {
    const { lines } = musicalGrid(grid(), 10, 12, 80);
    expect(lines.every((l) => l.t >= 10 && l.t <= 12)).toBe(true);
    expect(lines.filter((l) => l.kind === "bar").map((l) => l.label)).toEqual(["6", "7"]);
  });
});

describe("secondsGrid", () => {
  it("labels whole seconds", () => {
    const { lines } = secondsGrid(0, 3, 80);
    expect(lines.map((l) => l.label)).toEqual(["0:00", "0:01", "0:02", "0:03"]);
  });

  it("spaces labels when zoomed out", () => {
    const { lines } = secondsGrid(60, 120, 10);
    expect(lines[0].label).toBe("1:00");
    expect(lines[1].t).toBe(70);
  });

  it("has no bar shading", () => {
    expect(secondsGrid(0, 10, 80).strips).toEqual([]);
  });
});

describe("barSpan", () => {
  // 120 BPM in 4/4 from 1 s: bars of 2 s, starting at 1, 3, 5, 7.
  const steady = grid({ first_downbeat: 1 });

  it("takes the nearest bar lines", () => {
    expect(barSpan(steady, 3.3, 6.8)).toEqual({ start: 3, end: 7 });
  });

  it("doesn't care which way the drag went", () => {
    expect(barSpan(steady, 6.8, 3.3)).toEqual({ start: 3, end: 7 });
  });

  it("gives a drag inside one bar that bar", () => {
    expect(barSpan(steady, 3.2, 3.5)).toEqual({ start: 3, end: 5 });
  });

  it("gives a short drag across a bar line the bar under its middle", () => {
    expect(barSpan(steady, 4.9, 5.2)).toEqual({ start: 5, end: 7 });
  });

  it("never starts before the audio", () => {
    expect(barSpan(steady, 0, 0.4).start).toBe(0);
  });

  it("follows the tracked beats on an unsteady grid", () => {
    const unsteady = grid({
      bpm: 100,
      first_downbeat: 1,
      beats_per_bar: 2,
      steady: false,
      beats: [1, 1.5, 2.2, 2.6, 3.4, 3.9],
    });
    expect(barSpan(unsteady, 2.1, 3.5)).toEqual({ start: 2.2, end: 3.4 });
  });
});
