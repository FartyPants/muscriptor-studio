import { ArrowLeft, Check, ChevronDown, CloudOff, Download, LoaderCircle, Plus, RefreshCw, ScanLine } from "lucide-react";
import type { SaveState } from "../editor/autosave";
import { Button, Popover } from "./ui";

function SaveBadge({ state }: { state: SaveState }) {
  if (state === "failed") {
    return (
      <span role="status" aria-label="Save status" className="flex items-center gap-1 text-xs text-danger">
        <CloudOff size={13} />
        Save failed. Retrying.
      </span>
    );
  }
  const saving = state !== "saved";
  return (
    <span role="status" aria-label="Save status" className="flex items-center gap-1 text-xs text-muted">
      {saving ? <LoaderCircle size={13} className="animate-spin" /> : <Check size={13} />}
      {saving ? "Saving" : "Saved"}
    </span>
  );
}

export function TopBar(props: {
  title: string;
  model: string | null;
  saveState: SaveState | null;
  onExport: (() => void) | null;
  /** Null hides the menu, for a project with nothing transcribed yet. */
  onRetranscribe: ((scope: "all" | "range") => void) | null;
  hasRange: boolean;
}) {
  const { title, model, saveState, onExport, onRetranscribe, hasRange } = props;
  return (
    <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-3">
      <a
        href="#/"
        aria-label="Back to library"
        title="Back to library"
        className="flex size-8 items-center justify-center rounded-control text-muted hover:bg-raised hover:text-content"
      >
        <ArrowLeft size={17} />
      </a>
      <h1 className="min-w-0 truncate text-[15px] font-semibold text-content">{title}</h1>
      {model && <span className="shrink-0 text-xs text-muted first-letter:uppercase">{model} model</span>}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {saveState && <SaveBadge state={saveState} />}
        <a
          href="#/new"
          className="inline-flex h-8 items-center gap-1.5 rounded-control px-2.5 text-[13px] font-medium text-muted hover:bg-raised hover:text-content"
        >
          <Plus size={15} />
          New
        </a>
        {onRetranscribe && (
          <Popover
            align="right"
            className="w-64 p-1"
            trigger={(open, toggle) => (
              <Button aria-expanded={open} onClick={toggle}>
                <RefreshCw size={14} />
                Re-transcribe
                <ChevronDown size={14} className="text-muted" />
              </Button>
            )}
          >
            {(close) => (
              <>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    onRetranscribe("all");
                  }}
                  className="flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-left text-[13px] text-content hover:bg-raised"
                >
                  <RefreshCw size={14} className="text-muted" />
                  Entire audio
                </button>
                <button
                  type="button"
                  disabled={!hasRange}
                  onClick={() => {
                    close();
                    onRetranscribe("range");
                  }}
                  className="flex w-full items-start gap-2 rounded-control px-2.5 py-2 text-left text-[13px] text-content enabled:hover:bg-raised disabled:text-faint"
                >
                  <ScanLine size={14} className="mt-0.5 text-muted" />
                  <span>
                    Selected range
                    {!hasRange && (
                      <span className="block text-xs text-faint">Drag across the time ruler to choose one</span>
                    )}
                  </span>
                </button>
              </>
            )}
          </Popover>
        )}
        <Button variant="primary" disabled={!onExport} onClick={onExport ?? undefined}>
          <Download size={14} />
          Export
        </Button>
      </div>
    </header>
  );
}
