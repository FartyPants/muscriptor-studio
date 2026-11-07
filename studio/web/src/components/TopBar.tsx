import type { SaveState } from "../editor/autosave";
import { Button } from "./Button";
import { IconDownload } from "./icons";

const SAVE_TEXT: Record<SaveState, string> = {
  saved: "Saved",
  pending: "Saving",
  saving: "Saving",
  failed: "Save failed. Retrying.",
};

export function TopBar(props: {
  title: string;
  model: string | null;
  exporting: boolean;
  saveState: SaveState | null;
  onExport: (() => void) | null;
}) {
  const { title, model, exporting, saveState, onExport } = props;
  return (
    <header className="flex items-center gap-3 px-4 py-3">
      <a href="#/new" aria-label="Back" className="text-lg text-muted hover:text-content">
        ←
      </a>
      <h1 className="min-w-0 truncate text-base font-medium text-content">{title}</h1>
      {model && <span className="shrink-0 text-xs text-muted">{model} model</span>}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {saveState && (
          <span role="status" aria-label="Save status" className={saveState === "failed" ? "text-xs text-red" : "text-xs text-muted"}>
            {SAVE_TEXT[saveState]}
          </span>
        )}
        <a href="#/new" className="rounded-lg border border-line-strong px-3 py-1.5 text-[13px] text-content hover:bg-surface-2">
          + New transcription
        </a>
        <Button
          kind="ghost"
          disabled={!onExport || exporting}
          onClick={onExport ?? undefined}
          className="flex items-center gap-1.5 rounded-lg bg-white !px-3 !py-1.5 text-[13px] font-medium !text-black disabled:opacity-50"
        >
          <IconDownload />
          {exporting ? "Exporting" : "Export"}
        </Button>
      </div>
    </header>
  );
}
