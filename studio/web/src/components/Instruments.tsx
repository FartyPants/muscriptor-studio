import clsx from "clsx";
import { Volume2, VolumeX } from "lucide-react";
import { useMemo } from "react";
import type { ProjectNote } from "../api";
import { displayName, label } from "../instruments";
import { instrumentColor } from "../pianoroll";
import { IconButton } from "./ui";

const BINS = 80;
const W = 240;
const H = 22;

/** One row per instrument, most notes first, with its note density over time. */
function instrumentRows(notes: ProjectNote[], names: string[]) {
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
    <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-l border-line bg-panel">
      <h2 className="px-3 pt-3 pb-1 text-[13px] font-semibold text-content">Instruments</h2>
      {active && <p className="px-3 pb-1 text-xs text-muted">Click an instrument to edit its notes.</p>}
      {rows.length === 0 && (
        <p className="px-3 text-xs text-muted">Instruments appear here after transcription.</p>
      )}
      <div className="px-1.5 pb-2">
        {rows.map(({ name, count, points }) => {
          const color = instrumentColor(name);
          const silent = solo.size > 0 ? !solo.has(name) : muted.has(name);
          return (
            <div
              key={name}
              onClick={() => onActivate(name)}
              onMouseEnter={() => onHover(name)}
              onMouseLeave={() => onHover(null)}
              className={clsx(
                "rounded-control px-1.5 py-1.5",
                active && "cursor-pointer hover:bg-raised",
                active === name && "bg-raised shadow-[inset_2px_0_0_var(--color-accent)]",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />
                <div className="min-w-0 flex-1">
                  <div className={clsx("truncate text-[13px] font-medium", silent ? "text-faint" : "text-content")}>
                    {displayName(name)}
                  </div>
                  {count > 0 && <div className="tabular text-xs text-muted">{count.toLocaleString()} notes</div>}
                </div>
                <IconButton
                  label={`Solo ${label(name)}`}
                  pressed={solo.has(name)}
                  className="!size-7 text-xs font-semibold"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSolo(name);
                  }}
                >
                  S
                </IconButton>
                <IconButton
                  label={`Mute ${label(name)}`}
                  pressed={muted.has(name)}
                  className="!size-7"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMute(name);
                  }}
                >
                  {muted.has(name) ? <VolumeX size={14} /> : <Volume2 size={14} />}
                </IconButton>
              </div>
              {count > 0 && (
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                  className="mt-1 block h-5 w-full"
                >
                  <polygon points={points} fill={color} fillOpacity={silent ? 0.1 : 0.28} />
                </svg>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
