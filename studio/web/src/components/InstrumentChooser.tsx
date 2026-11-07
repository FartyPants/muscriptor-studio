import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type InstrumentSuggestion, type ProjectDoc } from "../api";
import { label } from "../instruments";
import { InstrumentPicker } from "./InstrumentPicker";
import { Button } from "./ui";

/**
 * Choosing what transcription should listen for. A list is a hard limit, so a
 * detection result stays easy to correct, and leaving the model free is one
 * click away. Detection takes a while, so it only runs on request.
 */
export function InstrumentChooser(props: {
  doc: ProjectDoc;
  onHints: (hints: string[]) => void;
  renderActions: (state: { selected: string[]; busy: boolean }) => ReactNode;
}) {
  const { doc, onHints, renderActions } = props;
  const [selected, setSelected] = useState<Set<string>>(() => new Set(doc.hints ?? []));
  const [heard, setHeard] = useState<InstrumentSuggestion[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [activity, setActivity] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const fill = useRef<HTMLDivElement>(null);
  const running = useRef<AbortController | null>(null);

  // Read when a scan ends: the list may have changed while it ran.
  const latest = useRef(selected);
  const change = (next: Set<string>) => {
    latest.current = next;
    setSelected(next);
    onHints([...next]);
  };

  async function detect() {
    const controller = new AbortController();
    running.current = controller;
    setDetecting(true);
    setActivity("Listening to the whole song");
    setHeard([]);
    setMessage(null);
    try {
      const names = await api.detectInstruments(doc, controller.signal, {
        onLoading: () => setActivity(`Loading the ${doc.model} model`),
        onHeard: (found) => {
          setHeard(found);
          setActivity("Listening for instruments");
        },
        onProgress: (done, total) => {
          setActivity("Listening for instruments");
          if (fill.current) fill.current.style.width = `${(done / total) * 100}%`;
        },
      });
      change(new Set([...latest.current, ...names]));
      if (names.length === 0) {
        setMessage("No instruments found. Add them yourself, or let the model decide.");
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        const why = e instanceof Error ? e.message : String(e);
        setMessage(`Detection stopped: ${why}. Add instruments yourself, or let the model decide.`);
      }
    } finally {
      running.current = null;
      setDetecting(false);
    }
  }

  useEffect(() => () => running.current?.abort(), []);

  const open = heard.filter((s) => !s.instruments.some((name) => selected.has(name)));

  return (
    <div>
      <InstrumentPicker selected={selected} onChange={change} />

      {detecting ? (
        <div className="mt-3 flex items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded bg-raised">
            <div ref={fill} className="h-full bg-accent transition-[width]" style={{ width: 0 }} />
          </div>
          <span className="text-xs text-muted">{activity}</span>
          <Button variant="quiet" onClick={() => running.current?.abort()}>
            Skip
          </Button>
        </div>
      ) : (
        <Button className="mt-3" onClick={detect}>
          <Sparkles size={14} />
          Detect instruments
        </Button>
      )}

      {open.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-[13px] font-medium text-content">Also heard</p>
          <div className="flex flex-col gap-1.5">
            {open.map((suggestion) => (
              <div key={suggestion.label} className="flex flex-wrap items-center gap-1.5">
                {suggestion.instruments.length > 1 && (
                  <span className="mr-1 text-[13px] text-muted">{suggestion.label}:</span>
                )}
                {suggestion.instruments.map((name) => (
                  <Button
                    key={name}
                    className="!h-7 capitalize"
                    onClick={() => change(new Set([...selected, name]))}
                  >
                    + {label(name)}
                  </Button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {message && (
        <p role="status" className="mt-3 text-[13px] text-muted">
          {message}
        </p>
      )}

      <div className="mt-5">{renderActions({ selected: [...selected], busy: detecting })}</div>
    </div>
  );
}
