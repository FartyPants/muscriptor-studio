import { describe, expect, it } from "vitest";
import { DIAGRAM, diagramSize, diagramSvg } from "./chordDiagram";

const svg = (markup: string) => {
  const count = (re: RegExp) => (markup.match(re) ?? []).length;
  return {
    lines: count(/<line /g),
    muted: count(/diagram-muted/g),
    open: count(/diagram-open/g),
    dots: [...markup.matchAll(/diagram-dot" cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]),
    firstFret: markup.match(/diagram-first-fret">(\d+)</)?.[1] ?? null,
    nut: markup.includes('stroke-width="2.5"'),
  };
};

describe("diagramSvg", () => {
  it("draws C on guitar: strings, frets, a nut, marks and dots", () => {
    // x32010, given from string 1 down.
    const out = svg(diagramSvg({ frets: [0, 1, 0, 2, 3, null], first_fret: 1 }, 0, 0, 10, "#fff"));
    expect(out.lines).toBe(6 + 5);
    expect(out.nut).toBe(true);
    expect(out.muted).toBe(1);
    expect(out.open).toBe(2);
    const top = DIAGRAM.marks * 10;
    const fy = DIAGRAM.fret * 10;
    // Left to right: A string fret 3, D fret 2, B fret 1.
    expect(out.dots).toEqual([
      [8, top + 2.5 * fy],
      [16, top + 1.5 * fy],
      [32, top + 0.5 * fy],
    ]);
    expect(out.firstFret).toBeNull();
  });

  it("numbers a shape higher up the neck, with no nut", () => {
    const out = svg(diagramSvg({ frets: [5, 5, 6, 7, 7, 5], first_fret: 5 }, 0, 0, 10, "#fff"));
    expect(out.firstFret).toBe("5");
    expect(out.nut).toBe(false);
    expect(out.dots).toHaveLength(6);
  });

  it("draws four strings for a ukulele", () => {
    expect(svg(diagramSvg({ frets: [3, 0, 0, 0], first_fret: 1 }, 0, 0, 10, "#fff")).lines).toBe(4 + 5);
    expect(diagramSize(4).width).toBeCloseTo(3 * DIAGRAM.string);
  });
});
