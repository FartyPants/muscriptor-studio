import { LoaderCircle } from "lucide-react";
import type { RefObject } from "react";
import { Button } from "./ui";

/** Progress for a running transcription, with the way to stop it. */
export function TranscribeBar(props: {
  stopping: boolean;
  onStop: () => void;
  fillRef: RefObject<HTMLDivElement | null>;
  labelRef: RefObject<HTMLSpanElement | null>;
}) {
  const { stopping, onStop, fillRef, labelRef } = props;
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-2">
      <LoaderCircle size={15} className="animate-spin text-accent" />
      <span className="text-[13px] text-content">{stopping ? "Finishing up" : "Transcribing"}</span>
      <div className="h-1 flex-1 overflow-hidden rounded bg-raised">
        <div ref={fillRef} className="h-full bg-accent" style={{ width: 0 }} />
      </div>
      <span ref={labelRef} className="tabular text-xs text-muted" />
      <Button disabled={stopping} onClick={onStop}>
        {stopping ? "Stopping…" : "Stop & keep notes"}
      </Button>
    </div>
  );
}
