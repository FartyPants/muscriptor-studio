import type { ProjectNote } from "../api";
import type { AudioEngine } from "../audio";
import type { BeatGrid, PianoRoll, RollOverride } from "../pianoroll";
import { PITCH_MAX, PITCH_MIN } from "../pianoroll";
import {
  clickSelection,
  describeSelection,
  lockPitch,
  MIN_NOTE_SEC,
  moveNotes,
  pasteNotes,
  resizeNotes,
  updatePatch,
} from "./gestures";
import { hitTest, NoteIndex, notesInBox, pitchAtY, timeAtX, type NoteZone, type RollView } from "./hitTest";
import { canChangeInstrument } from "./changeInstrument";
import type { NoteStore, Patch } from "./noteStore";
import { splitPatch } from "./splitTrack";
import { gridStep, snapTime } from "./snap";

/** Mouse travel before a press counts as a drag. */
const DRAG_PX = 3;

type Drag =
  | {
      kind: "note";
      zone: NoteZone;
      grabbed: ProjectNote;
      group: ProjectNote[];
      x: number;
      y: number;
      /** Plain click on a group member: on release without a drag, select just it. */
      narrowTo: string | null;
      started: boolean;
      pitchShift: number;
      after: ProjectNote[];
    }
  | { kind: "box"; x: number; y: number; base: Set<string>; started: boolean; unmark: boolean };

/** Notes of the active track being marked to move to the new track `to`. */
type Split = { to: string; marked: Set<string>; color: string };

const LIMITS = { low: PITCH_MIN, high: PITCH_MAX };

/**
 * Turns mouse and keyboard input on the roll into `NoteStore` patches. A drag
 * shows as a preview, and becomes one patch on release, so it is one undo step.
 */
export class RollEditor {
  enabled = false;
  snap = true;
  scaleLock = false;
  active: string | null = null;
  private scale: ReadonlySet<number> | null = null;
  grid: BeatGrid | null = null;
  private selected = new Set<string>();
  private clipboard: ProjectNote[] = [];
  private drag: Drag | null = null;
  private split: Split | null = null;
  private index = new NoteIndex([]);
  private delay = 0;

  constructor(
    private store: NoteStore,
    private roll: PianoRoll,
    private audio: AudioEngine,
    private onChange: () => void,
  ) {
    this.rebuild();
  }

  setScale(pitchClasses: number[] | null) {
    this.scale = pitchClasses && new Set(pitchClasses);
  }

  /** Scale lock applies to pitched notes, once the key is known. */
  private lockedScale(instrument: string | null): ReadonlySet<number> | null {
    return this.scaleLock && instrument !== "drums" ? this.scale : null;
  }

  setGrid(grid: BeatGrid | null) {
    this.grid = grid;
    this.delay = grid?.onset_delay ?? 0;
    this.rebuild();
  }

  /** Keep the hit-test index and selection in step with the store. */
  rebuild() {
    const delay = this.delay;
    this.index = new NoteIndex(
      this.store.notes.map((n) => ({ ...n, start: n.start - delay, end: n.end - delay })),
    );
    for (const id of this.selected) {
      if (!this.store.get(id)) this.selected.delete(id);
    }
    this.pushState();
  }

  get status(): string {
    return describeSelection(this.selectedNotes());
  }

  get hasSelection(): boolean {
    return this.selected.size > 0;
  }

  setEnabled(on: boolean) {
    if (!on) this.cancelSplit();
    this.enabled = on;
    if (!on) this.selected = new Set();
    this.pushState();
  }

  setActive(instrument: string | null) {
    this.cancelSplit();
    this.active = instrument;
    this.selected = new Set();
    this.pushState();
  }

  // ---- splitting a track ----------------------------------------------------

  private trackSize(): number {
    return this.store.notes.filter((n) => n.instrument === this.active).length;
  }

  get canSplit(): boolean {
    return this.active !== null && canChangeInstrument(this.active) && this.trackSize() >= 2;
  }

  get splitting(): boolean {
    return this.split !== null;
  }

  get splitTarget(): string | null {
    return this.split?.to ?? null;
  }

  get markedCount(): number {
    return this.split?.marked.size ?? 0;
  }

  /** Each of the two tracks must end up with notes. */
  get canFinishSplit(): boolean {
    return this.markedCount > 0 && this.markedCount < this.trackSize();
  }

  /** Start marking notes of the active track for the new track `to`, drawn in `color`. */
  startSplit(to: string, marked: Set<string>, color: string) {
    if (!this.canSplit) return;
    this.selected = new Set();
    this.split = { to, marked: new Set(marked), color };
    this.showMarks();
    this.pushState();
  }

  private showMarks() {
    this.roll.setSplitMarks(this.split && { notes: this.split.marked, color: this.split.color });
  }

  private endSplit() {
    this.split = null;
    this.drag = null;
    this.roll.setMarquee(null);
    this.showMarks();
    this.pushState();
  }

  cancelSplit() {
    if (this.split) this.endSplit();
  }

