import { useEffect, useRef, useState } from "react";
import { api, type ProjectDoc } from "../api";
import { Button } from "./Button";
import { ConditioningPanel } from "./ConditioningPanel";

/**
 * The step before transcribing: suggest instruments, let the user correct them.
 * A list is a hard limit on the transcription, so it must be easy to change, and
 * possible to leave the model free.
 */
export function InstrumentStep(props: {
  doc: ProjectDoc;
  /** Start detecting as soon as this appears. */
  autoDetect: boolean;
  onHints: (hints: string[]) => void;
  onStart: (hints: string[]) => void;
}) {
  const { doc, autoDetect, onHints, onStart } = props;
  const [selected, setSelected] = useState<Set<string>>(() => new Set(doc.hints ?? []));
  const [detecting, setDetecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fill = useRef<HTMLDivElement>(null);
  const running = useRef<AbortController | null>(null);

  async function detect() {
    const controller = new AbortController();
    running.current = controller;
    setDetecting(true);
    setMessage(null);
    if (fill.current) fill.current.style.width = "0";
    try {
      const names = await api.detectInstruments(doc, controller.signal, (done, total) => {
        if (fill.current) fill.current.style.width = `${(done / total) * 100}%`;
      });
      setSelected(new Set(names));
      onHints(names);
      if (names.length === 0) {
        setMessage("No instruments found. Add them yourself, or let the model decide.");
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        const why = e instanceof Error ? e.message : String(e);
        setMessage(`Could not analyze this audio: ${why}. Add instruments yourself, or let the model decide.`);
      }
    } finally {
      running.current = null;
      setDetecting(false);
    }
  }

  useEffect(() => {
    if (autoDetect) void detect();
    return () => running.current?.abort();
    // Runs once: `autoDetect` is read when the step opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = (next: Set<string>) => {
    setSelected(next);
    onHints([...next]);
  };

  return (
    <section aria-label="Choose instruments" className="mx-4 mb-3 rounded-card border border-line bg-surface p-4">
      {detecting && (
        <div className="mt-3 flex items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded bg-surface-2">
            <div ref={fill} className="h-full bg-white" style={{ width: 0 }} />
          </div>
          <span className="text-xs text-muted">Listening for instruments</span>
          <Button onClick={() => running.current?.abort()}>Skip</Button>
        </div>
      )}

      <ConditioningPanel selected={selected} onChange={change} />

      {message && (
        <p role="status" className="mt-3 text-sm text-muted">
          {message}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          kind="ghost"
          disabled={detecting || selected.size === 0}
          onClick={() => onStart([...selected])}
          className="rounded-lg bg-white !px-3 !py-1.5 text-[13px] font-medium !text-black disabled:opacity-40"
        >
          Transcribe {selected.size > 0 ? `with ${selected.size} instrument${selected.size === 1 ? "" : "s"}` : ""}
        </Button>
        <Button disabled={detecting} onClick={() => onStart([])}>
          Let the model decide
        </Button>
        {!detecting && <Button onClick={detect}>Detect instruments</Button>}
      </div>
    </section>
  );
}
