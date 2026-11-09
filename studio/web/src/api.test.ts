import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ProjectDoc } from "./api";

const doc = { id: "p", model: "medium" } as unknown as ProjectDoc;
const state = (active: "small" | "medium" | null, switching = false) => ({
  models: [],
  active,
  busy: switching,
  switching,
});

describe("ensureModel", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function stubbed(...states: ReturnType<typeof state>[]) {
    const models = vi.spyOn(api, "models");
    for (const s of states) models.mockResolvedValueOnce(s);
    const choose = vi.spyOn(api, "chooseModel").mockResolvedValue({ active: "medium" });
    return { models, choose };
  }

  it("does nothing when the model is already in memory", async () => {
    const { choose } = stubbed(state("medium"));
    const loading = vi.fn();
    await api.ensureModel(doc, loading);
    expect(loading).not.toHaveBeenCalled();
    expect(choose).not.toHaveBeenCalled();
  });

  it("loads the model when nothing is loading", async () => {
    const { choose } = stubbed(state(null));
    const loading = vi.fn();
    await api.ensureModel(doc, loading);
    expect(loading).toHaveBeenCalledOnce();
    expect(choose).toHaveBeenCalledWith("medium");
  });

  it("waits for a load in progress instead of starting a second one", async () => {
    const { choose } = stubbed(state(null, true), state(null, true), state("medium"));
    const loading = vi.fn();
    const done = api.ensureModel(doc, loading);
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(loading).toHaveBeenCalledOnce();
    expect(choose).not.toHaveBeenCalled();
  });

  it("loads its own model once a different load has finished", async () => {
    const { choose } = stubbed(state(null, true), state("small"));
    const done = api.ensureModel(doc);
    await vi.advanceTimersByTimeAsync(500);
    await done;
    expect(choose).toHaveBeenCalledWith("medium");
  });

  it("tries again when the load it waited for failed", async () => {
    const { choose } = stubbed(state(null, true), state(null));
    const done = api.ensureModel(doc);
    await vi.advanceTimersByTimeAsync(500);
    await done;
    expect(choose).toHaveBeenCalledWith("medium");
  });

  it("stops waiting when cancelled", async () => {
    const { models, choose } = stubbed(state(null, true));
    const controller = new AbortController();
    const done = expect(api.ensureModel(doc, undefined, controller.signal)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(500);
    await done;
    expect(models).toHaveBeenCalledOnce();
    expect(choose).not.toHaveBeenCalled();
  });
});
