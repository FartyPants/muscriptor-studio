import { X } from "lucide-react";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { displayName, scoreInstrument } from "../instruments";

/** Type to find an instrument, and pick from the list. Chosen ones become chips. */
export function InstrumentPicker(props: {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const { selected, onChange } = props;
  const [available, setAvailable] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/instruments")
      .then((r) => r.json())
      .then((data) => setAvailable(data.instruments ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onPress = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    // In the capture phase: a dialog stops mouse events before they reach here.
    document.addEventListener("mousedown", onPress, true);
    return () => document.removeEventListener("mousedown", onPress, true);
  }, []);

  const matches = useMemo(() => {
    const rest = available.filter((name) => !selected.has(name));
    if (!query.trim()) return rest;
    return rest
      .map((name) => ({ name, score: scoreInstrument(name, query) }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((m) => m.name);
  }, [available, query, selected]);

  const add = (name: string) => {
    onChange(new Set([...selected, name]));
    setQuery("");
    setHighlight(0);
    // Closed again, so the list doesn't sit over the buttons beneath it.
    setOpen(false);
  };

  const remove = (name: string) => {
    const next = new Set(selected);
    next.delete(name);
    onChange(next);
  };

  return (
    <div ref={root} className="relative">
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-control border border-line-strong bg-ink p-1.5 focus-within:border-accent">
        {[...selected].map((name) => (
          <span
            key={name}
            className="inline-flex h-7 items-center gap-1 rounded-[5px] bg-raised pr-1 pl-2.5 text-[13px] text-content"
          >
            {displayName(name)}
            <button
              type="button"
              aria-label={`Remove ${displayName(name)}`}
              title={`Remove ${displayName(name)}`}
              onClick={() => remove(name)}
              className="flex size-5 items-center justify-center rounded text-muted hover:bg-hover hover:text-content"
            >
              <X size={13} />
            </button>
          </span>
        ))}
        <input
          aria-label="Add an instrument"
          placeholder={selected.size ? "Add another" : "Type an instrument, such as saxophone"}
          value={query}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter" && matches[highlight]) {
              e.preventDefault();
              add(matches[highlight]);
            } else if (e.key === "Backspace" && !query && selected.size) {
              remove([...selected].at(-1)!);
            } else if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          className="h-7 min-w-40 flex-1 bg-transparent px-1.5 text-[13px] text-content outline-none placeholder:text-faint"
        />
      </div>
      {open && matches.length > 0 && (
        <ul
          role="listbox"
          aria-label="Instruments"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-control border border-line-strong bg-raised p-1 shadow-pop"
        >
          {matches.map((name, i) => (
            <li
              key={name}
              role="option"
              aria-selected={i === highlight}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                add(name);
              }}
              className={clsx(
                "cursor-pointer rounded px-2.5 py-1.5 text-[13px]",
                i === highlight ? "bg-hover text-content" : "text-muted",
              )}
            >
              {displayName(name)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
