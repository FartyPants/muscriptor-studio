import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChosenKey } from "../api";
import type { AudioEngine } from "../audio";
import { ExportPanel } from "../components/ExportPanel";
import { InstrumentDialog } from "../components/InstrumentDialog";
import { InstrumentPanel } from "../components/Instruments";
import { PianoRollCanvas } from "../components/PianoRollCanvas";
import { RetranscribeDialog } from "../components/RetranscribeDialog";
import { ScoreView } from "../components/ScoreView";
import { RollScrollbar } from "../components/RollScrollbar";
import { EditControls, RollToolbar } from "../components/Toolbar";
import { TopBar } from "../components/TopBar";
import { TranscribeBar } from "../components/TranscribeBar";
import { Transport, type ProjectView } from "../components/Transport";
import { canChangeInstrument, changeInstrument, movedFlag, restoredFlag } from "../editor/changeInstrument";
import { useEditorKeys } from "../hooks/useEditorKeys";
import { gridWithMeter, useProject, type Range } from "../hooks/useProject";
import { useRollFrame } from "../hooks/useRollFrame";
import {
  DEFAULT_DISPLAY,
  type GridDisplay,
  type PianoRoll,
} from "../pianoroll";
import { ProgressEstimator } from "../progress";
import { audibleNotes } from "../score";

const DISPLAY_KEY = "studio.display";
const VIEW_KEY = "studio.view";

function loadView(): ProjectView {
  try {
    return sessionStorage.getItem(VIEW_KEY) === "score" ? "score" : "roll";
  } catch {
    return "roll";
  }
}

function loadDisplay(): GridDisplay {
  try {
    return {
      ...DEFAULT_DISPLAY,
      ...JSON.parse(localStorage.getItem(DISPLAY_KEY) ?? "{}"),
    };
  } catch {
    return DEFAULT_DISPLAY;
  }
}

const toggled = (set: Set<string>, name: string) => {
  const next = new Set(set);
  if (!next.delete(name)) next.add(name);
  return next;
};

