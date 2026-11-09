import { describe, expect, it } from "vitest";
import { baseInstrument, displayName, label, nextTrackName } from "./instruments";

describe("split track names", () => {
  it("reads as a numbered track of the same instrument", () => {
    expect(label("acoustic_guitar#2")).toBe("acoustic guitar 2");
    expect(displayName("acoustic_guitar#2")).toBe("Acoustic guitar 2");
    expect(baseInstrument("acoustic_guitar#2")).toBe("acoustic_guitar");
    expect(baseInstrument("acoustic_guitar")).toBe("acoustic_guitar");
  });

  it("takes the lowest free number", () => {
    expect(nextTrackName("violin", ["violin"])).toBe("violin#2");
    expect(nextTrackName("violin", ["violin", "violin#2"])).toBe("violin#3");
    expect(nextTrackName("violin#2", ["violin", "violin#2"])).toBe("violin#3");
    expect(nextTrackName("violin", ["violin", "violin#3"])).toBe("violin#2");
  });
});
