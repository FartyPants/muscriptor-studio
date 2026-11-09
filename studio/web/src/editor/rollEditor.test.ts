import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectNote } from "../api";
import type { AudioEngine } from "../audio";
import type { BeatGrid, PianoRoll } from "../pianoroll";
import { NoteStore } from "./noteStore";
import { RollEditor } from "./rollEditor";

vi.mock("../pianoroll", () => ({ PITCH_MIN: 21, PITCH_MAX: 108 }));

const DELAY = 0.02;
const grid: BeatGrid = {
  bpm: 120,
  beats_per_bar: 4,
  first_downbeat: 0,
  onset_delay: DELAY,
  beat_subdivision: 4,
  steady: true,
  beats: null,
};
const view = { keyWidth: 56, offsetSec: 0, pxPerSec: 100, pitchTop: 100, rowH: 10 };

/** Streamed times: a note shown at 1 s is stored at 1 + DELAY. */
const stored = (id: string, pitch: number, shownStart: number, shownEnd: number): ProjectNote => ({
  id,
  instrument: "violin",
  pitch,
  start: shownStart + DELAY,
  end: shownEnd + DELAY,
});

const X = (t: number) => view.keyWidth + t * view.pxPerSec;
const Y = (p: number) => (view.pitchTop - p) * view.rowH + view.rowH / 2;

function setup(notes: ProjectNote[], g: BeatGrid | null = grid) {
  const store = new NoteStore(notes);
  const roll = {
    view: () => view,
    headerHeight: 26,
    setEditState: vi.fn(),
    setOverrides: vi.fn(),
    setMarquee: vi.fn(),
    setSplitMarks: vi.fn(),
  };
  const audio = { audition: vi.fn(), seconds: 0 };
  const editor = new RollEditor(
    store,
    roll as unknown as PianoRoll,
    audio as unknown as AudioEngine,
    () => {},
  );
  store.subscribe(() => editor.rebuild());
  editor.setGrid(g);
  editor.setEnabled(true);
  editor.setActive("violin");
  return { store, roll, audio, editor };
}

function drag(editor: RollEditor, x0: number, y0: number, x1: number, y1: number, alt = false) {
  editor.down(x0, y0, false);
  editor.move(x1, y1, alt);
  editor.up();
}

const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
  ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, ...mods }) as KeyboardEvent;