  /** Move the marked notes to the new track, as one undo step. Returns whether it did. */
  finishSplit(effect?: Patch["effect"]): boolean {
    const split = this.split;
    if (!split || !this.canFinishSplit) return false;
    this.store.apply({ ...splitPatch(this.store.notes, split.marked, split.to), effect });
    this.endSplit();
    return true;
  }

  private splitDown(split: Split, x: number, y: number, shift: boolean) {
    const hit = hitTest(x, y, this.index, this.view(), this.active);
    if (!hit) {
      this.drag = { kind: "box", x, y, base: new Set(split.marked), started: false, unmark: shift };
      return;
    }
    if (!split.marked.delete(hit.noteId)) split.marked.add(hit.noteId);
    const clicked = this.store.get(hit.noteId);
    if (clicked) this.audio.audition(clicked.instrument, clicked.pitch);
    this.pushState();
  }

  private pushState() {
    this.roll.setEditState(this.enabled ? this.active : null, this.selected);
    this.onChange();
  }

  private selectedNotes(): ProjectNote[] {
    return [...this.selected].flatMap((id) => this.store.get(id) ?? []);
  }

  private view(): RollView {
    return this.roll.view();
  }

  private snapped(displayTime: number, bypass: boolean): number {
    return this.snap && !bypass ? snapTime(displayTime, this.grid) : displayTime;
  }

  // ---- mouse --------------------------------------------------------------

  /** Whether this press belongs to the editor rather than the playhead. */
  claims(y: number): boolean {
    return this.enabled && y >= this.roll.headerHeight;
  }

  cursorAt(x: number, y: number): string {
    if (!this.claims(y)) return "default";
    const hit = hitTest(x, y, this.index, this.view(), this.active);
    if (!hit) return "crosshair";
    if (this.split) return "pointer";
    return hit.zone === "body" || this.active === "drums" ? "move" : "ew-resize";
  }

  down(x: number, y: number, shift: boolean) {
    if (this.split) {
      this.splitDown(this.split, x, y, shift);
      return;
    }
    const hit = hitTest(x, y, this.index, this.view(), this.active);
    if (!hit) {
      const base = shift ? new Set(this.selected) : new Set<string>();
      this.drag = { kind: "box", x, y, base, started: false, unmark: false };
      if (!shift) {
        this.selected = new Set();
        this.pushState();
      }
      return;
    }
    const wasSelected = this.selected.has(hit.noteId);
    this.selected = clickSelection(this.selected, hit.noteId, shift);
    const grabbed = this.store.get(hit.noteId);
    if (!grabbed || !this.selected.has(hit.noteId)) {
      this.pushState();
      return;
    }
    const narrowTo = wasSelected && !shift && this.selected.size > 1 ? hit.noteId : null;
    this.drag = {
      kind: "note",
      // Drum hits have no meaningful length, so they only ever move.
      zone: grabbed.instrument === "drums" ? "body" : hit.zone,
      grabbed,
      group: this.selectedNotes(),
      x,
      y,
      narrowTo,
      started: false,
      pitchShift: 0,
      after: [],
    };
    this.audio.audition(grabbed.instrument, grabbed.pitch);
    this.pushState();
  }

  move(x: number, y: number, alt: boolean) {
    const drag = this.drag;
    if (!drag) return;
    if (!drag.started) {
      if (Math.hypot(x - drag.x, y - drag.y) < DRAG_PX) return;
      drag.started = true;
    }
    if (drag.kind === "box") this.moveBox(drag, x, y);
    else this.moveNotes(drag, x, y, alt);
  }

  private moveBox(drag: Extract<Drag, { kind: "box" }>, x: number, y: number) {
    const view = this.view();
    const times = [timeAtX(drag.x, view), timeAtX(x, view)];
    const pitches = [pitchAtY(drag.y, view), pitchAtY(y, view)];
    const inside = notesInBox(
      {
        fromTime: Math.min(...times),
        toTime: Math.max(...times),
        lowPitch: Math.min(...pitches),
        highPitch: Math.max(...pitches),
      },
      this.index,
      this.active,
    );
    if (this.split) {
      this.split.marked = new Set(drag.base);
      for (const id of inside) {
        if (drag.unmark) this.split.marked.delete(id);
        else this.split.marked.add(id);
      }
      this.showMarks();
    } else {
      this.selected = new Set([...drag.base, ...inside]);
    }
    this.roll.setMarquee({ x0: drag.x, y0: drag.y, x1: x, y1: y });
    this.pushState();
  }

