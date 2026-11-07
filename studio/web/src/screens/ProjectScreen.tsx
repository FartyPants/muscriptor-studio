import { useEffect, useMemo, useRef, useState } from "react";
import type { AudioEngine } from "../audio";
import { ExportPanel } from "../components/ExportPanel";
import { InstrumentDialog } from "../components/InstrumentDialog";
import { InstrumentPanel } from "../components/Instruments";
import { PianoRollCanvas } from "../components/PianoRollCanvas";
import { RetranscribeDialog } from "../components/RetranscribeDialog";
import { RollScrollbar } from "../components/RollScrollbar";
import { EditControls, RollToolbar } from "../components/Toolbar";
import { TopBar } from "../components/TopBar";
import { TranscribeBar } from "../components/TranscribeBar";
import { Transport } from "../components/Transport";
import { useEditorKeys } from "../hooks/useEditorKeys";
import { gridWithMeter, useProject, type Range } from "../hooks/useProject";
import { useRollFrame } from "../hooks/useRollFrame";
import { DEFAULT_DISPLAY, type GridDisplay, type PianoRoll } from "../pianoroll";
import { ProgressEstimator } from "../progress";

const DISPLAY_KEY = "studio.display";

function loadDisplay(): GridDisplay {
  try {
    return { ...DEFAULT_DISPLAY, ...JSON.parse(localStorage.getItem(DISPLAY_KEY) ?? "{}") };
  } catch {
    return DEFAULT_DISPLAY;
  }
}

const toggled = (set: Set<string>, name: string) => {
  const next = new Set(set);
  if (!next.delete(name)) next.add(name);
  return next;
};

