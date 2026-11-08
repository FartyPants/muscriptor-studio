export type SaveState = "saved" | "pending" | "saving" | "failed" | "gone";

/** The project no longer exists on the server, so saving can never work. */
export class ProjectGoneError extends Error {
  constructor() {
    super("This project was deleted. Changes won't be saved.");
  }
}

const QUIET_MS = 2000;
const RETRY_MS = 5000;

/** Savers with work still to land, including ones whose screen has closed. */
const unsaved = new Set<Autosaver>();

/**
 * Saves after edits stop. Only one save runs at a time, and a change arriving
 * during a save is saved after it. A failed save retries until one succeeds,
 * even after `close`, so leaving a screen cannot lose its last edits.
 */
export class Autosaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private dirty = false;
  private _state: SaveState = "saved";

  constructor(
    private save: () => Promise<unknown>,
    private onState: (state: SaveState) => void,
  ) {}

  /** Whether any saver, on any screen, still has work to land. */
  static get anyUnsaved(): boolean {
    return unsaved.size > 0;
  }

  /** Try to save everything now. */
  static flushAll() {
    for (const saver of unsaved) void saver.flush();
  }

  get state(): SaveState {
    return this._state;
  }

  get hasUnsaved(): boolean {
    return this._state !== "saved" && this._state !== "gone";
  }

  private set(state: SaveState) {
    this._state = state;
    if (state === "saved" || state === "gone") unsaved.delete(this);
    else unsaved.add(this);
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
    if (this._state === "gone") return;
    this.dirty = true;
    if (!this.inFlight) this.set("pending");
    this.arm(QUIET_MS);
  }

  /** Save now, waiting out any save in progress. One failure ends the wait. */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inFlight) await this.inFlight;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.dirty) await this.run();
  }

  /** The screen is going away: stop reporting. Unsaved work keeps trying. */
  close() {
    this.onState = () => {};
    void this.flush();
  }

  private async run(): Promise<void> {
    if (this.inFlight || !this.dirty) return;
    this.dirty = false;
    this.set("saving");
    this.inFlight = this.attempt();
    await this.inFlight;
  }

  private async attempt() {
    try {
      await this.save();
      this.inFlight = null;
      if (this.dirty) {
        this.set("pending");
        if (this.timer === null) this.arm(QUIET_MS);
      } else {
        this.set("saved");
      }
    } catch (e) {
      this.inFlight = null;
      if (e instanceof ProjectGoneError) {
        this.dirty = false;
        this.set("gone");
        return;
      }
      this.dirty = true;
      this.set("failed");
      this.arm(RETRY_MS);
    }
  }
}
