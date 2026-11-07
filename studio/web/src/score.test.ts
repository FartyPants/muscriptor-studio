import { describe, expect, it } from "vitest";
import {
  measureAt,
  measureBoxes,
  positionAt,
  renamedParts,
  timeAt,
  type MeasureBox,
} from "./score";

const view = { measures: [0, 2, 4], end: 6 };
const boxes: MeasureBox[] = [
  { x: 100, width: 200, top: 0, bottom: 100 },
  { x: 300, width: 200, top: 0, bottom: 100 },
  // The next system.
  { x: 100, width: 400, top: 150, bottom: 250 },
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
    expect(box).toEqual({ x: 160, width: 240, top: 38, bottom: 252 });
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
