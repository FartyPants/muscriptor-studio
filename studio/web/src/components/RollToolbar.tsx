import clsx from "clsx";
import type { ReactNode } from "react";
import type { NoteStore } from "../editor/noteStore";
import type { RollEditor } from "../editor/rollEditor";
import type { PianoRoll } from "../pianoroll";

const BUTTON = "rounded-md border-none bg-transparent !px-2 !py-1 text-[13px] text-muted hover:text-content";

const ICON =
  "flex size-7 items-center justify-center rounded-md border-none bg-transparent !p-0 text-muted hover:text-content disabled:opacity-30";

export function EditControls(props: {
  editing: boolean;
  snap: boolean;
  snapAvailable: boolean;
  editor: RollEditor | null;
  store: NoteStore | null;
  onEditing: (on: boolean) => void;
  onSnap: (on: boolean) => void;
}) {
  const { editing, snap, snapAvailable, editor, store, onEditing, onSnap } = props;
  return (
    <>
      <button
        type="button"
        aria-pressed={editing}
        onClick={() => onEditing(!editing)}
        className={clsx(
          "rounded-lg border !px-3 !py-1 text-[13px]",
          editing ? "border-white bg-transparent text-content" : "border-transparent bg-transparent text-muted hover:text-content",
        )}
      >
        ✎ Edit
      </button>
      {editing && (
        <>
          <button type="button" aria-label="Undo" className={ICON} disabled={!store?.canUndo} onClick={() => editor?.undo()}>
            ↶
          </button>
          <button type="button" aria-label="Redo" className={ICON} disabled={!store?.canRedo} onClick={() => editor?.redo()}>
            ↷
          </button>
          <button
            type="button"
            aria-label="Delete selected notes"
            className={ICON}
            disabled={!editor?.hasSelection}
            onClick={() => editor?.deleteSelection()}
          >
            🗑
          </button>
          <button
            type="button"
            aria-pressed={snap}
            disabled={!snapAvailable}
            title={snapAvailable ? "Hold Alt while dragging to ignore snap" : "No beat grid"}
            onClick={() => onSnap(!snap)}
            className={clsx(
              "rounded-md border-none bg-transparent !px-2 !py-1 text-[13px] disabled:opacity-30",
              snap ? "text-content" : "text-muted",
            )}
          >
            Snap
          </button>
          <span role="status" className="ml-2 font-mono text-xs text-muted">
            {editor?.status}
          </span>
        </>
      )}
    </>
  );
}

export function RollToolbar(props: { roll: PianoRoll | null; children?: ReactNode }) {
  const { roll, children } = props;
  return (
    <div className="flex min-h-11 items-center gap-1 border-b border-t border-line px-3">
      {children}
      <div className="ml-auto flex items-center gap-1">
        <button type="button" className={BUTTON} onClick={() => roll?.resetZoom()}>
          Reset zoom
        </button>
        <button type="button" className={BUTTON} onClick={() => roll?.fitNotes()}>
          Fit notes
        </button>
        <button type="button" aria-label="Zoom out" className={BUTTON} onClick={() => roll?.zoomStep(0.8)}>
          −
        </button>
        <button type="button" aria-label="Zoom in" className={BUTTON} onClick={() => roll?.zoomStep(1.25)}>
          +
        </button>
      </div>
    </div>
  );
}
