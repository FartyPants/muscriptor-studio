import clsx from "clsx";
import { useMemo } from "react";
import type { ProjectNote } from "../api";
import { label } from "../instruments";
import { instrumentColor } from "../pianoroll";
import { IconSound, IconSoundOff } from "./icons";

const BINS = 80;
const W = 240;
const H = 26;

export type InstrumentRow = { name: string; count: number; points: string };

/** One row per instrument, most notes first, with its note density over time. */
export function instrumentRows(notes: ProjectNote[], names: string[]): InstrumentRow[] {
  const end = notes.reduce((max, n) => Math.max(max, n.end), 0.001);
  const bins = new Map<string, Float64Array>();
  const counts = new Map<string, number>(names.map((n) => [n, 0]));
  for (const n of notes) {
    counts.set(n.instrument, (counts.get(n.instrument) ?? 0) + 1);
    let row = bins.get(n.instrument);
    if (!row) bins.set(n.instrument, (row = new Float64Array(BINS)));
    row[Math.min(BINS - 1, Math.floor((n.start / end) * BINS))] += 1;
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => {
      const row = bins.get(name) ?? new Float64Array(BINS);
      const peak = Math.max(1, ...row);
      const line = Array.from(row, (v, i) => `${(i / (BINS - 1)) * W},${H - (v / peak) * (H - 2)}`);
      return { name, count, points: `0,${H} ${line.join(" ")} ${W},${H}` };
    });
}

export function InstrumentPanel(props: {
  notes: ProjectNote[];
  names: string[];
  muted: Set<string>;
  solo: Set<string>;
  /** Edit mode's instrument, or null outside Edit mode. */
  active: string | null;
  onActivate: (name: string) => void;
  onMute: (name: string) => void;
  onSolo: (name: string) => void;
  onHover: (name: string | null) => void;
}) {
  const { notes, names, muted, solo, active, onActivate, onMute, onSolo, onHover } = props;
  const rows = useMemo(() => instrumentRows(notes, names), [notes, names]);
  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-t border-line bg-surface p-3">
      <h2 className="mb-3 text-sm font-medium text-content">Instruments</h2>
      {rows.map(({ name, count, points }) => {
        const color = instrumentColor(name);
        const silent = solo.size > 0 ? !solo.has(name) : muted.has(name);
        return (
          <div
            key={name}
            className={clsx(
              "-mx-1 mb-2 rounded-lg p-1",
              active === name && "bg-surface-2 outline-1 outline-line-strong",
            )}
            onClick={() => onActivate(name)}
            onMouseEnter={() => onHover(name)}
            onMouseLeave={() => onHover(null)}
          >
            <div className="flex items-center gap-2">
              <span className="size-3 shrink-0 rounded-[3px]" style={{ background: color }} />
              <div className="min-w-0 flex-1">
                <div className={clsx("truncate text-[13px] capitalize", silent ? "text-muted" : "text-content")}>
                  {label(name)}
                </div>
                <div className="text-[11px] text-muted">{count.toLocaleString()} notes</div>
              </div>
              <button
                type="button"
                aria-label={`Solo ${label(name)}`}
                aria-pressed={solo.has(name)}
                onClick={(e) => {
                  e.stopPropagation();
                  onSolo(name);
                }}
                className={clsx(
                  "size-7 rounded border-none bg-transparent !p-0 text-xs font-semibold",
                  solo.has(name) ? "!bg-white text-black" : "text-muted hover:text-content",
                )}
              >
                S
              </button>
              <button
                type="button"
                aria-label={`Mute ${label(name)}`}
                aria-pressed={muted.has(name)}
                onClick={(e) => {
                  e.stopPropagation();
                  onMute(name);
                }}
                className={clsx(
                  "flex size-7 items-center justify-center rounded border-none bg-transparent !p-0",
                  muted.has(name) ? "text-red" : "text-muted hover:text-content",
                )}
              >
                {muted.has(name) ? <IconSoundOff /> : <IconSound />}
              </button>
            </div>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              aria-hidden="true"
              className="mt-1 block h-6 w-full"
            >
              <polygon points={points} fill={color} fillOpacity={0.3} stroke={color} strokeWidth={1} />
            </svg>
          </div>
        );
      })}
    </aside>
  );
}
