import { describe, expect, it } from "vitest";
import type { ModelInfo, ModelSize } from "../api";
import { availableModel } from "./ModelPicker";

const models = (...have: ModelSize[]): ModelInfo[] =>
  (["large", "medium", "small"] as const).map((size) => ({
    size,
    available: have.includes(size),
    active: false,
  }));

describe("availableModel", () => {
  it("keeps the wanted model when it's installed", () => {
    expect(availableModel(models("small", "large"), "large")).toBe("large");
  });

  it("falls back when it isn't, Medium first", () => {
    expect(availableModel(models("small"), "medium")).toBe("small");
    expect(availableModel(models("large"), "medium")).toBe("large");
    expect(availableModel(models("medium", "small"), "large")).toBe("medium");
  });

  it("is null with nothing installed", () => {
    expect(availableModel(models(), "medium")).toBeNull();
  });
});
