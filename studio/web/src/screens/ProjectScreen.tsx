import { LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Analysis, type ChosenKey, type ProjectDoc, type ProjectNote } from "../api";
import type { AudioEngine } from "../audio";
import { instrumentColor, resetInstrumentColors } from "../colors";
import { ExportPanel } from "../components/ExportPanel";
import { InstrumentChooser } from "../components/InstrumentChooser";
import { InstrumentPanel } from "../components/Instruments";
import { PianoRollCanvas } from "../components/PianoRollCanvas";
import { RetranscribeDialog, type RetranscribeRequest } from "../components/RetranscribeDialog";
import { RollScrollbar } from "../components/RollScrollbar";
import { EditControls, RollToolbar } from "../components/Toolbar";
import { TopBar } from "../components/TopBar";
import { Transport } from "../components/Transport";
import { Button, Modal } from "../components/ui";
import { Autosaver, type SaveState } from "../editor/autosave";
import { NoteStore } from "../editor/noteStore";
import { replaceRange } from "../editor/gestures";
import { RollEditor } from "../editor/rollEditor";
import { useProjectTranscription } from "../hooks/useProjectTranscription";
import { metronomeClicks } from "../metronome";
import { DEFAULT_DISPLAY, type BeatGrid, type GridDisplay, type PianoRoll } from "../pianoroll";
import { formatClock, ProgressEstimator } from "../progress";

type Phase = "loading" | "idle" | "transcribing" | "ready";
type Range = { start: number; end: number };

const DISPLAY_KEY = "studio.display";
/** After an edit, wait this long for the next one before renaming chords. */
const ANALYSIS_DELAY_MS = 600;

function loadDisplay(): GridDisplay {
  try {
    return { ...DEFAULT_DISPLAY, ...JSON.parse(localStorage.getItem(DISPLAY_KEY) ?? "{}") };
  } catch {
    return DEFAULT_DISPLAY;
  }
}

/** Stored notes, moved onto the beats as the roll and audio show them. */
function displayNotes(stored: ProjectNote[], grid: BeatGrid | null) {
  const delay = grid?.onset_delay ?? 0;
  return stored.map((n) => ({
    id: n.id,
    instrument: n.instrument,
    pitch: n.pitch,
    start: n.start - delay,
    end: n.end - delay,
  }));
}

