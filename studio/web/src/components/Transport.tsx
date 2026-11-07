import clsx from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AudioEngine } from "../audio";
import type { BeatGrid } from "../pianoroll";
import { IconPause, IconPlay } from "./icons";

const fmt = (s: number) => {
  const whole = Math.floor(Math.max(0, s));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}.${Math.floor((Math.max(0, s) % 1) * 10)}`;
};

const CHROME = "rounded-lg border border-line-strong px-3 py-1.5 text-[13px] text-content hover:bg-surface-2";

function Group({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line p-1.5">{children}</div>
  );
}

export function Transport(props: {
  audio: AudioEngine;
  grid: BeatGrid | null;
  following: boolean;
  onFollow: (on: boolean) => void;
  onRestart: () => void;
}) {
  const { audio, grid, following, onFollow, onRestart } = props;
  const [playing, setPlaying] = useState(false);
  const [metronome, setMetronome] = useState(false);
  const [clickLevel, setClickLevel] = useState(0.5);
  const [mix, setMix] = useState(0.75);
  const clock = useRef<HTMLSpanElement>(null);
  const total = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (clock.current) clock.current.textContent = fmt(audio.seconds);
      if (total.current) total.current.textContent = fmt(audio.duration);
      const on = audio.state === "started";
      setPlaying((was) => (was === on ? was : on));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [audio]);

  useEffect(() => audio.setMetronome(metronome), [audio, metronome]);
  useEffect(() => audio.setMetronomeLevel(clickLevel), [audio, clickLevel]);
  useEffect(() => audio.setMix(mix), [audio, mix]);

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
      <Group>
        <button
          type="button"
          onClick={() => (playing ? audio.pause() : audio.play())}
          className="flex w-20 items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[13px] font-medium text-black"
        >
          {playing ? <IconPause /> : <IconPlay />}
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          aria-pressed={metronome}
          disabled={!grid}
          onClick={() => setMetronome(!metronome)}
          className={clsx(CHROME, metronome && "bg-surface-2", "disabled:opacity-40")}
        >
          Metronome
        </button>
        {metronome && (
          <input
            aria-label="Metronome volume"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={clickLevel}
            onChange={(e) => setClickLevel(Number(e.target.value))}
            className="mix-slider w-16"
          />
        )}
        <button type="button" aria-label="Back to start" onClick={onRestart} className={CHROME}>
          ⟲
        </button>
        <span className="rounded-lg border border-line-strong px-3 py-1.5 font-mono text-[13px] text-content">
          <span ref={clock}>0:00.0</span>
          <span className="text-muted"> / </span>
          <span ref={total} className="text-muted">
            0:00.0
          </span>
        </span>
        <button
          type="button"
          aria-label="Follow playhead"
          aria-pressed={following}
          onClick={() => onFollow(!following)}
          className={clsx(CHROME, following ? "bg-surface-2" : "opacity-60")}
        >
          ◎
        </button>
      </Group>

      {grid && (
        <Group>
          <span className="px-2 font-mono text-xs text-muted">
            TEMPO <span className="font-medium text-content">{Math.round(grid.bpm)} BPM</span>
          </span>
        </Group>
      )}

      <div className="ml-auto">
        <Group>
          <span className="pl-1 text-xs text-muted">Audio</span>
          <input
            aria-label="Audio and MIDI balance"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={mix}
            onChange={(e) => setMix(Number(e.target.value))}
            className="mix-slider w-24"
          />
          <span className="pr-1 text-xs text-muted">MIDI</span>
        </Group>
      </div>
    </div>
  );
}