  private moveNotes(drag: Extract<Drag, { kind: "note" }>, x: number, y: number, alt: boolean) {
    const view = this.view();
    const dt = (x - drag.x) / view.pxPerSec;
    const { grabbed, group, zone } = drag;
    const delay = this.delay;
    if (zone === "body") {
      const display = grabbed.start - delay;
      const shift = this.snapped(display + dt, alt) - display;
      const pitch = Math.round((drag.y - y) / view.rowH);
      drag.after = moveNotes(group, shift, pitch, LIMITS);
      const scale = this.lockedScale(grabbed.instrument);
      // A move in time alone leaves pitches as they are, in key or not.
      if (scale && pitch !== 0) {
        drag.after = drag.after.map((n) => ({ ...n, pitch: lockPitch(n.pitch, scale) }));
      }
      const heard = drag.after[group.indexOf(grabbed)].pitch - grabbed.pitch;
      if (heard !== drag.pitchShift) {
        drag.pitchShift = heard;
        this.audio.audition(grabbed.instrument, grabbed.pitch + heard);
      }
    } else {
      const edge = (zone === "left" ? grabbed.start : grabbed.end) - delay;
      drag.after = resizeNotes(group, zone, this.snapped(edge + dt, alt) - edge);
    }
    const overrides = new Map<string, RollOverride>();
    for (const n of drag.after) {
      overrides.set(n.id, { pitch: n.pitch, start: n.start - delay, end: n.end - delay });
    }
    this.roll.setOverrides(overrides);
  }

  up() {
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    this.roll.setMarquee(null);
    if (drag.kind === "note") {
      if (drag.started) {
        // Clear after applying: the store's change redraws from the new notes.
        this.store.apply(updatePatch(drag.group, drag.after));
        this.roll.setOverrides(null);
      } else if (drag.narrowTo) {
        this.selected = new Set([drag.narrowTo]);
      }
    }
    this.pushState();
  }

  /** Double-click on empty space: add a note to the active instrument. */
  add(x: number, y: number) {
    const instrument = this.active;
    if (!instrument || this.split || !this.claims(y)) return;
    const view = this.view();
    if (hitTest(x, y, this.index, view, instrument)) return;
    const clicked = pitchAtY(y, view);
    if (clicked < PITCH_MIN || clicked > PITCH_MAX) return;
    const scale = this.lockedScale(instrument);
    const pitch = scale ? lockPitch(clicked, scale) : clicked;
    const display = this.snapped(timeAtX(x, view), false);
    const start = Math.max(0, display + this.delay);
    const length = Math.max(gridStep(display, this.grid) * 2, MIN_NOTE_SEC);
    const note = { id: crypto.randomUUID(), instrument, pitch, start, end: start + length };
    this.store.apply({ add: [note] });
    this.selected = new Set([note.id]);
    this.audio.audition(instrument, pitch);
    this.rebuild();
  }

  // ---- keyboard and toolbar ----------------------------------------------

  deleteSelection() {
    const notes = this.selectedNotes();
    this.selected = new Set();
    this.store.apply({ remove: notes });
    this.pushState();
  }

  undo() {
    this.store.undo();
  }

  redo() {
    this.store.redo();
  }

  private nudge(steps: number, semitones: number) {
    const group = this.selectedNotes();
    if (group.length === 0) return;
    const display = group[0].start - this.delay;
    const dt = steps * gridStep(display, this.grid);
    let moved = moveNotes(group, dt, semitones, LIMITS);
    const scale = this.lockedScale(group[0].instrument);
    if (scale && semitones !== 0) {
      moved = moved.map((n) => ({ ...n, pitch: lockPitch(n.pitch, scale, semitones) }));
    }
    this.store.apply(updatePatch(group, moved));
  }

  private paste() {
    if (!this.active) return;
    const at = Math.max(0, this.audio.seconds + this.delay);
    const notes = pasteNotes(this.clipboard, at, this.active, () => crypto.randomUUID());
    if (notes.length === 0) return;
    this.store.apply({ add: notes });
    this.selected = new Set(notes.map((n) => n.id));
    this.rebuild();
  }

  /** Handle an edit shortcut. Returns whether it was one. */
  key(e: KeyboardEvent): boolean {
    if (!this.enabled) return false;
    if (this.split && e.key === "Escape") {
      this.cancelSplit();
      return true;
    }
    // A drag's patch is built from where it started, so nothing may change first.
    if (this.drag) return true;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (this.split) return ctrl && "zycv".includes(key);
    if (ctrl && key === "z") {
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (ctrl && key === "y") {
      this.redo();
    } else if (ctrl && key === "c") {
      this.clipboard = this.selectedNotes();
    } else if (ctrl && key === "v") {
      this.paste();
    } else if (ctrl) {
      return false;
    } else if (e.key === "Escape") {
      this.selected = new Set();
      this.pushState();
    } else if (!this.hasSelection) {
      return false;
    } else if (e.key === "Delete" || e.key === "Backspace") {
      this.deleteSelection();
    } else if (e.key === "ArrowLeft") {
      this.nudge(-1, 0);
    } else if (e.key === "ArrowRight") {
      this.nudge(1, 0);
    } else if (e.key === "ArrowUp") {
      this.nudge(0, 1);
    } else if (e.key === "ArrowDown") {
      this.nudge(0, -1);
    } else {
      return false;
    }
    return true;
  }
}
