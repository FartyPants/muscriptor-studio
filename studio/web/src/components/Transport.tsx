import clsx from "clsx";
import { Crosshair, Info, Pause, Play, SkipBack, Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Analysis, ChosenKey } from "../api";
import type { AudioEngine } from "../audio";
import { METERS, type BeatGrid } from "../pianoroll";
import { IconButton, Popover, Segmented, Select, Toggle } from "./ui";

export type ProjectView = "roll" | "score";

const fmt = (s: number) => {
  const t = Math.max(0, s);
  const whole = Math.floor(t);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}.${Math.floor((t % 1) * 10)}`;
};

const NAMES = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const MINOR_NAMES = [
  "C",
  "C♯",
  "D",
  "E♭",
  "E",
  "F",
  "F♯",
  "G",
  "G♯",
  "A",
  "B♭",
  "B",
];

const AUTO = "auto";
const KEY_OPTIONS = [
  ...NAMES.map((name, tonic) => ({
    value: `${tonic}:major`,
    label: `${name} major`,
  })),
  ...MINOR_NAMES.map((name, tonic) => ({
    value: `${tonic}:minor`,
    label: `${name} minor`,
  })),
];

function KeyMenu(props: {
  analysis: Analysis | null;
  chosen: ChosenKey | null;
  onChoose: (key: ChosenKey | null) => void;
}) {
  const { analysis, chosen, onChoose } = props;
  const detected = analysis?.detected?.label;
  const options = [
    { value: AUTO, label: detected ? `Auto (${detected})` : "Auto" },
    ...KEY_OPTIONS,
  ];
  return (
    <Select
      label="Key"
      hideLabel
      className="w-40"
      value={chosen ? `${chosen.tonic}:${chosen.mode}` : AUTO}
      options={options}
      onChange={(value) => {
        if (value === AUTO) return onChoose(null);
        const [tonic, mode] = value.split(":");
        onChoose({ tonic: Number(tonic), mode: mode as ChosenKey["mode"] });
      }}
    />
  );
}

const AUTO_METER = 0;

function MeterMenu(props: {
  detected: number | null;
  chosen: number | null;
  onChoose: (meter: number | null) => void;
}) {
  const { detected, chosen, onChoose } = props;
  const auto = detected ? `Auto (${detected}/4)` : "Auto (4/4, assumed)";
  return (
    <Select
      label="Meter"
      hideLabel
      className="w-40"
      value={chosen ?? AUTO_METER}
      options={[
        { value: AUTO_METER, label: auto },
        ...METERS.map((n) => ({ value: n, label: `${n}/4` })),
      ]}
      onChange={(value) => onChoose(value === AUTO_METER ? null : value)}
    />
  );
}

function Detail({
  name,
  value,
  why,
}: {
  name: string;
  value: string;
  why: string;
}) {
  return (
    <div>
      <div className="flex justify-between gap-6 text-[13px]">
        <span className="text-muted">{name}</span>
        <span className="tabular font-medium text-content">{value}</span>
      </div>
      <p className="mt-0.5 text-xs text-muted">{why}</p>
    </div>
  );
}

function meterReason(chosen: number | null, detected: number | null): string {
  if (chosen)
    return `Set by you. ${detected ? `Detected: ${detected}/4.` : "None was detected."} The notes don't move.`;
  if (detected) return "Estimated from beat grid analysis.";
  return "Not detected, so bars of 4 are assumed. Choose the meter beside the key.";
}

function AnalysisDetails(props: {
  analysis: Analysis | null;
  chosen: ChosenKey | null;
  grid: BeatGrid | null;
  chosenMeter: number | null;
  detectedMeter: number | null;
}) {
  const { analysis, chosen, grid, chosenMeter, detectedMeter } = props;
  return (
    <Popover
      align="right"
      className="w-72 p-4"
      trigger={(open, toggle) => (
        <IconButton label="Analysis details" pressed={open} onClick={toggle}>
          <Info size={15} />
        </IconButton>
      )}
    >
      <h3 className="mb-3 text-sm font-semibold text-content">
        Analysis details
      </h3>
      <div className="flex flex-col gap-3">
        <Detail
          name="Key"
          value={analysis?.key?.label ?? "Unknown"}
          why={
            chosen
              ? `Set by you. Detected: ${analysis?.detected?.label ?? "unknown"}.`
              : "Estimated from the transcribed notes. Used for chord names, scale lock and sheet music. Choosing another key doesn't transpose the notes."
          }
        />
        <Detail
          name="Tempo"
          value={grid ? `${Math.round(grid.bpm)} BPM` : "Unknown"}
          why={
            grid?.steady === false
              ? "Average of the beat grid. The beat follows the performance."
              : "Estimated from beat grid analysis."
          }
        />
        <Detail
          name="Meter"
          value={grid ? `${grid.beats_per_bar ?? 4}/4` : "Unknown"}
          why={meterReason(chosenMeter, detectedMeter)}
        />
      </div>
    </Popover>
  );
}

