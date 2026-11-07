import { useRef, type RefObject } from "react";
import type { ProjectNote } from "../api";
import type { AudioEngine } from "../audio";
import type { BeatGrid, PianoRoll, RollNote } from "../pianoroll";
import type { ProgressEstimator } from "../progress";
import { streamTranscribeWithRetry, TranscribeError } from "../sse";

type StreamedEvent =
  | { type: "start"; pitch: number; start_time: number; index: number; instrument: string }
  | { type: "end"; end_time: number; start_event_index: number }
  | { type: "progress"; completed: number; total: number }
  | { type: "transcription_complete"; beat_grid: BeatGrid | null };

/** Per tab, so the server treats a resubmit here as replacing the last run. */
const CLIENT_ID = crypto.randomUUID();

export type TranscriptionOutcome = {
  notes: ProjectNote[];
  beatGrid: BeatGrid | null;
  /** Stopped early: `notes` holds what finished, and there is no grid yet. */
  stopped: boolean;
};

/**
 * Streams /transcribe into the roll and audio engine as the notes arrive, and
 * resolves with them in streamed time. `stop` ends the run and keeps the finished
 * notes; `abort` drops the run and resolves null.
 */
export function useProjectTranscription(deps: {
  audio: AudioEngine;
  rollRef: RefObject<PianoRoll | null>;
  progress: ProgressEstimator;
  onBusy: () => void;
  onAccepted: () => void;
  onInstrument: (name: string) => void;
}) {
  const active = useRef<AbortController | null>(null);
  const stopping = useRef(false);

  async function transcribe(
    file: File,
    instruments: string[],
    { live = true }: { live?: boolean } = {},
  ): Promise<TranscriptionOutcome | null> {
    const { audio, progress, onBusy, onAccepted, onInstrument } = deps;
    // Not live: a re-transcription leaves the roll and playback alone until done.
    const rollRef = live ? deps.rollRef : { current: null };
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    stopping.current = false;
    const open = new Map<number, RollNote>();
    const notes: ProjectNote[] = [];
    const known = new Set<string>();
    let beatGrid: BeatGrid | null = null;
    let lastEnd = 0;

    progress.reset();
    if (live) audio.unlock().catch(() => {});
    try {
      for await (const raw of streamTranscribeWithRetry("/transcribe", file, {
        extra: {
          ...(instruments.length > 0 ? { instruments } : {}),
          ...(live ? {} : { detect_tempo: "false" }),
        },
        signal: controller.signal,
        clientId: CLIENT_ID,
        onAccepted,
        onBusy,
      })) {
        const ev = raw as StreamedEvent;
        if (ev.type === "progress") {
          progress.onAnchor(ev.completed, ev.total, performance.now());
        } else if (ev.type === "start") {
          if (!known.has(ev.instrument)) {
            known.add(ev.instrument);
            if (live) onInstrument(ev.instrument);
          }
          const note: RollNote = {
            pitch: ev.pitch,
            start: ev.start_time,
            end: ev.start_time,
            instrument: ev.instrument,
          };
          rollRef.current?.addNote(note);
          open.set(ev.index, note);
        } else if (ev.type === "end") {
          const note = open.get(ev.start_event_index);
          if (!note) continue;
          open.delete(ev.start_event_index);
          note.end = ev.end_time;
          lastEnd = Math.max(lastEnd, ev.end_time);
          notes.push({
            id: crypto.randomUUID(),
            instrument: note.instrument,
            pitch: note.pitch,
            start: note.start,
            end: ev.end_time,
          });
          rollRef.current?.setNoteEnd(note, ev.end_time);
          if (live) {
            audio.scheduleNote({
              instrument: note.instrument,
              pitch: note.pitch,
              start: note.start,
              end: ev.end_time,
            });
          }
        } else {
          beatGrid = ev.beat_grid ?? null;
          if (live) {
            rollRef.current?.setBeatGrid(beatGrid);
            audio.shiftNotes(-(beatGrid?.onset_delay ?? 0));
          }
        }
      }
      if (live && lastEnd > 0) audio.scheduleStop(lastEnd + 0.3);
      return { notes, beatGrid, stopped: false };
    } catch (e) {
      // Notes still open have no end yet, so they are left out.
      if (stopping.current) return { notes, beatGrid: null, stopped: true };
      if (controller.signal.aborted) return null;
      if (e instanceof TranscribeError && e.userMessage) throw new Error(e.userMessage);
      throw e;
    } finally {
      if (active.current === controller) active.current = null;
    }
  }

  return {
    transcribe,
    abort: () => active.current?.abort(),
    stop() {
      stopping.current = true;
      active.current?.abort();
    },
  };
}
