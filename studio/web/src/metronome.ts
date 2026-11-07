import type { BeatGrid } from "./pianoroll";

export type Click = {
  /** Seconds on the transport. */
  time: number;
  /** First beat of a bar. */
  accent: boolean;
};

/**
 * Every metronome click from 0 to `until`. A steady grid is evenly spaced from
 * its first downbeat. An unsteady one uses the tracked beats, so the clicks
 * follow the performance.
 */
export function metronomeClicks(grid: BeatGrid | null, until: number): Click[] {
  if (!grid || grid.bpm <= 0 || until <= 0) return [];
  const perBar = grid.beats_per_bar;
  const isAccent = (beat: number) =>
    perBar !== null && ((beat % perBar) + perBar) % perBar === 0;

  if (grid.steady === false && grid.beats && grid.beats.length >= 2) {
    const beats = grid.beats;
    let downbeat = 0;
    beats.forEach((b, i) => {
      if (Math.abs(b - grid.first_downbeat) < Math.abs(beats[downbeat] - grid.first_downbeat)) {
        downbeat = i;
      }
    });
    return beats
      .map((time, i) => ({ time, accent: isAccent(i - downbeat) }))
      .filter((c) => c.time >= 0 && c.time <= until);
  }

  const period = 60 / grid.bpm;
  const first = Math.ceil(-grid.first_downbeat / period - 1e-9);
  const clicks: Click[] = [];
  for (let beat = first; ; beat++) {
    const time = grid.first_downbeat + beat * period;
    if (time > until) return clicks;
    clicks.push({ time, accent: isAccent(beat) });
  }
}
