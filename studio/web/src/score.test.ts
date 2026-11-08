import { describe, expect, it } from "vitest";
import type { ProjectDoc } from "./api";
import {
  isStaleBuild,
  measureAt,
  measureBoxes,
  positionAt,
  renamedParts,
  scoreRequest,
  timeAt,
  type MeasureBox,
} from "./score";

const view = { measures: [0, 2, 4], end: 6 };
const boxes: MeasureBox[] = [
  { x: 100, width: 200, lead: 0, top: 0, bottom: 100 },
  { x: 300, width: 200, lead: 0, top: 0, bottom: 100 },
  // The next system, behind its clef and signatures.
  { x: 100, width: 400, lead: 90, top: 150, bottom: 250 },
];

describe("measureAt", () => {
  it("finds the measure playing", () => {
    expect(measureAt(view, 0)).toBe(0);
    expect(measureAt(view, 1.99)).toBe(0);
    expect(measureAt(view, 2)).toBe(1);
    expect(measureAt(view, 5.9)).toBe(2);
  });

  it("is -1 before the first measure and from the end", () => {
    expect(measureAt(view, -0.1)).toBe(-1);
    expect(measureAt(view, 6)).toBe(-1);
    expect(measureAt({ measures: [], end: 0 }, 1)).toBe(-1);
  });
});

describe("positionAt", () => {
  it("moves through a measure in proportion to time", () => {
    expect(positionAt(view, boxes, 0)?.x).toBe(100);
    expect(positionAt(view, boxes, 1)?.x).toBe(200);
    expect(positionAt(view, boxes, 3)?.x).toBe(400);
  });

  it("jumps to the next system at its first measure", () => {
    expect(positionAt(view, boxes, 4)).toEqual({
      x: 100,
      top: 150,
      bottom: 250,
      measure: 2,
    });
  });

  it("is hidden outside the score", () => {
    expect(positionAt(view, boxes, -1)).toBeNull();
    expect(positionAt(view, boxes, 6)).toBeNull();
  });
});

describe("timeAt", () => {
  it("turns a click into the time it shows", () => {
    expect(timeAt(view, boxes, 200, 50)).toBe(1);
    expect(timeAt(view, boxes, 300, 200)).toBe(5);
  });

  it("takes a click on a clef as its measure's start", () => {
    expect(timeAt(view, boxes, 80, 200)).toBe(4);
    expect(timeAt(view, boxes, 12, 200)).toBe(4);
    expect(timeAt(view, boxes, 5, 200)).toBeNull();
  });

  it("ignores clicks between systems", () => {
    expect(timeAt(view, boxes, 200, 125)).toBeNull();
  });
});

describe("measureBoxes", () => {
  const measure = (x: number, y: number, width: number, begin = 0) => ({
    PositionAndShape: {
      AbsolutePosition: { x, y },
      Size: { width, height: 10 },
    },
    beginInstructionsWidth: begin,
    endInstructionsWidth: 0,
  });

  it("spans every staff and skips the clef and signatures", () => {
    const [box] = measureBoxes(
      [[measure(10, 5, 30, 6), undefined, measure(10, 20, 30, 6)]],
      1,
    );
    expect(box).toEqual({ x: 160, width: 240, lead: 60, top: 38, bottom: 252 });
  });

  it("scales with zoom", () => {
    const [box] = measureBoxes([[measure(10, 5, 30)]], 2);
    expect(box.x).toBe(200);
    expect(box.width).toBe(600);
  });
});

describe("renamedParts", () => {
  it("names parts after their instruments", () => {
    const xml =
      "<score-part id='P1'><part-name>Classical Guitar, acoustic guitar</part-name>" +
      "<part-abbreviation>Guit.</part-abbreviation></score-part>" +
      "<score-part id='P2'><part-name>Piano</part-name></score-part>";
    expect(renamedParts(xml)).toBe(
      "<score-part id='P1'><part-name>Acoustic guitar</part-name>" +
        "<part-abbreviation>Guit.</part-abbreviation></score-part>" +
        "<score-part id='P2'><part-name>Piano</part-name></score-part>",
    );
  });

  it("keeps the track when the sound's name has a comma", () => {
    expect(
      renamedParts("<part-name>Organ, Pipe, church organ</part-name>"),
    ).toBe("<part-name>Church organ</part-name>");
  });
});

describe("scoreRequest", () => {
  const grid = {
    bpm: 120,
    beats_per_bar: null,
    first_downbeat: 0,
    onset_delay: 0.1,
    beat_subdivision: 4,
    steady: false,
    beats: [0, 0.5],
  };
  const doc = (meter: number | null, detected: number | null) =>
    ({ beat_grid: { ...grid, beats_per_bar: detected }, meter }) as unknown as ProjectDoc;
  const note = { id: "a", instrument: "acoustic_piano", pitch: 60, start: 1, end: 2 };

  it("uses four beats a bar when none is detected or chosen", () => {
    expect(scoreRequest(doc(null, null), [note], null).options).toEqual({
      beats_per_bar: 4,
      quantize: true,
      fill_gaps: 0.25,
      trim_leading_bars: false,
    });
  });

  it("prefers the chosen meter to the detected one", () => {
    expect(scoreRequest(doc(null, 3), [note], null).options.beats_per_bar).toBe(3);
    expect(scoreRequest(doc(6, 3), [note], null).options.beats_per_bar).toBe(6);
  });

  it("sends stored times, the key in use and chords", () => {
    const body = scoreRequest(doc(null, 3), [note], { tonic: 2, mode: "minor" });
    expect(body.notes).toEqual([{ instrument: "acoustic_piano", pitch: 60, start: 1, end: 2 }]);
    expect(body.key).toEqual({ tonic: 2, mode: "minor" });
    expect(body.chords).toBe(true);
    expect(body.beat_grid?.onset_delay).toBe(0.1);
  });

  it("leaves the bars to MuseScore without a beat grid", () => {
    const none = { beat_grid: null, meter: null } as unknown as ProjectDoc;
    expect(scoreRequest(none, [note], null).options).toEqual({});
  });
});

describe("isStaleBuild", () => {
  it("knows each browser's words for a missing score file", () => {
    const url = "http://127.0.0.1:8222/studio/assets/opensheetmusicdisplay.min-BzzgDI8o.js";
    expect(isStaleBuild(new TypeError(`Failed to fetch dynamically imported module: ${url}`))).toBe(true);
    expect(isStaleBuild(new TypeError(`error loading dynamically imported module: ${url}`))).toBe(true);
    expect(isStaleBuild(new TypeError("Importing a module script failed."))).toBe(true);
  });

  it("leaves other failures to the error message", () => {
    expect(isStaleBuild(new Error("MuseScore is not installed"))).toBe(false);
    expect(isStaleBuild(new TypeError("Failed to fetch"))).toBe(false);
  });
});
