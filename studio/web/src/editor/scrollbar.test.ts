import { describe, expect, it } from "vitest";
import { MIN_THUMB_PX, offsetAtThumb, thumbGeometry } from "./scrollbar";

describe("thumbGeometry", () => {
  it("sizes the thumb by the share of content in view", () => {
    expect(thumbGeometry({ offsetSec: 0, viewSec: 25, totalSec: 100 }, 400)).toEqual({
      left: 0,
      width: 100,
    });
  });

  it("reaches the track's end at the last offset", () => {
    expect(thumbGeometry({ offsetSec: 75, viewSec: 25, totalSec: 100 }, 400)).toEqual({
      left: 300,
      width: 100,
    });
  });

  it("is halfway at the middle offset", () => {
    expect(thumbGeometry({ offsetSec: 37.5, viewSec: 25, totalSec: 100 }, 400).left).toBe(150);
  });

  it("fills the track when everything is in view", () => {
    expect(thumbGeometry({ offsetSec: 0, viewSec: 200, totalSec: 100 }, 400)).toEqual({
      left: 0,
      width: 400,
    });
  });

  it("keeps a grabbable size on long projects", () => {
    expect(thumbGeometry({ offsetSec: 0, viewSec: 1, totalSec: 3600 }, 400).width).toBe(MIN_THUMB_PX);
  });

  it("keeps a small thumb inside the track at the end", () => {
    const { left, width } = thumbGeometry({ offsetSec: 3599, viewSec: 1, totalSec: 3600 }, 400);
    expect(left + width).toBeCloseTo(400);
  });

  it("stays inside the track if the offset is out of range", () => {
    expect(thumbGeometry({ offsetSec: 500, viewSec: 25, totalSec: 100 }, 400).left).toBe(300);
    expect(thumbGeometry({ offsetSec: -5, viewSec: 25, totalSec: 100 }, 400).left).toBe(0);
  });
});

describe("offsetAtThumb", () => {
  const state = { offsetSec: 0, viewSec: 25, totalSec: 100 };

  it("maps the thumb's travel to the scrollable range", () => {
    expect(offsetAtThumb(0, state, 400)).toBe(0);
    expect(offsetAtThumb(150, state, 400)).toBe(37.5);
    expect(offsetAtThumb(300, state, 400)).toBe(75);
  });

  it("clamps past either end", () => {
    expect(offsetAtThumb(-50, state, 400)).toBe(0);
    expect(offsetAtThumb(900, state, 400)).toBe(75);
  });

  it("round-trips with thumbGeometry, including a minimum-size thumb", () => {
    const long = { offsetSec: 1200, viewSec: 1, totalSec: 3600 };
    const { left } = thumbGeometry(long, 400);
    expect(offsetAtThumb(left, long, 400)).toBeCloseTo(1200);
  });

  it("is 0 when nothing can scroll", () => {
    expect(offsetAtThumb(100, { offsetSec: 0, viewSec: 200, totalSec: 100 }, 400)).toBe(0);
  });
});
