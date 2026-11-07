import { useEffect, useRef, useState } from "react";
import { api, type ProjectDoc } from "../api";
import type { AudioEngine } from "../audio";
import { Button } from "../components/Button";
import { PianoRollCanvas } from "../components/PianoRollCanvas";
import { takeStartRequest, useProjectTranscription } from "../hooks/useProjectTranscription";
import type { PianoRoll } from "../pianoroll";
import { formatClock, ProgressEstimator } from "../progress";

type Phase = "loading" | "idle" | "transcribing" | "ready";

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
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const [, setUserScrolled] = useState(false);

  const { transcribe, abort, stop } = useProjectTranscription({
    audio,
    rollRef,
    progress,
    onBusy: () => setNotice("The server is busy. Trying again shortly."),
    onAccepted: () => setNotice(null),
    onInstrument: () => {},
  });

  function loadSaved(saved: ProjectDoc) {
    const roll = rollRef.current!;
    for (const n of saved.notes) {
      const note = { pitch: n.pitch, start: n.start, end: n.start, instrument: n.instrument };
      roll.addNote(note);
      roll.setNoteEnd(note, n.end);
      audio.scheduleNote({ ...note, end: n.end });
    }
    // Both move the streamed times by the onset delay.
    roll.setBeatGrid(saved.beat_grid);
    audio.shiftNotes(-(saved.beat_grid?.onset_delay ?? 0));
    const last = saved.notes.reduce((end, n) => Math.max(end, n.end), 0);
    if (last > 0) audio.scheduleStop(last + 0.3);
  }

  async function run(current: ProjectDoc, file: File) {
    setPhase("transcribing");
    setError(null);
    try {
      await api.saveProject({ ...current, status: "transcribing" });
      const outcome = await transcribe(file);
      if (!outcome) return;
      const { notes, stopped } = outcome;
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
      if (stopped) {
        // Rebuild from what was kept: the roll still holds unfinished notes.
        audio.reset();
        rollRef.current?.clear();
        audio.loadWav(file).catch(() => {});
        loadSaved(saved);
      }
      setDoc(saved);
      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    }
  }

  useEffect(() => {
    let cancelled = false;
    audio.reset();
    rollRef.current?.clear();
    (async () => {
      try {
        const loaded = await api.getProject(id);
        const file = await api.audioFile(loaded);
        if (cancelled) return;
        fileRef.current = file;
        setDoc(loaded);
        audio.loadWav(file).catch(() => {});
        if (loaded.status === "completed" || loaded.status === "partial") {
          loadSaved(loaded);
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
      abort();
      audio.reset();
    };
    // `run` and `loadSaved` read refs and props stable for this keyed screen.
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

  return (
    <div className="flex h-screen flex-col bg-bg">
      <header className="flex items-center gap-3 px-4 py-3">
        <a href="#/new" aria-label="Back" className="text-muted hover:text-content">
          ←
        </a>
        <h1 className="truncate text-base font-medium text-content">{doc?.name ?? "Loading"}</h1>
        {doc?.model && <span className="text-xs text-muted">{doc.model} model</span>}
        {phase === "idle" && doc && fileRef.current && (
          <Button className="ml-auto" onClick={() => run(doc, fileRef.current!)}>
            Transcribe
          </Button>
        )}
      </header>

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
          Stopped early. This project holds {doc.notes.length.toLocaleString()} notes, up to where
          transcription stopped.
        </p>
      )}

      {(error || notice) && (
        <p role={error ? "alert" : "status"} className="px-4 pb-3 text-sm text-muted">
          {error ?? notice}
        </p>
      )}

      <div className="min-h-0 flex-1">
        <PianoRollCanvas rollRef={rollRef} audio={audio} setUserScrolled={setUserScrolled} />
      </div>
    </div>
  );
}
