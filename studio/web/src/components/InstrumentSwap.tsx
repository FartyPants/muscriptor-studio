import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { instrumentTargets } from "../editor/changeInstrument";
import { displayName, scoreInstrument } from "../instruments";
import { useInstrumentList } from "./InstrumentPicker";

/**
 * Finding the instrument a track should become. Opens inside the track's row,
 * so the panel's scrolling can't cut it off.
 */
export function InstrumentSwap(props: {
  from: string;
  /** Instruments that already have a track: choosing one merges into it. */
  tracks: string[];
  onPick: (to: string) => void;
  onClose: () => void;
}) {
  const { from, tracks, onPick, onClose } = props;
  const available = useInstrumentList();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    input.current?.focus();
    const onPress = (e: MouseEvent) => {
      const target = e.target as Element;
      // Its own button closes it by toggling.
      if (root.current?.contains(target) || target.closest?.("[data-swap-toggle]")) return;
      close.current();
    };
    document.addEventListener("mousedown", onPress, true);
    return () => document.removeEventListener("mousedown", onPress, true);
  }, []);

  const matches = useMemo(() => {
    const targets = instrumentTargets(available, from);
    if (!query.trim()) return targets;
    return targets
      .map((name) => ({ name, score: scoreInstrument(name, query) }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((m) => m.name);
  }, [available, from, query]);

  return (
    <div ref={root} className="mt-1.5" onClick={(e) => e.stopPropagation()}>
      <input
        ref={input}
        aria-label={`Change ${displayName(from)} to`}
        placeholder="Change to, such as violin"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
        }}
        onKeyDown={(e) => {
          // Escape closes this search, not something around it.
          e.stopPropagation();
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && matches[highlight]) {
            e.preventDefault();
            onPick(matches[highlight]);
          } else if (e.key === "Escape") {
            onClose();
          }
        }}
        className="h-8 w-full rounded-control border border-line-strong bg-ink px-2 text-[13px] text-content outline-none placeholder:text-faint focus:border-accent"
      />
      {matches.length > 0 ? (
        <ul
          role="listbox"
          aria-label="Instruments"
          className="mt-1 max-h-48 overflow-y-auto rounded-control border border-line-strong bg-raised p-1"
        >
          {matches.map((name, i) => (
            <li
              key={name}
              role="option"
              aria-selected={i === highlight}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(name);
              }}
              className={clsx(
                "flex cursor-pointer items-baseline justify-between gap-2 rounded px-2 py-1 text-[13px]",
                i === highlight ? "bg-hover text-content" : "text-muted",
              )}
            >
              {displayName(name)}
              {tracks.includes(name) && <span className="text-xs text-faint">merges</span>}
            </li>
          ))}
        </ul>
      ) : (
        available.length > 0 && <p className="mt-1 px-1 text-xs text-muted">No instrument matches.</p>
      )}
    </div>
  );
}
