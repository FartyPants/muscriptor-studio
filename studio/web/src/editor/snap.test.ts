import { describe, expect, it } from "vitest";
import type { BeatGrid } from "../pianoroll";
import { gridStep, snapTime } from "./snap";

const steady: BeatGrid = {
  bpm: 120,
  beats_per_bar: 4,
  first_downbeat: 0.1,
  onset_delay: 0,
  beat_subdivision: 4,
};

const unsteady: BeatGrid = {
  ...steady,
  steady: false,
  beats: [0, 1, 3, 4],
  beat_subdivision: 2,
};

describe("snapTime", () => {
  it("leaves time alone without a grid", () => {
    expect(snapTime(1.234, null)).toBe(1.234);
  });

  it("snaps to subdivisions from the first downbeat", () => {
    expect(snapTime(0.11, steady)).toBeCloseTo(0.1);
    expect(snapTime(0.24, steady)).toBeCloseTo(0.225);
    expect(snapTime(0.3, steady)).toBeCloseTo(0.35);
  });

  it("works before the first downbeat", () => {
    expect(snapTime(0.0, steady)).toBeCloseTo(-0.025);
  });

  it("uses a given subdivision over the grid's", () => {
    expect(snapTime(0.3, steady, 1)).toBeCloseTo(0.1);
    expect(snapTime(0.5, steady, 1)).toBeCloseTo(0.6);
  });

  it("falls back to sixteenths", () => {
    expect(gridStep(0, { ...steady, beat_subdivision: null })).toBeCloseTo(0.125);
  });

  it("snaps within the tracked beat on an unsteady grid", () => {
    expect(snapTime(1.9, unsteady)).toBeCloseTo(2);
    expect(snapTime(2.6, unsteady)).toBeCloseTo(3);
    expect(snapTime(0.4, unsteady)).toBeCloseTo(0.5);
  });

  it("continues past the tracked beats", () => {
    expect(snapTime(4.4, unsteady)).toBeCloseTo(4.5);
    expect(snapTime(-0.4, unsteady)).toBeCloseTo(-0.5);
  });

  it("returns a value on the grid when run twice", () => {
    const once = snapTime(0.73, steady);
    expect(snapTime(once, steady)).toBeCloseTo(once);
  });
});

describe("gridStep", () => {
  it("is 0.1 s without a grid", () => {
    expect(gridStep(5, null)).toBe(0.1);
  });

  it("follows the local beat on an unsteady grid", () => {
    expect(gridStep(0.5, unsteady)).toBeCloseTo(0.5);
    expect(gridStep(2, unsteady)).toBeCloseTo(1);
  });
});
