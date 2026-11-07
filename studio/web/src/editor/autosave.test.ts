import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Autosaver, type SaveState } from "./autosave";

function setup(save: () => Promise<unknown> = () => Promise.resolve()) {
  const states: SaveState[] = [];
  const spy = vi.fn(save);
  return { saver: new Autosaver(spy, (s) => states.push(s)), spy, states };
}

describe("Autosaver", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it("saves 2 seconds after the last change, once", async () => {
    const { saver, spy, states } = setup();
    saver.changed();
    await vi.advanceTimersByTimeAsync(1500);
    saver.changed();
    await vi.advanceTimersByTimeAsync(1500);
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toBe("saved");
    expect(saver.hasUnsaved).toBe(false);
  });

  it("reports unsaved work until the save lands", async () => {
    let finish = () => {};
    const { saver, states } = setup(() => new Promise<void>((r) => (finish = r)));
    saver.changed();
    expect(saver.hasUnsaved).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(saver.state).toBe("saving");
    expect(saver.hasUnsaved).toBe(true);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual(["pending", "saving", "saved"]);
  });

  it("never overlaps saves, and saves a change made during one", async () => {
    let finish = () => {};
    let running = 0;
    let most = 0;
    const { saver, spy } = setup(async () => {
      most = Math.max(most, ++running);
      await new Promise<void>((r) => (finish = r));
      running--;
    });
    saver.changed();
    await vi.advanceTimersByTimeAsync(2000);
    saver.changed();
    await vi.advanceTimersByTimeAsync(5000);
    expect(spy).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(2000);
    expect(spy).toHaveBeenCalledTimes(2);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(most).toBe(1);
    expect(saver.state).toBe("saved");
  });

  it("retries a failed save until it works", async () => {
    let failures = 2;
    const { saver, spy, states } = setup(async () => {
      if (failures-- > 0) throw new Error("offline");
    });
    saver.changed();
    await vi.advanceTimersByTimeAsync(2000);
    expect(saver.state).toBe("failed");
    expect(saver.hasUnsaved).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(saver.state).toBe("failed");
    await vi.advanceTimersByTimeAsync(5000);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(states.at(-1)).toBe("saved");
  });

  it("flush saves at once, and does nothing when clean", async () => {
    const { saver, spy } = setup();
    await saver.flush();
    expect(spy).not.toHaveBeenCalled();
    saver.changed();
    await saver.flush();
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("stops after dispose", async () => {
    const { saver, spy } = setup(async () => {
      throw new Error("offline");
    });
    saver.changed();
    saver.dispose();
    await vi.advanceTimersByTimeAsync(20000);
    expect(spy).not.toHaveBeenCalled();
  });
});