export function ProjectScreen({ id, audio }: { id: string; audio: AudioEngine }) {
  const rollRef = useRef<PianoRoll | null>(null);
  const progressRef = useRef<ProgressEstimator | null>(null);
  const progress = (progressRef.current ??= new ProgressEstimator());
  const fillRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);

  // Bumped when the editor's selection or history changes, to redraw the toolbar.
  const [, setEditTick] = useState(0);
  const project = useProject({
    id,
    audio,
    rollRef,
    progress,
    onRedraw: () => setEditTick((t) => t + 1),
  });
  const { doc, phase, working, notes, liveNames, analysis, saveState, error, notice } = project;
  const editorRef = project.editor;

  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [solo, setSolo] = useState<Set<string>>(new Set());
  const [display, setDisplay] = useState(loadDisplay);
  const [editing, setEditing] = useState(false);
  const [snap, setSnap] = useState(true);
  const [scaleLock, setScaleLock] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [userScrolled, setUserScrolled] = useState(false);
  const [range, setRange] = useState<Range | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [redo, setRedo] = useState<"all" | "range" | null>(null);

  const transcribingRef = useRef(false);
  transcribingRef.current = phase === "transcribing";
  useRollFrame({
    audio,
    rollRef,
    progress,
    fillRef,
    labelRef,
    transcribingRef,
    onFollowResumed: () => setUserScrolled(false),
  });
  useEditorKeys(audio, editorRef);

  const names = useMemo(
    () => (notes.length ? [...new Set(notes.map((n) => n.instrument))] : liveNames),
    [notes, liveNames],
  );

  // A solo silences everything else. Mutes come back when it ends.
  useEffect(() => {
    for (const name of names) {
      const silent = solo.size > 0 ? !solo.has(name) : muted.has(name);
      audio.setInstrumentMuted(name, silent);
      rollRef.current?.setInstrumentMuted(name, silent);
    }
  }, [audio, names, muted, solo]);

  useEffect(() => {
    rollRef.current?.setDisplay(display);
    try {
      localStorage.setItem(DISPLAY_KEY, JSON.stringify(display));
    } catch {
      // A remembered preference is a convenience.
    }
  }, [display]);

  // Stay in key shows the key on the pitch rows, whichever key is in use.
  const inKey = editing && scaleLock && !working ? analysis?.key : null;
  useEffect(() => {
    rollRef.current?.setKeyLanes(inKey ?? null);
  }, [inKey]);

  const startRetranscribing = (request: Parameters<typeof project.retranscribe>[1]) => {
    const target = redo === "range" ? range : null;
    editorRef.current?.setEnabled(false);
    setEditing(false);
    setRedo(null);
    void project.retranscribe(target, request);
  };

  const rangeNotes = range
    ? notes.filter((n) => {
        const t = n.start - (doc?.beat_grid?.onset_delay ?? 0);
        return t >= range.start && t < range.end;
      }).length
    : 0;

  return (
    <div className="flex h-full flex-col bg-ink">
      <TopBar
        title={doc?.name ?? "Loading"}
        model={doc?.model ?? null}
        saveState={phase === "ready" ? saveState : null}
        onExport={phase === "ready" && !working ? () => setShowExport(true) : null}
        onRetranscribe={phase === "ready" && !working ? setRedo : null}
        hasRange={range !== null}
      />
      <Transport
        audio={audio}
        grid={gridWithMeter(doc)}
        detectedMeter={doc?.beat_grid?.beats_per_bar ?? null}
        chosenMeter={doc?.meter ?? null}
        onChooseMeter={project.chooseMeter}
        analysis={analysis}
        chosenKey={doc?.key ?? null}
        onChooseKey={project.chooseKey}
        following={!userScrolled}
        onFollow={(on) => {
          setUserScrolled(!on);
          if (on) rollRef.current?.follow();
          else rollRef.current?.unfollow();
        }}
        onRestart={() => {
          audio.seek(0);
          rollRef.current?.follow();
          setUserScrolled(false);
        }}
      />

      {working && (
        <TranscribeBar
          stopping={project.stopping}
          onStop={project.stop}
          fillRef={fillRef}
          labelRef={labelRef}
        />
      )}

      {phase === "ready" && doc?.status === "partial" && !working && (
        <p className="shrink-0 border-b border-line bg-panel px-3 py-1.5 text-[13px] text-muted">
          Stopped early. This project holds {notes.length.toLocaleString()} notes, up to where
          transcription stopped.
        </p>
      )}

      {(error || notice) && (
        <p
          role={error ? "alert" : "status"}
          className={`shrink-0 border-b border-line px-3 py-1.5 text-[13px] ${error ? "text-danger" : "text-muted"}`}
        >
          {error ?? notice}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <RollToolbar
            roll={rollRef.current}
            display={display}
            onDisplay={setDisplay}
            hasBars={Boolean(doc?.beat_grid)}
          >
            {phase === "ready" && !working && (
              <EditControls
                editing={editing}
                snap={snap}
                snapAvailable={Boolean(doc?.beat_grid)}
                scaleLock={scaleLock}
                scaleAvailable={Boolean(analysis?.key)}
                editor={editorRef.current}
                store={project.store.current}
                onEditing={(on) => {
                  setEditing(on);
                  const editor = editorRef.current;
                  editor?.setEnabled(on);
                  if (on && !editor?.active) {
                    const first = names[0] ?? null;
                    setActive(first);
                    editor?.setActive(first);
                  }
                }}
                onSnap={(on) => {
                  setSnap(on);
                  if (editorRef.current) editorRef.current.snap = on;
                }}
                onScaleLock={(on) => {
                  setScaleLock(on);
                  if (editorRef.current) editorRef.current.scaleLock = on;
                }}
              />
            )}
          </RollToolbar>
          <div className="min-h-0 flex-1">
            <PianoRollCanvas
              rollRef={rollRef}
              editorRef={editorRef}
              audio={audio}
              display={display}
              setUserScrolled={setUserScrolled}
              onRange={setRange}
            />
          </div>
          <RollScrollbar rollRef={rollRef} onScroll={() => setUserScrolled(true)} />
        </div>
        <InstrumentPanel
          notes={notes}
          names={names}
          muted={muted}
          solo={solo}
          active={editing ? active : null}
          onActivate={(name) => {
            if (!editing) return;
            setActive(name);
            editorRef.current?.setActive(name);
          }}
          onMute={(name) => setMuted((m) => toggled(m, name))}
          onSolo={(name) => setSolo((s) => toggled(s, name))}
          onHover={(name) => rollRef.current?.setHighlightedInstrument(name)}
        />
      </div>

      {phase === "idle" && doc && project.file.current && (
        <InstrumentDialog
          doc={doc}
          onHints={project.saveHints}
          onStart={(hints) => project.transcribeProject(doc, project.file.current!, hints)}
        />
      )}

      {showExport && doc && (
        <ExportPanel
          doc={doc}
          notes={project.store.current?.notes ?? notes}
          names={names}
          chosenKey={doc.key ?? null}
          hasChords={(analysis?.chords.length ?? 0) > 0}
          meter={doc.meter ?? doc.beat_grid?.beats_per_bar ?? 4}
          onMeter={(meter) => project.chooseMeter(meter === doc.beat_grid?.beats_per_bar ? null : meter)}
          onClose={() => setShowExport(false)}
        />
      )}

      {redo && doc && (
        <RetranscribeDialog
          doc={doc}
          range={redo === "range" ? range : null}
          noteCount={redo === "range" ? rangeNotes : notes.length}
          onCancel={() => setRedo(null)}
          onStart={startRetranscribing}
        />
      )}
    </div>
  );
}
