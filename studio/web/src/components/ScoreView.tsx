import { LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  api,
  type ChosenKey,
  type ProjectDoc,
  type ProjectNote,
  type ScoreView as View,
} from "../api";
import type { AudioEngine } from "../audio";
import {
  measureBoxes,
  positionAt,
  renamedParts,
  scoreRequest,
  timeAt,
  type MeasureBox,
} from "../score";
import { Button } from "./ui";

/** After an edit, wait this long for the next one before engraving again. */
const REFRESH_DELAY_MS = 1500;
/** The playing system sits this far below the top when Follow scrolls to it. */
const FOLLOW_MARGIN = 48;

type Drawn = { view: View; boxes: MeasureBox[]; page: HTMLElement };

function surface(): string {
  const ink = getComputedStyle(document.documentElement)
    .getPropertyValue("--color-ink")
    .trim();
  return ink || "#12151c";
}

/** Engrave `view` into `host`, which must be laid out at its final width. */
async function draw(host: HTMLElement, view: View): Promise<MeasureBox[]> {
  // Loaded only when the score is first shown, so the roll doesn't wait for it.
  const { OpenSheetMusicDisplay } = await import("opensheetmusicdisplay");
  const osmd = new OpenSheetMusicDisplay(host, {
    autoResize: false,
    backend: "svg",
    darkMode: true,
    pageBackgroundColor: surface(),
    drawTitle: false,
    drawSubtitle: false,
    drawComposer: false,
    drawCredits: false,
    drawingParameters: "compact",
  });
  await osmd.load(renamedParts(view.musicxml));
  osmd.render();
  const svg = host.querySelector("svg");
  const offsetX = svg
    ? svg.getBoundingClientRect().left - host.getBoundingClientRect().left
    : 0;
  const offsetY = svg
    ? svg.getBoundingClientRect().top - host.getBoundingClientRect().top
    : 0;
  return measureBoxes(osmd.GraphicSheet.MeasureList as never, osmd.Zoom).map(
    (b) => ({
      ...b,
      x: b.x + offsetX,
      top: b.top + offsetY,
      bottom: b.bottom + offsetY,
    }),
  );
}