export function ProjectScreen({ id, audio }: { id: string; audio: AudioEngine }) {
  const rollRef = useRef<PianoRoll | null>(null);
  const fileRef = useRef<File | null>(null);
  const progressRef = useRef<ProgressEstimator | null>(null);
  const progress = (progressRef.current ??= new ProgressEstimator());
  const fillRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const docRef = useRef<ProjectDoc | null>(null);
  const storeRef = useRef<NoteStore | null>(null);
  const editorRef = useRef<RollEditor | null>(null);
  const saverRef = useRef<Autosaver | null>(null);
  const analysisTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analysisRun = useRef(0);
  const mounted = useRef(true);

  const [doc, setDocState] = useState<ProjectDoc | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [background, setBackground] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [liveNames, setLiveNames] = useState<string[]>([]);
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [solo, setSolo] = useState<Set<string>>(new Set());
  const [stopping, setStopping] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [display, setDisplay] = useState(loadDisplay);
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [editing, setEditing] = useState(false);
  const [snap, setSnap] = useState(true);
  const [scaleLock, setScaleLock] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [userScrolled, setUserScrolled] = useState(false);
  const [range, setRange] = useState<Range | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [redo, setRedo] = useState<"all" | "range" | null>(null);
  // Bumped when the editor's selection or history changes, to redraw the toolbar.
  const [, setEditTick] = useState(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const setDoc = (next: ProjectDoc) => {
    docRef.current = next;
    setDocState(next);
  };

  const { transcribe, abort, stop } = useProjectTranscription({
    audio,
    rollRef,
    progress,
    onBusy: () => setNotice("The server is busy. Trying again shortly."),
    onAccepted: () => setNotice(null),
    onInstrument: (name) => setLiveNames((names) => [...names, name]),
  });

  /** Make the roll and playback show the store's notes. */
  function syncNotes(store: NoteStore, grid: BeatGrid | null) {
    const shown = displayNotes(store.notes, grid);
    const last = shown.reduce((end, n) => Math.max(end, n.end), 0);
    rollRef.current?.setNotes(shown);
    audio.replaceNotes(
      shown,
      last > 0 ? last + 0.3 : null,
      metronomeClicks(grid, Math.max(audio.duration, last)),
    );
    setNotes(store.notes);
  }

  /** Name the key and chords of the notes as they stand, once edits pause. */
  function scheduleAnalysis(wait: number) {
    if (analysisTimer.current !== null) clearTimeout(analysisTimer.current);
    analysisTimer.current = setTimeout(async () => {
      analysisTimer.current = null;
      const store = storeRef.current;
      const current = docRef.current;
      if (!store || !current) return;
      const run = ++analysisRun.current;
      try {
        const result = await api.analysis(store.notes, current.beat_grid, current.key ?? null);
        if (run !== analysisRun.current || !mounted.current) return;
        setAnalysis(result);
        rollRef.current?.setChords(result.chords);
        editorRef.current?.setScale(result.key?.scale ?? null);
      } catch {
        // Names are a help, not the work: keep showing the last ones.
      }
    }, wait);
  }

  /** Change project details, and save them with the notes. */
  function updateDoc(patch: Partial<ProjectDoc>) {
    const current = docRef.current;
    if (!current) return;
    setDoc({ ...current, ...patch });
    saverRef.current?.changed();
  }

  /** Start editing `saved`: one store, followed by the roll and playback. */
  function showProject(saved: ProjectDoc) {
    // Earliest first, as the instruments arrive during a live transcription.
    [...saved.notes].sort((a, b) => a.start - b.start).forEach((n) => instrumentColor(n.instrument));
    const store = new NoteStore(saved.notes);
    storeRef.current = store;
    rollRef.current?.setGridLines(saved.beat_grid);
    syncNotes(store, saved.beat_grid);
    const editor = new RollEditor(store, rollRef.current!, audio, () => setEditTick((t) => t + 1));
    editor.setGrid(saved.beat_grid);
    editorRef.current = editor;
    saverRef.current?.close();
    const saver = new Autosaver(
      () => api.saveProject({ ...docRef.current!, notes: store.notes }),
      setSaveState,
    );
    saverRef.current = saver;
    store.subscribe(() => {
      syncNotes(store, saved.beat_grid);
      editor.rebuild();
      saver.changed();
      scheduleAnalysis(ANALYSIS_DELAY_MS);
    });
    scheduleAnalysis(0);
  }

  async function run(project: ProjectDoc, file: File, hints: string[]) {
    const current = { ...project, hints };
    setDoc(current);
    setPhase("transcribing");
    setStopping(false);
    setError(null);
    setLiveNames([]);
    try {
      await api.ensureModel(current, () =>
        setNotice(`Loading the ${current.model} model. This can take a minute.`),
      );
      setNotice(null);
      await api.saveProject({ ...current, status: "transcribing" });
      const outcome = await transcribe(file, hints);
      if (!outcome) {
        await api.saveProject({ ...current, status: "created" });
        return;
      }
      const { notes: found, stopped } = outcome;
      if (stopped && found.length === 0) {
        await api.saveProject({ ...current, status: "created" });
        rollRef.current?.clear();
        setPhase("idle");
        return;
      }
      let beatGrid = outcome.beatGrid;
      if (stopped) {
        setNotice("Finding the beats");
        beatGrid = await api.beatGrid(current.id, found.map((n) => n.start));
        setNotice(null);
      }
      const saved = await api.saveProject({
        ...current,
        status: stopped ? "partial" : "completed",
        notes: found,
        beat_grid: beatGrid,
      });
      // Stopped, then left: the work is saved, but the audio engine and the
      // screen now belong to someone else.
      if (!mounted.current) return;
      setDoc(saved);
      showProject(saved);
      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    } finally {
      setStopping(false);
    }
  }

  /** Transcribe again, then swap the notes as one undo step. A failure changes nothing. */
  async function retranscribe(target: Range | null, { hints, model }: RetranscribeRequest) {
    const current = docRef.current;
    const store = storeRef.current;
    if (!current || !store) return;
    const updated = { ...current, hints, model };
    updateDoc({ hints, model });
    editorRef.current?.setEnabled(false);
    setEditing(false);
    setRedo(null);
    setBackground(true);
    setStopping(false);
    setError(null);
    try {
      await api.ensureModel(updated, () =>
        setNotice(`Loading the ${model} model. This can take a minute.`),
      );
      setNotice(null);
      const delay = current.beat_grid?.onset_delay ?? 0;
      const span = target ?? { start: 0, end: Infinity };
      const file = target ? await api.audioRange(current.id, target) : fileRef.current!;
      const outcome = await transcribe(file, hints, { live: false });
      if (!outcome || !mounted.current) return;
      const found = outcome.notes.map((n) => ({
        ...n,
        start: n.start + (target?.start ?? 0),
        end: n.end + (target?.start ?? 0),
      }));
      if (outcome.stopped && found.length === 0) return;
      // Stopped early: only the part that was heard again is replaced.
      const reached = outcome.stopped ? Math.max(...found.map((n) => n.end)) : span.end;
      store.apply(replaceRange(store.notes, found, span.start + delay, reached + delay));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBackground(false);
      setStopping(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    mounted.current = true;
    resetInstrumentColors();
    audio.reset();
    rollRef.current?.clear();
    (async () => {
      try {
        const loaded = await api.getProject(id);
        const file = await api.audioFile(loaded);
        if (cancelled) return;
        fileRef.current = file;
        setDoc(loaded);
        // Awaited: the metronome runs to the end of the audio.
        await audio.loadWav(file).catch(() => {});
        if (cancelled) return;
        if (loaded.status === "completed" || loaded.status === "partial") {
          showProject(loaded);
          setPhase("ready");
        } else {
          setPhase("idle");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      mounted.current = false;
      if (analysisTimer.current !== null) clearTimeout(analysisTimer.current);
      abort();
      audio.reset();
      saverRef.current?.close();
      saverRef.current = null;
    };
    // `run` and `showProject` read refs and props stable for this keyed screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, audio]);

  useEffect(() => {
    let raf = 0;
    const frame = () => {
      const roll = rollRef.current;
      if (roll) {
        const duration = audio.duration;
        const transcribing = phaseRef.current === "transcribing";
        roll.setPlayhead(audio.seconds);
        roll.setDuration(duration);
        roll.setTranscribedUntil(
          transcribing && duration > 0 ? progress.completedFraction() * duration : null,
        );
        roll.render();
        if (roll.consumeAutoResumed()) setUserScrolled(false);
      }
      if (fillRef.current) {
        const now = performance.now();
        const fraction = progress.fraction(now);
        fillRef.current.style.width = `${(fraction * 100).toFixed(1)}%`;
        const eta = progress.etaMs(now);
        if (labelRef.current) {
          labelRef.current.textContent = eta == null ? "Starting" : `About ${formatClock(eta / 1000)} left`;
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [audio, progress]);

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

  const toggle = (set: Set<string>, name: string) => {
    const next = new Set(set);
    if (!next.delete(name)) next.add(name);
    return next;
  };

  // A failed or waiting save would lose edits if the page closed now.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!Autosaver.anyUnsaved) return;
      Autosaver.flushAll();
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select")) return;
      if (editorRef.current?.key(e)) {
        e.preventDefault();
        return;
      }
      if (e.code !== "Space" || target.closest("button")) return;
      e.preventDefault();
      if (audio.state === "started") audio.pause();
      else audio.play();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [audio]);

  const chooseKey = (key: ChosenKey | null) => {
    updateDoc({ key });
    scheduleAnalysis(0);
  };

  const working = phase === "transcribing" || background;
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
        grid={doc?.beat_grid ?? null}
        analysis={analysis}
        chosenKey={doc?.key ?? null}
        onChooseKey={chooseKey}
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
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-2">
          <LoaderCircle size={15} className="animate-spin text-accent" />
          <span className="text-[13px] text-content">{stopping ? "Finishing up" : "Transcribing"}</span>
          <div className="h-1 flex-1 overflow-hidden rounded bg-raised">
            <div ref={fillRef} className="h-full bg-accent" style={{ width: 0 }} />
          </div>
          <span ref={labelRef} className="tabular text-xs text-muted" />
          <Button
            disabled={stopping}
            onClick={() => {
              setStopping(true);
              stop();
            }}
          >
            {stopping ? "Stopping…" : "Stop & keep notes"}
          </Button>
        </div>
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
          <RollToolbar roll={rollRef.current} display={display} onDisplay={setDisplay}>
            {phase === "ready" && !working && (
              <EditControls
                editing={editing}
                snap={snap}
                snapAvailable={Boolean(doc?.beat_grid)}
                scaleLock={scaleLock}
                scaleAvailable={Boolean(analysis?.key)}
                editor={editorRef.current}
                store={storeRef.current}
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
          onMute={(name) => setMuted((m) => toggle(m, name))}
          onSolo={(name) => setSolo((s) => toggle(s, name))}
          onHover={(name) => rollRef.current?.setHighlightedInstrument(name)}
        />
      </div>

      {phase === "idle" && doc && fileRef.current && (
        <Modal
          title="Which instruments play in this song?"
          subtitle="Transcription listens only for the instruments you list. Leave it empty to let the model decide."
        >
          <InstrumentChooser
            doc={doc}
            onHints={(hints) => {
              const next = { ...docRef.current!, hints };
              setDoc(next);
              api.saveProject(next).catch(() => {});
            }}
            renderActions={({ selected, busy }) => (
              <div className="flex justify-end gap-2">
                <Button disabled={busy} onClick={() => run(doc, fileRef.current!, [])}>
                  Let the model decide
                </Button>
                <Button
                  variant="primary"
                  disabled={busy || selected.length === 0}
                  onClick={() => run(doc, fileRef.current!, selected)}
                >
                  {selected.length
                    ? `Transcribe with ${selected.length} instrument${selected.length === 1 ? "" : "s"}`
                    : "Transcribe"}
                </Button>
              </div>
            )}
          />
        </Modal>
      )}

      {showExport && doc && (
        <ExportPanel
          doc={doc}
          notes={storeRef.current?.notes ?? notes}
          names={names}
          chosenKey={doc.key ?? null}
          onClose={() => setShowExport(false)}
        />
      )}

      {redo && doc && (
        <RetranscribeDialog
          doc={doc}
          range={redo === "range" ? range : null}
          noteCount={redo === "range" ? rangeNotes : notes.length}
          onCancel={() => setRedo(null)}
          onStart={(request) => retranscribe(redo === "range" ? range : null, request)}
        />
      )}
    </div>
  );
}
