import { describe, expect, it } from "vitest";
import {
  details,
  formatLength,
  formatSize,
  isReady,
  matchesSearch,
  pageOf,
  sortByOpened,
  statusOf,
  timeAgo,
} from "./library";

describe("statusOf", () => {
  it("counts an interrupted transcription as ready to continue", () => {
    expect(statusOf({ status: "created" })).toBe("ready");
    expect(statusOf({ status: "transcribing" })).toBe("ready");
    expect(isReady({ status: "transcribing" })).toBe(true);
  });

  it("keeps finished and stopped apart", () => {
    expect(statusOf({ status: "completed" })).toBe("completed");
    expect(statusOf({ status: "partial" })).toBe("partial");
    expect(isReady({ status: "partial" })).toBe(false);
  });
});

describe("matchesSearch", () => {
  it("ignores case and accents, both ways", () => {
    expect(matchesSearch({ name: "09-Kočky" }, "kocky")).toBe(true);
    expect(matchesSearch({ name: "09-Kočky" }, "KOČ")).toBe(true);
    expect(matchesSearch({ name: "Kocky" }, "koč")).toBe(true);
  });

  it("matches everything for an empty search, and nothing for another name", () => {
    expect(matchesSearch({ name: "a" }, "  ")).toBe(true);
    expect(matchesSearch({ name: "outback" }, "rondo")).toBe(false);
  });
});

describe("sortByOpened", () => {
  const rows = [{ opened: 2 }, { opened: 3 }, { opened: 1 }];

  it("sorts both ways without changing its input", () => {
    expect(sortByOpened(rows, true).map((r) => r.opened)).toEqual([3, 2, 1]);
    expect(sortByOpened(rows, false).map((r) => r.opened)).toEqual([1, 2, 3]);
    expect(rows[0].opened).toBe(2);
  });
});

describe("pageOf", () => {
  const rows = [1, 2, 3, 4, 5];

  it("cuts out one page", () => {
    expect(pageOf(rows, 2, 2)).toEqual({ rows: [3, 4], page: 2, pages: 3 });
    expect(pageOf(rows, 3, 2).rows).toEqual([5]);
  });

  it("stays in range when rows go away", () => {
    expect(pageOf(rows, 9, 2)).toEqual({ rows: [5], page: 3, pages: 3 });
    expect(pageOf([], 4, 20)).toEqual({ rows: [], page: 1, pages: 1 });
  });
});

describe("timeAgo", () => {
  const now = 1_000_000;

  it.each([
    [30, "just now"],
    [180, "3 minutes ago"],
    [60, "1 minute ago"],
    [3600, "1 hour ago"],
    [7300, "2 hours ago"],
    [86400, "yesterday"],
    [5 * 86400, "5 days ago"],
  ])("%d seconds is %s", (past, text) => {
    expect(timeAgo(now - past, now)).toBe(text);
  });

  it("copes with a clock that went backwards", () => {
    expect(timeAgo(now + 50, now)).toBe("just now");
  });
});

describe("formatLength", () => {
  it("reads as minutes and seconds", () => {
    expect(formatLength(261)).toBe("4:21");
    expect(formatLength(9)).toBe("0:09");
  });

  it("adds hours when it needs them", () => {
    expect(formatLength(3725)).toBe("1:02:05");
  });
});

describe("formatSize", () => {
  it("reads in MiB, and KiB for small files", () => {
    expect(formatSize(5.04 * 1024 * 1024)).toBe("5.0 MiB");
    expect(formatSize(300 * 1024)).toBe("300 KiB");
  });
});

describe("details", () => {
  it("leaves no separator where something is missing", () => {
    expect(details([null, "5.0 MiB", false])).toBe("5.0 MiB");
    expect(details(["4:21", "5.0 MiB", "5 hints"])).toBe("4:21 · 5.0 MiB · 5 hints");
  });
});