describe("RollEditor", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", { randomUUID: () => "new-id" });
  });

  it("a snapped drag stores streamed time: the shown time on the grid, plus the delay", () => {
    const { store, editor } = setup([stored("a", 60, 1, 2)]);
    drag(editor, X(1.5), Y(60), X(2.03), Y(60));
    const note = store.get("a")!;
    expect(note.start - DELAY).toBeCloseTo(1.5);
    expect(note.end - DELAY).toBeCloseTo(2.5);
  });

  it("Alt ignores the grid", () => {
    const { store, editor } = setup([stored("a", 60, 1, 2)]);
    drag(editor, X(1.5), Y(60), X(1.57), Y(60), true);
    expect(store.get("a")!.start - DELAY).toBeCloseTo(1.07);
  });

  it("one drag is one undo step, back to the exact stored object", () => {
    const original = stored("a", 60, 1 / 3, 1.7);
    const { store, editor } = setup([original]);
    editor.setActive("violin");
    drag(editor, X(1), Y(60), X(1.4), Y(63));
    expect(store.get("a")!.pitch).toBe(63);
    store.undo();
    expect(store.get("a")).toEqual(original);
    expect(store.canUndo).toBe(false);
  });

  it("a drag previews without touching the store", () => {
    const original = stored("a", 60, 1, 2);
    const { store, roll, editor } = setup([original]);
    editor.down(X(1.5), Y(60), false);
    editor.move(X(2), Y(60), false);
    expect(store.get("a")).toBe(original);
    expect(roll.setOverrides).toHaveBeenCalled();
    editor.up();
    expect(roll.setOverrides).toHaveBeenLastCalledWith(null);
  });

  it("a click without movement changes nothing", () => {
    const { store, editor } = setup([stored("a", 60, 1, 2)]);
    drag(editor, X(1.5), Y(60), X(1.5) + 1, Y(60));
    expect(store.canUndo).toBe(false);
    expect(editor.status).toBe("1 selected C4 · MIDI 60");
  });

  it("resizes from the right edge, on the grid", () => {
    const { store, editor } = setup([stored("a", 60, 1, 2)]);
    drag(editor, X(2) - 2, Y(60), X(2.5), Y(60));
    expect(store.get("a")!.end - DELAY).toBeCloseTo(2.5);
    expect(store.get("a")!.start - DELAY).toBeCloseTo(1);
  });

  it("drum hits only move", () => {
    const drum = { ...stored("d", 42, 1, 2), instrument: "drums" };
    const { store, editor } = setup([drum]);
    editor.setActive("drums");
    drag(editor, X(2) - 2, Y(42), X(2.5), Y(42));
    expect(store.get("d")!.end - store.get("d")!.start).toBeCloseTo(1);
  });

  it("adds a note on the grid, stored in streamed time", () => {
    const { store, editor } = setup([]);
    editor.add(X(1.53), Y(72));
    const [note] = store.notes;
    expect(note.pitch).toBe(72);
    expect(note.start - DELAY).toBeCloseTo(1.5);
    expect(note.instrument).toBe("violin");
    expect(note.end).toBeGreaterThan(note.start);
  });

  it("does not add on top of a note", () => {
    const { store, editor } = setup([stored("a", 60, 1, 2)]);
    editor.add(X(1.5), Y(60));
    expect(store.notes.length).toBe(1);
  });

  it("nudges by a grid step and a semitone, as one step each", () => {
    const { store, editor } = setup([stored("a", 60, 1, 2)]);
    editor.down(X(1.5), Y(60), false);
    editor.up();
    editor.key(key("ArrowRight"));
    editor.key(key("ArrowUp"));
    expect(store.get("a")!.start - DELAY).toBeCloseTo(1.125);
    expect(store.get("a")!.pitch).toBe(61);
  });

  it("pastes at the playhead, in streamed time", () => {
    const { store, audio, editor } = setup([stored("a", 60, 1, 2)]);
    editor.down(X(1.5), Y(60), false);
    editor.up();
    audio.seconds = 4;
    editor.key(key("c", { ctrlKey: true }));
    editor.key(key("v", { ctrlKey: true }));
    const copy = store.get("new-id")!;
    expect(copy.start - DELAY).toBeCloseTo(4);
    expect(copy.end - DELAY).toBeCloseTo(5);
  });

  it("deletes the selection and undoes it", () => {
    const original = stored("a", 60, 1, 2);
    const { store, editor } = setup([original]);
    editor.down(X(1.5), Y(60), false);
    editor.up();
    editor.key(key("Delete"));
    expect(store.notes).toEqual([]);
    editor.key(key("z", { ctrlKey: true }));
    expect(store.get("a")).toEqual(original);
  });

  it("leaves the keys alone when nothing is selected", () => {
    const { editor } = setup([stored("a", 60, 1, 2)]);
    expect(editor.key(key("ArrowUp"))).toBe(false);
    expect(editor.key(key("Delete"))).toBe(false);
  });

  it("ignores undo during a drag, so the drag's patch stays true", () => {
    const { store, editor } = setup([stored("a", 60, 1, 2)]);
    drag(editor, X(1.5), Y(60), X(2), Y(60));
    editor.down(X(2), Y(60), false);
    editor.move(X(3), Y(60), false);
    editor.key(key("z", { ctrlKey: true }));
    editor.up();
    expect(store.get("a")!.start - DELAY).toBeCloseTo(2.5);
    store.undo();
    expect(store.get("a")!.start - DELAY).toBeCloseTo(1.5);
  });

  describe("scale lock", () => {
    const cMajor = [0, 2, 4, 5, 7, 9, 11];

    function locked(notes: ProjectNote[]) {
      const made = setup(notes);
      made.editor.setScale(cMajor);
      made.editor.scaleLock = true;
      return made;
    }

    it("drops a dragged note on an in-key pitch", () => {
      const { store, editor } = locked([stored("a", 60, 1, 2)]);
      drag(editor, X(1.5), Y(60), X(1.5), Y(61));
      expect(store.get("a")!.pitch).toBe(62);
    });

    it("steps up the scale with the arrow key", () => {
      const { store, editor } = locked([stored("a", 64, 1, 2)]);
      editor.down(X(1.5), Y(64), false);
      editor.up();
      editor.key(key("ArrowUp"));
      expect(store.get("a")!.pitch).toBe(65);
      editor.key(key("ArrowUp"));
      expect(store.get("a")!.pitch).toBe(67);
    });

    it("adds notes in key", () => {
      const { store, editor } = locked([]);
      editor.add(X(1), Y(61));
      expect(store.notes[0].pitch).toBe(62);
    });

    it("leaves an out-of-key note alone when it only moves in time", () => {
      const { store, editor } = locked([stored("a", 61, 1, 2)]);
      drag(editor, X(1.5), Y(61), X(2.5), Y(61));
      expect(store.get("a")!.pitch).toBe(61);
    });

    it("leaves untouched notes alone", () => {
      const { store, editor } = locked([stored("a", 61, 1, 2), stored("b", 62, 3, 4)]);
      drag(editor, X(3.5), Y(62), X(3.5), Y(64));
      expect(store.get("a")!.pitch).toBe(61);
    });

    it("does not apply to drums", () => {
      const drum = { ...stored("d", 61, 1, 2), instrument: "drums" };
      const { store, editor } = locked([drum]);
      editor.setActive("drums");
      drag(editor, X(1.5), Y(61), X(1.5), Y(63));
      expect(store.get("d")!.pitch).toBe(63);
    });

    it("is off until asked for", () => {
      const { store, editor } = setup([stored("a", 60, 1, 2)]);
      editor.setScale(cMajor);
      drag(editor, X(1.5), Y(60), X(1.5), Y(61));
      expect(store.get("a")!.pitch).toBe(61);
    });
  });

  it("nothing responds outside Edit mode", () => {
    const { editor } = setup([stored("a", 60, 1, 2)]);
    editor.setEnabled(false);
    expect(editor.claims(Y(60))).toBe(false);
    expect(editor.key(key("Delete"))).toBe(false);
  });

  it("the ruler stays with the playhead", () => {
    const { editor } = setup([]);
    expect(editor.claims(10)).toBe(false);
    expect(editor.claims(40)).toBe(true);
  });
});

