import { beforeEach, describe, expect, it } from "vitest";
import { instrumentColor, PALETTE, resetInstrumentColors } from "./colors";

describe("instrumentColor", () => {
  beforeEach(() => resetInstrumentColors());

  it("gives the instruments in your screenshot five different colours", () => {
    const names = ["acoustic_guitar", "electric_bass", "drums", "voice", "tenor_sax"];
    expect(new Set(names.map(instrumentColor)).size).toBe(5);
  });

  it("uses the palette in order", () => {
    expect(["a", "b", "c"].map(instrumentColor)).toEqual(PALETTE.slice(0, 3));
  });

  it("keeps an instrument's colour", () => {
    const first = instrumentColor("violin");
    instrumentColor("drums");
    expect(instrumentColor("violin")).toBe(first);
  });

  it("starts again for a new project", () => {
    instrumentColor("violin");
    resetInstrumentColors();
    expect(instrumentColor("drums")).toBe(PALETTE[0]);
  });

  it("stays unique past the palette's end", () => {
    const names = Array.from({ length: 12 }, (_, i) => `instrument ${i}`);
    expect(new Set(names.map(instrumentColor)).size).toBe(12);
    expect(instrumentColor("instrument 8")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