export function Transport(props: {
  audio: AudioEngine;
  /** With the chosen meter applied. */
  grid: BeatGrid | null;
  detectedMeter: number | null;
  chosenMeter: number | null;
  onChooseMeter: (meter: number | null) => void;
  analysis: Analysis | null;
  chosenKey: ChosenKey | null;
  onChooseKey: (key: ChosenKey | null) => void;
  following: boolean;
  onFollow: (on: boolean) => void;
  onRestart: () => void;
  view: ProjectView;
  /** Null while there is no score to show. */
  onView: ((view: ProjectView) => void) | null;
}) {
  const { audio, grid, detectedMeter, chosenMeter, onChooseMeter } = props;
  const {
    analysis,
    chosenKey,
    onChooseKey,
    following,
    onFollow,
    onRestart,
    view,
    onView,
  } = props;
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
    <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-3 py-1.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => (playing ? audio.pause() : audio.play())}
          className="inline-flex h-8 w-[84px] items-center justify-center gap-1.5 rounded-control bg-accent text-[13px] font-semibold text-ink hover:bg-[#a7bbff]"
        >
          {playing ? (
            <Pause size={14} fill="currentColor" />
          ) : (
            <Play size={14} fill="currentColor" />
          )}
          {playing ? "Pause" : "Play"}
        </button>
        <IconButton label="Back to start" onClick={onRestart}>
          <SkipBack size={15} />
        </IconButton>
        <Toggle
          title="Keep the playhead in view"
          pressed={following}
          onClick={() => onFollow(!following)}
        >
          <Crosshair size={15} />
          Follow
        </Toggle>
      </div>

      <span className="tabular text-[15px] font-medium text-content">
        <span ref={clock}>0:00.0</span>
        <span className="text-faint"> / </span>
        <span ref={total} className="text-muted">
          0:00.0
        </span>
      </span>

      <div className="flex items-center gap-1">
        <Toggle
          title={
            grid ? "Click on every beat" : "The metronome needs a beat grid"
          }
          pressed={metronome}
          disabled={!grid}
          onClick={() => setMetronome(!metronome)}
        >
          <Timer size={15} />
          Metronome
        </Toggle>
        {metronome && (
          <input
            aria-label="Metronome volume"
            title="Metronome volume"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={clickLevel}
            onChange={(e) => setClickLevel(Number(e.target.value))}
            className="range w-16"
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        {analysis && (
          <div
            className="flex items-center gap-1.5"
            title="Used for chord names, scale lock and sheet music. Notes are not transposed."
          >
            <span className="text-[13px] text-muted">Key</span>
            <KeyMenu
              analysis={analysis}
              chosen={chosenKey}
              onChoose={onChooseKey}
            />
          </div>
        )}
        {grid && (
          <div
            className="flex items-center gap-1.5"
            title="Sets the bars on the timeline, the metronome and the sheet music. Notes don't move."
          >
            <span className="text-[13px] text-muted">Meter</span>
            <MeterMenu
              detected={detectedMeter}
              chosen={chosenMeter}
              onChoose={onChooseMeter}
            />
          </div>
        )}
        {grid && (
          <span className="tabular text-[13px] text-content">
            {Math.round(grid.bpm)} BPM
          </span>
        )}
        {(grid || analysis) && (
          <AnalysisDetails
            analysis={analysis}
            chosen={chosenKey}
            grid={grid}
            chosenMeter={chosenMeter}
            detectedMeter={detectedMeter}
          />
        )}
      </div>

      <label
        className={clsx("ml-auto flex items-center gap-2 text-xs text-muted")}
      >
        Recording
        <input
          aria-label="Balance between the recording and the notes"
          title="Balance between the recording and the notes"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={mix}
          onChange={(e) => setMix(Number(e.target.value))}
          className="range w-24"
        />
        Notes
      </label>
      {onView && (
        <Segmented
          label="View"
          value={view}
          options={[
            { value: "roll", label: "Roll" },
            { value: "score", label: "Score" },
          ]}
          onChange={onView}
        />
      )}
    </div>
  );
}
