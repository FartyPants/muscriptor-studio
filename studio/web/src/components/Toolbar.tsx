import { CircleHelp, Magnet, Maximize2, Minus, Music2, Pencil, Plus, Redo2, RotateCcw, SlidersHorizontal, Trash2, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import type { NoteStore } from "../editor/noteStore";
import type { RollEditor } from "../editor/rollEditor";
import type { GridDisplay, PianoRoll } from "../pianoroll";
import { Checkbox, IconButton, Popover, Toggle } from "./ui";

const DISPLAY: { key: keyof GridDisplay; label: string; hint: string }[] = [
  { key: "secondMarkers", label: "Time lines", hint: "Vertical lines along the timeline." },
  { key: "pitchLanes", label: "Pitch lanes", hint: "Shaded rows, so neighbouring pitches are easy to tell apart." },
  { key: "pitchLines", label: "Pitch lines", hint: "Thin horizontal lines between each pitch row." },
  { key: "keyboard", label: "Keyboard", hint: "Piano keys and note names on the left edge." },
  { key: "chords", label: "Chords", hint: "Detected chord names along the top." },
];

const SHORTCUTS: [string, string][] = [
  ["Click, Shift+click", "Select notes"],
  ["Drag empty space", "Select an area"],
  ["Drag a note", "Move it"],
  ["Drag a note's edge", "Change its length"],
  ["Double-click", "Add a note"],
  ["Delete", "Delete selected notes"],
  ["Arrow keys", "Move by a grid step or a semitone"],
  ["Ctrl+Z, Ctrl+Y", "Undo, redo"],
  ["Ctrl+C, Ctrl+V", "Copy, paste at the playhead"],
  ["Alt while dragging", "Ignore snap"],
  ["Space", "Play or pause"],
  ["Drag the time ruler", "Choose a range"],
];

export function EditControls(props: {
  editing: boolean;
  snap: boolean;
  snapAvailable: boolean;
  scaleLock: boolean;
  scaleAvailable: boolean;
  editor: RollEditor | null;
  store: NoteStore | null;
  onEditing: (on: boolean) => void;
  onSnap: (on: boolean) => void;
  onScaleLock: (on: boolean) => void;
}) {
  const { editing, snap, snapAvailable, scaleLock, scaleAvailable, editor, store } = props;
  const { onEditing, onSnap, onScaleLock } = props;
  return (
    <>
      <Toggle pressed={editing} onClick={() => onEditing(!editing)}>
        <Pencil size={14} />
        Edit notes
      </Toggle>
      {editing && (
        <>
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
          <IconButton label="Undo" disabled={!store?.canUndo} onClick={() => editor?.undo()}>
            <Undo2 size={15} />
          </IconButton>
          <IconButton label="Redo" disabled={!store?.canRedo} onClick={() => editor?.redo()}>
            <Redo2 size={15} />
          </IconButton>
          <IconButton
            label="Delete selected notes"
            disabled={!editor?.hasSelection}
            onClick={() => editor?.deleteSelection()}
          >
            <Trash2 size={15} />
          </IconButton>
          <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
          <Toggle
            title={snapAvailable ? "Moved notes land on the beat grid. Hold Alt while dragging to ignore it." : "Snap needs a beat grid"}
            pressed={snap && snapAvailable}
            disabled={!snapAvailable}
            onClick={() => onSnap(!snap)}
          >
            <Magnet size={15} />
            Snap
          </Toggle>
          <Toggle
            title={scaleAvailable ? "Moved and added notes land on the key's scale" : "This needs a key"}
            pressed={scaleLock && scaleAvailable}
            disabled={!scaleAvailable}
            onClick={() => onScaleLock(!scaleLock)}
          >
            <Music2 size={15} />
            Stay in key
          </Toggle>
          <span role="status" aria-label="Selection" className="tabular ml-2 text-xs text-muted">
            {editor?.status || "Click a note to select it. Double-click to add one."}
          </span>
        </>
      )}
    </>
  );
}

export function RollToolbar(props: {
  roll: PianoRoll | null;
  display: GridDisplay;
  onDisplay: (display: GridDisplay) => void;
  children?: ReactNode;
}) {
  const { roll, display, onDisplay, children } = props;
  return (
    <div className="flex h-11 shrink-0 items-center gap-0.5 border-b border-line px-2">
      {children}
      <div className="ml-auto flex items-center gap-0.5">
        <IconButton label="Fit all notes" onClick={() => roll?.fitNotes()}>
          <Maximize2 size={15} />
        </IconButton>
        <IconButton label="Reset zoom" onClick={() => roll?.resetZoom()}>
          <RotateCcw size={15} />
        </IconButton>
        <IconButton label="Zoom out" onClick={() => roll?.zoomStep(0.8)}>
          <Minus size={15} />
        </IconButton>
        <IconButton label="Zoom in" onClick={() => roll?.zoomStep(1.25)}>
          <Plus size={15} />
        </IconButton>
        <Popover
          align="right"
          className="w-72 p-4"
          trigger={(open, toggle) => (
            <IconButton label="Display options" pressed={open} onClick={toggle}>
              <SlidersHorizontal size={15} />
            </IconButton>
          )}
        >
          <div className="flex flex-col gap-3">
            {DISPLAY.map(({ key, label, hint }) => (
              <Checkbox
                key={key}
                label={label}
                hint={hint}
                checked={display[key]}
                onChange={(checked) => onDisplay({ ...display, [key]: checked })}
              />
            ))}
          </div>
        </Popover>
        <Popover
          align="right"
          className="w-80 p-4"
          trigger={(open, toggle) => (
            <IconButton label="Keyboard shortcuts" pressed={open} onClick={toggle}>
              <CircleHelp size={15} />
            </IconButton>
          )}
        >
          <h3 className="mb-2 text-sm font-semibold text-content">Shortcuts</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
            {SHORTCUTS.map(([keys, action]) => (
              <div key={keys} className="contents">
                <dt className="font-medium whitespace-nowrap text-content">{keys}</dt>
                <dd className="text-muted">{action}</dd>
              </div>
            ))}
          </dl>
        </Popover>
      </div>
    </div>
  );
}
