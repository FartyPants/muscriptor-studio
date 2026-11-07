export type SaveState = "saved" | "pending" | "saving" | "failed";

const QUIET_MS = 2000;
const RETRY_MS = 5000;

/**
 * Saves after edits stop. Only one save runs at a time, and a change arriving
 * during a save is saved after it. A failed save retries until one succeeds.
 */
export class Autosaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving = false;
  private dirty = false;
  private stopped = false;
  private _state: SaveState = "saved";

  constructor(
    private save: () => Promise<unknown>,
    private onState: (state: SaveState) => void,
  ) {}

  get state(): SaveState {
    return this._state;
  }

  get hasUnsaved(): boolean {
    return this._state !== "saved";
  }

  private set(state: SaveState) {
    this._state = state;
    this.onState(state);
  }

  private arm(ms: number) {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, ms);
  }

  /** Note a change. It is saved once `QUIET_MS` pass without another. */
  changed() {
    this.dirty = true;
    if (!this.saving) this.set("pending");
    this.arm(QUIET_MS);
  }

  /** Save now, if anything is waiting. */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.dirty) await this.run();
  }

  /** Stop retrying and timing. Call after a final `flush`. */
  dispose() {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private async run() {
    if (this.saving || !this.dirty) return;
    this.saving = true;
    this.dirty = false;
    this.set("saving");
    try {
      await this.save();
      this.saving = false;
      if (this.dirty) {
        this.set("pending");
        if (!this.stopped && this.timer === null) this.arm(QUIET_MS);
      } else {
        this.set("saved");
      }
    } catch {
      this.saving = false;
      this.dirty = true;
      this.set("failed");
      if (!this.stopped) this.arm(RETRY_MS);
    }
  }
}