describe("RollEditor splitting a track", () => {
  const TO = "violin#2";
  const song = () => [stored("a", 60, 1, 2), stored("b", 64, 3, 4), stored("c", 67, 5, 6)];

  function splitting(marked: string[] = ["b"]) {
    const parts = setup(song());
    parts.editor.startSplit(TO, new Set(marked), "#123456");
    return parts;
  }

  it("is only for a pitched track with notes to divide", () => {
    const { editor } = setup(song());
    expect(editor.canSplit).toBe(true);
    editor.setActive("drums");
    expect(editor.canSplit).toBe(false);
    expect(setup([stored("a", 60, 1, 2)]).editor.canSplit).toBe(false);
  });

  it("shows the marks in the new track's colour", () => {
    const { roll } = splitting();
    expect(roll.setSplitMarks).toHaveBeenLastCalledWith({ notes: new Set(["b"]), color: "#123456" });
  });

  it("a click flips a mark, plays the note and moves nothing", () => {
    const { store, audio, editor } = splitting();
    const before = store.notes;
    editor.down(X(1.5), Y(60), false);
    editor.up();
    expect(editor.markedCount).toBe(2);
    expect(audio.audition).toHaveBeenCalledWith("violin", 60);
    editor.down(X(1.5), Y(60), false);
    editor.up();
    expect(editor.markedCount).toBe(1);
    expect(store.notes).toBe(before);
  });

  it("a drag that starts on a note flips it and moves nothing", () => {
    const { store, editor } = splitting();
    const before = store.notes;
    drag(editor, X(1.5), Y(60), X(2.5), Y(70));
    expect(store.notes).toBe(before);
    expect(store.canUndo).toBe(false);
  });

  it("a box marks the notes inside, and Shift unmarks them", () => {
    const { editor } = splitting([]);
    drag(editor, X(0.5), Y(90), X(4.5), Y(50));
    expect(editor.markedCount).toBe(2);
    editor.down(X(2.5), Y(90), true);
    editor.move(X(4.5), Y(50), false);
    editor.up();
    expect(editor.markedCount).toBe(1);
  });

  it("a click on empty space keeps the marks", () => {
    const { editor } = splitting();
    editor.down(X(0.2), Y(90), false);
    editor.up();
    expect(editor.markedCount).toBe(1);
  });

  it("can finish only when both tracks would have notes", () => {
    expect(splitting([]).editor.canFinishSplit).toBe(false);
    const all = splitting(["a", "b", "c"]);
    expect(all.editor.canFinishSplit).toBe(false);
    expect(all.editor.finishSplit()).toBe(false);
    expect(all.store.get("a")!.instrument).toBe("violin");
    expect(splitting().editor.canFinishSplit).toBe(true);
  });

  it("Finish moves the marked notes as one undo step", () => {
    const { store, roll, editor } = splitting();
    expect(editor.finishSplit()).toBe(true);
    expect(store.get("b")!.instrument).toBe(TO);
    expect(store.get("a")!.instrument).toBe("violin");
    expect(editor.splitting).toBe(false);
    expect(roll.setSplitMarks).toHaveBeenLastCalledWith(null);
    store.undo();
    expect(store.get("b")!.instrument).toBe("violin");
    expect(store.canUndo).toBe(false);
  });

  it.each<[string, (editor: RollEditor) => void]>([
    ["Cancel", (e) => e.cancelSplit()],
    ["Escape", (e) => e.key(key("Escape"))],
    ["leaving Edit", (e) => e.setEnabled(false)],
    ["another track", (e) => e.setActive("cello")],
  ])("%s ends the split and changes nothing", (_, leave) => {
    const { store, roll, editor } = splitting();
    const before = store.notes;
    leave(editor);
    expect(editor.splitting).toBe(false);
    expect(store.notes).toBe(before);
    expect(roll.setSplitMarks).toHaveBeenLastCalledWith(null);
  });

  it("Escape ends the split during a box drag", () => {
    const { roll, editor } = splitting();
    editor.down(X(0.5), Y(90), false);
    editor.move(X(4.5), Y(50), false);
    expect(editor.key(key("Escape"))).toBe(true);
    expect(editor.splitting).toBe(false);
    expect(roll.setMarquee).toHaveBeenLastCalledWith(null);
  });

  it("leaves the notes to the split: no adding, undoing or pasting", () => {
    const { store, editor } = splitting();
    store.apply({ remove: [] });
    const before = store.notes;
    editor.add(X(8), Y(80));
    expect(editor.key(key("z", { ctrlKey: true }))).toBe(true);
    expect(editor.key(key("v", { ctrlKey: true }))).toBe(true);
    expect(store.notes).toBe(before);
  });

  it("leaves other keys alone, such as the arrows", () => {
    expect(splitting().editor.key(key("ArrowLeft"))).toBe(false);
  });
});