export function ProjectScreen({
  id,
  audio,
}: {
  id: string;
  audio: AudioEngine;
}) {
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
  const {
    doc,
    phase,
    working,
    notes,
    liveNames,
    analysis,
    saveState,
    error,
    notice,
  } = project;
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
  const [loopOn, setLoopOn] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [redo, setRedo] = useState<"all" | "range" | null>(null);
  const [chosenView, setChosenView] = useState(loadView);
  // Live notes arrive on the roll, so the score waits for the finished project.
  const view: ProjectView = phase === "ready" ? chosenView : "roll";

  const chooseView = (next: ProjectView) => {
    setChosenView(next);
    try {
      sessionStorage.setItem(VIEW_KEY, next);
    } catch {
      // A remembered tab is a convenience.
    }
    // The roll's editing keys must not change notes nobody can see.
    if (next === "score") {
      setEditing(false);
      editorRef.current?.setEnabled(false);
    }
  };

  // The key the transport shows, so the score and sheet music use it too.
  const detectedKey = analysis?.key ?? null;
  const keyInUse = useMemo<ChosenKey | null>(
    () =>
      doc?.key ??
      (detectedKey
        ? { tonic: detectedKey.tonic, mode: detectedKey.mode as ChosenKey["mode"] }
        : null),
    // By value: each analysis result is a new object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc?.key, detectedKey?.tonic, detectedKey?.mode],
  );

  // The score shows what playback lets through.
  const scoreNotes = useMemo(() => audibleNotes(notes, muted, solo), [notes, muted, solo]);
  // Tracks that can take tab: pitched ones in the score, most notes first.
  const tabTracks = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of scoreNotes) {
      if (canChangeInstrument(n.instrument)) counts.set(n.instrument, (counts.get(n.instrument) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [scoreNotes]);

  const rollHiddenRef = useRef(false);
  rollHiddenRef.current = view === "score";
  const transcribingRef = useRef(false);
  transcribingRef.current = phase === "transcribing";
  useRollFrame({
    audio,
    rollRef,
    progress,
    fillRef,
    labelRef,
    transcribingRef,
    hiddenRef: rollHiddenRef,
    onFollowResumed: () => setUserScrolled(false),
  });
  const hasRange = range !== null;
  const toggleLoop = useCallback(() => {
    if (hasRange) setLoopOn((on) => !on);
  }, [hasRange]);
  useEditorKeys(audio, editorRef, toggleLoop);

  const looping = loopOn && hasRange;
  useEffect(() => {
    audio.setLoop(looping ? range : null);
    rollRef.current?.setLooping(looping);
  }, [audio, looping, range]);

  const names = useMemo(
    () =>
      notes.length ? [...new Set(notes.map((n) => n.instrument))] : liveNames,
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

  const startRetranscribing = (
    request: Parameters<typeof project.retranscribe>[1],
  ) => {
    const target = redo === "range" ? range : null;
    setLoopOn(false);
    editorRef.current?.setEnabled(false);
    setEditing(false);
    setRedo(null);
    void project.retranscribe(target, request);
  };

  // A track becomes another instrument: its sound, colour and exported name.
  const changeTrack = (from: string, to: string) => {
    const store = project.store.current;
    if (!store) return;
    const merged = names.includes(to);
    const wasMuted = muted.has(from);
    const wasSolo = solo.has(from);
    const hadTab = doc?.fretboard?.tab === from;
    // Mutes, solos and the tab follow the track, and come back with an undo.
    // The tab follows a renamed track; a merged one has no part of its own.
    const forward = () => {
      setMuted((m) => movedFlag(m, from, to, merged));
      setSolo((s) => movedFlag(s, from, to, merged));
      if (hadTab) project.moveTab(from, merged ? null : to);
    };
    store.apply({
      ...changeInstrument(store.notes, from, to),
      effect: {
        redo: forward,
        undo: () => {
          setMuted((m) => restoredFlag(m, from, to, merged, wasMuted));
          setSolo((s) => restoredFlag(s, from, to, merged, wasSolo));
          if (hadTab) project.moveTab(merged ? null : to, from);
        },
      },
    });
    forward();
    if (active === from) {
      setActive(to);
      editorRef.current?.setActive(to);
    }
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
        onExport={
          phase === "ready" && !working ? () => setShowExport(true) : null
        }
        onRetranscribe={phase === "ready" && !working ? setRedo : null}
        hasRange={hasRange}
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
        looping={looping}
        onLoop={hasRange ? toggleLoop : null}
        view={view}
        onView={phase === "ready" ? chooseView : null}
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
          Stopped early. This project holds {notes.length.toLocaleString()}{" "}
          notes, up to where transcription stopped.
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
        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* Hidden, not removed: the roll keeps its view, and the editor its canvas. */}
          <div
            className={
              view === "score"
                ? "invisible flex min-h-0 flex-1 flex-col"
                : "flex min-h-0 flex-1 flex-col"
            }
          >
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
                onRange={(chosen) => {
                  setRange(chosen);
                  if (!chosen) {
                    // Now, not in the effect: this click's jump comes next,
                    // and a loop still running would hold it in the section.
                    audio.setLoop(null);
                    setLoopOn(false);
                  }
                }}
              />
            </div>
            <RollScrollbar
              rollRef={rollRef}
              onScroll={() => setUserScrolled(true)}
            />
          </div>
          {doc && phase === "ready" && (
            <ScoreView
              doc={doc}
              notes={scoreNotes}
              silenced={notes.length > 0 && scoreNotes.length === 0}
              keyInUse={keyInUse}
              keyReady={Boolean(doc.key) || analysis !== null}
              audio={audio}
              visible={view === "score"}
              following={!userScrolled}
              onUserScroll={() => {
                setUserScrolled(true);
                rollRef.current?.unfollow();
              }}
              tracks={tabTracks}
              muted={[...muted, ...names.filter((name) => solo.size > 0 && !solo.has(name))]}
              onFretboard={project.chooseFretboard}
            />
          )}
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
          onChangeInstrument={phase === "ready" && !working ? changeTrack : null}
        />
      </div>

      {phase === "idle" && doc && project.file.current && (
        <InstrumentDialog
          doc={doc}
          onHints={project.saveHints}
          onStart={(hints) =>
            project.transcribeProject(doc, project.file.current!, hints)
          }
        />
      )}

      {showExport && doc && (
        <ExportPanel
          doc={doc}
          notes={project.store.current?.notes ?? notes}
          names={names}
          chosenKey={keyInUse}
          hasChords={(analysis?.chords.length ?? 0) > 0}
          meter={doc.meter ?? doc.beat_grid?.beats_per_bar ?? 4}
          onMeter={(meter) =>
            project.chooseMeter(
              meter === doc.beat_grid?.beats_per_bar ? null : meter,
            )
          }
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
