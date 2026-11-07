import type { ReactNode } from "react";
import type { PianoRoll } from "../pianoroll";

const BUTTON = "rounded-md border-none bg-transparent !px-2 !py-1 text-[13px] text-muted hover:text-content";

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
