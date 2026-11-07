import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type ProjectDoc, type ProjectNote } from "../api";
import type { AudioEngine } from "../audio";
import { Button } from "../components/Button";
import { InstrumentPanel } from "../components/InstrumentPanel";
import { PianoRollCanvas } from "../components/PianoRollCanvas";
import { EditControls, RollToolbar } from "../components/RollToolbar";
import { TopBar } from "../components/TopBar";
import { Transport } from "../components/Transport";
import { Autosaver, type SaveState } from "../editor/autosave";
import { NoteStore } from "../editor/noteStore";
import { RollEditor } from "../editor/rollEditor";
import { DEFAULT_CLEANUP, exportMidi, NO_OVERRIDES, saveBlob } from "../export";
import { takeStartRequest, useProjectTranscription } from "../hooks/useProjectTranscription";
import { metronomeClicks } from "../metronome";
import type { BeatGrid, PianoRoll } from "../pianoroll";
import { formatClock, ProgressEstimator } from "../progress";

type Phase = "loading" | "idle" | "transcribing" | "ready";

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

export function Editor({ id, audio }: { id: string; audio: AudioEngine }) {
  const rollRef = useRef<PianoRoll | null>(null);
  const fileRef = useRef<File | null>(null);
  const progressRef = useRef<ProgressEstimator | null>(null);
  const progress = (progressRef.current ??= new ProgressEstimator());
  const fillRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [doc, setDoc] = useState<ProjectDoc | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [liveNames, setLiveNames] = useState<string[]>([]);
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [solo, setSolo] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [userScrolled, setUserScrolled] = useState(false);
  const storeRef = useRef<NoteStore | null>(null);
  const editorRef = useRef<RollEditor | null>(null);
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const saverRef = useRef<Autosaver | null>(null);
  const mounted = useRef(true);
  const [editing, setEditing] = useState(false);
  const [snap, setSnap] = useState(true);
  const [active, setActive] = useState<string | null>(null);
  // Bumped when the editor's selection or history changes, to redraw the toolbar.
  const [, setEditTick] = useState(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

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

  /** Start editing `saved`: one store, followed by the roll and playback. */
  function showProject(saved: ProjectDoc) {
    const store = new NoteStore(saved.notes);
    storeRef.current = store;
    rollRef.current?.setGridLines(saved.beat_grid);
    syncNotes(store, saved.beat_grid);
    const editor = new RollEditor(store, rollRef.current!, audio, () =>
      setEditTick((t) => t + 1),
    );
    editor.setGrid(saved.beat_grid);
    editorRef.current = editor;
    saverRef.current?.close();
    const saver = new Autosaver(
      () => api.saveProject({ ...saved, notes: store.notes }),
      setSaveState,
    );
    saverRef.current = saver;
    store.subscribe(() => {
      syncNotes(store, saved.beat_grid);
      editor.rebuild();
      saver.changed();
    });
  }

  async function run(current: ProjectDoc, file: File) {
    setPhase("transcribing");
    setError(null);
    setLiveNames([]);
    try {
      await api.saveProject({ ...current, status: "transcribing" });
      const outcome = await transcribe(file);
      if (!outcome) {
        await api.saveProject({ ...current, status: "created" });
        return;
      }
      const { notes, stopped } = outcome;
      if (stopped && notes.length === 0) {
        await api.saveProject({ ...current, status: "created" });
        setPhase("idle");
        return;
      }
      let beatGrid = outcome.beatGrid;
      if (stopped) {
        setNotice("Finding the beats");
        beatGrid = await api.beatGrid(current.id, notes.map((n) => n.start));
        setNotice(null);
      }
      const saved = await api.saveProject({
        ...current,
        status: stopped ? "partial" : "completed",
        notes,
        beat_grid: beatGrid,
      });
      // Stopped, then left: the work is saved, but the audio engine and the
      // screen now belong to someone else.
      if (!mounted.current) return;
      showProject(saved);
      setDoc(saved);
      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    }
  }

  useEffect(() => {
    let cancelled = false;
    mounted.current = true;
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
        } else if (takeStartRequest(id)) {
          run(loaded, file);
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
          labelRef.current.textContent = eta == null ? "" : `done in ${formatClock(eta / 1000)}`;
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

  const toggle = (set: Set<string>, name: string) => {
    const next = new Set(set);
    if (!next.delete(name)) next.add(name);
    return next;
  };

  const exportCurrent = useCallback(async () => {
    if (!doc) return;
    const current = storeRef.current?.notes ?? doc.notes;
    setExporting(true);
    setError(null);
    try {
      const blob = await exportMidi(current, doc.beat_grid, NO_OVERRIDES, {
        ...DEFAULT_CLEANUP,
        quantize: false,
        fill_gaps: 0,
      });
      saveBlob(blob, `${doc.name}.mid`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }, [doc]);

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

  return (
    <div className="flex h-screen flex-col bg-bg">
      <TopBar
        title={doc?.name ?? "Loading"}
        model={doc?.model ?? null}
        exporting={exporting}
        saveState={phase === "ready" ? saveState : null}
        onExport={phase === "ready" ? exportCurrent : null}
      />
      <Transport
        audio={audio}
        grid={doc?.beat_grid ?? null}
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

      {phase === "idle" && doc && fileRef.current && (
        <div className="flex items-center gap-3 px-4 pb-3 text-sm text-muted">
          <span>This project has not been transcribed yet.</span>
          <Button onClick={() => run(doc, fileRef.current!)}>Transcribe</Button>
        </div>
      )}

      {phase === "transcribing" && (
        <div className="flex items-center gap-3 px-4 pb-3">
          <div className="h-1 flex-1 overflow-hidden rounded bg-surface-2">
            <div ref={fillRef} className="h-full bg-white" style={{ width: 0 }} />
          </div>
          <span ref={labelRef} className="font-mono text-xs text-muted" />
          <Button onClick={stop}>Stop &amp; keep notes</Button>
        </div>
      )}

      {phase === "ready" && doc?.status === "partial" && (
        <p className="px-4 pb-3 text-sm text-muted">
          Stopped early. This project holds {notes.length.toLocaleString()} notes, up to where
          transcription stopped.
        </p>
      )}

      {(error || notice) && (
        <p role={error ? "alert" : "status"} className="px-4 pb-3 text-sm text-muted">
          {error ?? notice}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <RollToolbar roll={rollRef.current}>
            {phase === "ready" && (
              <EditControls
                editing={editing}
                snap={snap}
                snapAvailable={Boolean(doc?.beat_grid)}
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
              />
            )}
          </RollToolbar>
          <div className="min-h-0 flex-1">
            <PianoRollCanvas
              rollRef={rollRef}
              editorRef={editorRef}
              audio={audio}
              setUserScrolled={setUserScrolled}
            />
          </div>
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
    </div>
  );
}
