import type { BeatGrid } from "../pianoroll";

/** Steps per beat when the grid doesn't say: sixteenths. */
const DEFAULT_SUBDIVISION = 4;

const stepsPerBeat = (grid: BeatGrid, subdivision?: number | null) =>
  subdivision ?? grid.beat_subdivision ?? DEFAULT_SUBDIVISION;

/** Beat lines around `t` on an unsteady grid, continued past the ends. */
function beatSpan(beats: number[], t: number): [number, number] {
  const n = beats.length;
  if (t < beats[0]) {
    const size = beats[1] - beats[0];
    const k = Math.ceil((beats[0] - t) / size);
    return [beats[0] - k * size, beats[0] - (k - 1) * size];
  }
  if (t >= beats[n - 1]) {
    const size = beats[n - 1] - beats[n - 2];
    const k = Math.floor((t - beats[n - 1]) / size);
    return [beats[n - 1] + k * size, beats[n - 1] + (k + 1) * size];
  }
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] <= t) lo = mid;
    else hi = mid;
  }
  return [beats[lo], beats[hi]];
}

const usesBeats = (grid: BeatGrid) => grid.steady === false && !!grid.beats && grid.beats.length >= 2;

/** `t` moved to the nearest grid step. Without a grid, `t` is returned as it is. */
export function snapTime(t: number, grid: BeatGrid | null, subdivision?: number | null): number {
  if (!grid) return t;
  const steps = stepsPerBeat(grid, subdivision);
  if (usesBeats(grid)) {
    const [from, to] = beatSpan(grid.beats!, t);
    const step = (to - from) / steps;
    return from + Math.round((t - from) / step) * step;
  }
  const step = 60 / grid.bpm / steps;
  return grid.first_downbeat + Math.round((t - grid.first_downbeat) / step) * step;
}

/** One grid step's length at `t`, in seconds. Without a grid, 0.1 s. */
export function gridStep(t: number, grid: BeatGrid | null, subdivision?: number | null): number {
  if (!grid) return 0.1;
  const steps = stepsPerBeat(grid, subdivision);
  if (usesBeats(grid)) {
    const [from, to] = beatSpan(grid.beats!, t);
    return (to - from) / steps;
  }
  return 60 / grid.bpm / steps;
}