/** The notes as sheet music, with a playhead. Engraves again after changes. */
export function ScoreView(props: {
  doc: ProjectDoc;
  notes: ProjectNote[];
  chosenKey: ChosenKey | null;
  audio: AudioEngine;
  visible: boolean;
  following: boolean;
  onUserScroll: () => void;
}) {
  const { doc, notes, chosenKey, audio, visible, following, onUserScroll } =
    props;
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const drawn = useRef<Drawn | null>(null);
  const run = useRef(0);
  const lastMeasure = useRef(-1);
  const followRef = useRef(following);
  followRef.current = following;

  const [state, setState] = useState<"idle" | "engraving" | "ready" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [hasScore, setHasScore] = useState(false);
  // What the shown score was engraved from, and what it should be.
  const wanted = {
    notes,
    key: chosenKey,
    meter: doc.meter ?? null,
    grid: doc.beat_grid,
  };
  const [engraved, setEngraved] = useState<typeof wanted | null>(null);
  const stale =
    !engraved ||
    engraved.notes !== wanted.notes ||
    engraved.key !== wanted.key ||
    engraved.meter !== wanted.meter ||
    engraved.grid !== wanted.grid;
  const latest = useRef(wanted);
  latest.current = wanted;
  const latestDoc = useRef(doc);
  latestDoc.current = doc;

  async function engrave() {
    const source = latest.current;
    const id = ++run.current;
    if (source.notes.length === 0) {
      drawn.current?.page.remove();
      drawn.current = null;
      setHasScore(false);
      setEngraved(source);
      setState("ready");
      return;
    }
    setState("engraving");
    setError(null);
    try {
      const view = await api.scoreView(
        scoreRequest(latestDoc.current, source.notes, source.key),
      );
      if (id !== run.current || !content.current) return;
      // Drawn off to the side at full width, so the old score stays up until
      // the new one is ready.
      const page = document.createElement("div");
      page.className = "score-page";
      page.style.cssText =
        "position:absolute;inset:0 0 auto 0;visibility:hidden";
      content.current.appendChild(page);
      let boxes: MeasureBox[];
      try {
        boxes = await draw(page, view);
      } catch (e) {
        page.remove();
        throw e;
      }
      if (id !== run.current) {
        page.remove();
        return;
      }
      drawn.current?.page.remove();
      page.style.cssText = "";
      drawn.current = { view, boxes, page };
      lastMeasure.current = -1;
      setHasScore(true);
      setEngraved(source);
      setState("ready");
    } catch (e) {
      if (id !== run.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }

  // Engrave when shown out of date: at once the first time, after a pause on edits.
  useEffect(() => {
    if (!visible || !stale) return;
    const wait = engraved && hasScore ? REFRESH_DELAY_MS : 0;
    const timer = setTimeout(() => void engrave(), wait);
    return () => clearTimeout(timer);
    // `engrave` reads the latest inputs through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, stale, notes, chosenKey, doc.meter, doc.beat_grid]);

  // A result still on its way no longer counts once the screen goes.
  useEffect(() => () => void ++run.current, []);

  // The playhead, and the view following it.
  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const line = playhead.current;
      const score = drawn.current;
      if (!line) return;
      const at = score
        ? positionAt(score.view, score.boxes, audio.seconds)
        : null;
      if (!at) {
        line.style.display = "none";
        return;
      }
      line.style.display = "block";
      line.style.transform = `translate(${at.x}px, ${at.top}px)`;
      line.style.height = `${at.bottom - at.top}px`;
      const view = scroller.current;
      if (view && followRef.current && at.measure !== lastMeasure.current) {
        const above = at.top < view.scrollTop;
        const below = at.bottom > view.scrollTop + view.clientHeight;
        if (above || below)
          view.scrollTop = Math.max(0, at.top - FOLLOW_MARGIN);
      }
      lastMeasure.current = at.measure;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [audio, visible]);

  // Follow turned back on: show where the music is.
  useEffect(() => {
    if (following) lastMeasure.current = -1;
  }, [following]);

  const seek = (e: React.MouseEvent) => {
    const score = drawn.current;
    const box = content.current?.getBoundingClientRect();
    if (!score || !box) return;
    const time = timeAt(
      score.view,
      score.boxes,
      e.clientX - box.left,
      e.clientY - box.top,
    );
    if (time === null) return;
    audio.seek(Math.min(time, audio.duration || time));
    lastMeasure.current = -1;
  };

  const busy = state === "engraving";
  return (
    <div className="absolute inset-0 flex flex-col bg-ink" hidden={!visible}>
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-line px-3">
        <span
          role="status"
          className="flex items-center gap-2 text-[13px] text-muted"
        >
          {busy && (
            <LoaderCircle size={14} className="animate-spin text-accent" />
          )}
          {busy
            ? hasScore
              ? "Updating the score"
              : "Engraving the score. Long songs take a few seconds."
            : stale && hasScore
              ? "Out of date. Updating after your edits."
              : hasScore
                ? "Click a measure to play from there."
                : ""}
        </span>
        <Button
          className="ml-auto"
          disabled={busy || notes.length === 0}
          onClick={() => void engrave()}
        >
          <RefreshCw size={14} />
          Refresh
        </Button>
      </div>
      {error && (
        <p
          role="alert"
          className="shrink-0 border-b border-line px-3 py-2 text-[13px] text-danger"
        >
          The score could not be made. {error}
        </p>
      )}
      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-auto"
        onWheel={onUserScroll}
        onPointerDown={(e) => {
          // The scrollbar, not the score.
          if (e.target === e.currentTarget) onUserScroll();
        }}
      >
        {notes.length === 0 && (
          <p className="px-6 py-10 text-[13px] text-muted">
            There are no notes to show yet. The score appears here once the song
            has notes.
          </p>
        )}
        <div
          ref={content}
          className={
            busy && hasScore
              ? "relative cursor-pointer opacity-60"
              : "relative cursor-pointer"
          }
          onClick={seek}
        >
          <div
            ref={playhead}
            aria-hidden
            className="pointer-events-none absolute top-0 left-0 z-10 w-0.5 rounded-full bg-accent"
            style={{ display: "none" }}
          />
        </div>
      </div>
    </div>
  );
}
