import { useEffect, useRef, useState, type RefObject } from "react";
import { api, type Analysis, type ChosenKey, type Fretboard, type ProjectDoc, type ProjectNote } from "../api";
import type { AudioEngine } from "../audio";
import { instrumentColor, resetInstrumentColors } from "../colors";
import type { RetranscribeRequest } from "../components/RetranscribeDialog";
import { Autosaver, type SaveState } from "../editor/autosave";
import { replacedSpan, replaceRange } from "../editor/gestures";
import { NoteStore } from "../editor/noteStore";
import { RollEditor } from "../editor/rollEditor";
import { metronomeClicks } from "../metronome";
import type { BeatGrid, PianoRoll } from "../pianoroll";
import type { ProgressEstimator } from "../progress";
import { useProjectTranscription } from "./useProjectTranscription";

export type Phase = "loading" | "idle" | "transcribing" | "ready";
export type Range = { start: number; end: number };

/** After an edit, wait this long for the next one before renaming chords. */
const ANALYSIS_DELAY_MS = 600;

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

/** The beat grid with the user's meter, if they chose one. */
export function gridWithMeter(doc: ProjectDoc | null): BeatGrid | null {
  const grid = doc?.beat_grid ?? null;
  return grid && doc?.meter ? { ...grid, beats_per_bar: doc.meter } : grid;
}

/** One project: loading it, transcribing it, its notes, and keeping it saved. */
export function useProject(deps: {
  id: string;
  audio: AudioEngine;
  rollRef: RefObject<PianoRoll | null>;
  progress: ProgressEstimator;
  onRedraw: () => void;
}) {
  const { id, audio, rollRef, progress, onRedraw } = deps;
  const fileRef = useRef<File | null>(null);
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
  const [stopping, setStopping] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("saved");

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

  /** Make the roll and playback show the store's notes, on the project's bars. */
  function syncNotes(store: NoteStore) {
    const current = docRef.current;
    const shown = displayNotes(store.notes, current?.beat_grid ?? null);
    const last = shown.reduce((end, n) => Math.max(end, n.end), 0);
    rollRef.current?.setNotes(shown);
    audio.replaceNotes(
      shown,
      last > 0 ? last + 0.3 : null,
      metronomeClicks(gridWithMeter(current), Math.max(audio.duration, last)),
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
    rollRef.current?.setGridLines(gridWithMeter(saved));
    syncNotes(store);
    // A live transcription leaves the view at its end.
    rollRef.current?.showStart();
    const editor = new RollEditor(store, rollRef.current!, audio, onRedraw);
    editor.setGrid(saved.beat_grid);
    editorRef.current = editor;
    saverRef.current?.close();
    const saver = new Autosaver(
      () => api.saveProject({ ...docRef.current!, notes: store.notes }),
      setSaveState,
    );
    saverRef.current = saver;
    store.subscribe(() => {
      syncNotes(store);
      editor.rebuild();
      saver.changed();
      scheduleAnalysis(ANALYSIS_DELAY_MS);
    });
    scheduleAnalysis(0);
  }

  async function transcribeProject(project: ProjectDoc, file: File, hints: string[]) {
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
    setBackground(true);
    setStopping(false);
    setError(null);
    try {
      await api.ensureModel({ ...current, hints, model }, () =>
        setNotice(`Loading the ${model} model. This can take a minute.`),
      );
      setNotice(null);
      const delay = current.beat_grid?.onset_delay ?? 0;
      const file = target ? await api.audioRange(current.id, target) : fileRef.current!;
      const outcome = await transcribe(file, hints, { live: false });
      if (!outcome || !mounted.current) return;
      const found = outcome.notes
        .map((n) => ({
          ...n,
          start: n.start + (target?.start ?? 0),
          end: n.end + (target?.start ?? 0),
        }))
        .filter((n) => !target || n.start < target.end + delay);
      if (outcome.stopped && found.length === 0) return;
      const { from, to } = replacedSpan(found, target, delay, outcome.stopped);
      store.apply(replaceRange(store.notes, found, from, to));
      // Only now: a run that failed leaves the project as it was.
      updateDoc({ hints, model });
      // Don't make this much work wait for the autosave delay.
      void saverRef.current?.flush();
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
    // The functions above read refs and props stable for this keyed screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, audio]);

  const chooseKey = (key: ChosenKey | null) => {
    updateDoc({ key });
    scheduleAnalysis(0);
  };

  /** Rebar the roll and metronome. Notes and their times stay as they are. */
  const chooseMeter = (meter: number | null) => {
    updateDoc({ meter });
    rollRef.current?.setGridLines(gridWithMeter(docRef.current));
    if (storeRef.current) syncNotes(storeRef.current);
  };

  /** Tab and chord diagram choices. The score follows; notes stay as they are. */
  const chooseFretboard = (fretboard: Fretboard | null) => {
    updateDoc({ fretboard });
  };

  /** Save a list of instruments for a project still waiting to be transcribed. */
  const saveHints = (hints: string[]) => {
    const next = { ...docRef.current!, hints };
    setDoc(next);
    api.saveProject(next).catch(() => {});
  };

  return {
    doc,
    phase,
    working: phase === "transcribing" || background,
    notes,
    liveNames,
    analysis,
    saveState,
    error,
    notice,
    stopping,
    file: fileRef,
    store: storeRef,
    editor: editorRef,
    transcribeProject,
    retranscribe,
    chooseKey,
    chooseMeter,
    chooseFretboard,
    saveHints,
    stop() {
      setStopping(true);
      stop();
    },
  };
}
