import { LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  api,
  type ChosenKey,
  type Fretboard,
  type ProjectDoc,
  type ProjectNote,
  type ScoreView as View,
} from "../api";
import type { AudioEngine } from "../audio";
import { DIAGRAM_GAP, diagramSize, diagramSvg } from "../chordDiagram";
import {
  fretboardRequest,
  isStaleBuild,
  measureBoxes,
  positionAt,
  renamedParts,
  scoreRequest,
  tabNote,
  timeAbove,
  timeAt,
  type MeasureBox,
} from "../score";
import { ScoreOptions } from "./ScoreOptions";
import { Button } from "./ui";

/** After an edit, wait this long for the next one before engraving again. */
const REFRESH_DELAY_MS = 1500;
/** The longest the first score waits for the key the transport shows. */
const KEY_WAIT_MS = 3000;
/** The playing system sits this far below the top when Follow scrolls to it. */
const FOLLOW_MARGIN = 48;

/** Where a chord diagram is drawn, in pixels from the top left of the score. */
type DiagramArea = { x: number; y: number; width: number; height: number };

type Drawn = {
  view: View;
  boxes: MeasureBox[];
  page: HTMLElement;
  /** How far above a staff its chord diagrams reach, in pixels. */
  reach: number;
  diagrams: DiagramArea[];
};
type Source = {
  notes: ProjectNote[];
  key: string;
  meter: number | null;
  grid: ProjectDoc["beat_grid"];
  /** The fretboard request, as text, so equal choices compare equal. */
  fretboard: string;
};

const keyId = (key: ChosenKey | null) => (key ? `${key.tonic} ${key.mode}` : "");
const sameSource = (a: Source | null, b: Source) =>
  a !== null &&
  a.notes === b.notes &&
  a.key === b.key &&
  a.meter === b.meter &&
  a.grid === b.grid &&
  a.fretboard === b.fretboard;

function surface(): string {
  const ink = getComputedStyle(document.documentElement)
    .getPropertyValue("--color-ink")
    .trim();
  return ink || "#12151c";
}

type Sky = { getSkyLineMinForLabel(left: number, right: number): number };
/** How far above the top of a diagram's measure its high notes can reach, in OSMD units. */
const DIAGRAM_REACH = 8;
/** Extra width read from the skyline on each side of a diagram, in OSMD units. */
const SKY_MARGIN = 0.8;
type Line = { origin: { x: number; y: number }; sky: Sky };
type ChordSpot = { x: number; line: Line };

/** Each chord symbol's centre and staff line, in score order. OSMD units. */
function chordSpots(measureList: unknown): ChordSpot[] {
  type Point = { x: number; y: number };
  type Box = { AbsolutePosition: Point; BorderLeft: number; BorderRight: number };
  type Entry = { graphicalChordContainers?: { GraphicalLabel: { PositionAndShape: Box } }[] };
  type Measure = {
    staffEntries: Entry[];
    ParentStaffLine: { PositionAndShape: { AbsolutePosition: Point }; SkyBottomLineCalculator: Sky };
  };
  const found: ChordSpot[] = [];
  for (const staves of measureList as (Measure | undefined)[][]) {
    for (const measure of staves) {
      if (!measure) continue;
      const staffLine = measure.ParentStaffLine;
      const line = { origin: staffLine.PositionAndShape.AbsolutePosition, sky: staffLine.SkyBottomLineCalculator };
      for (const entry of measure.staffEntries) {
        for (const chord of entry.graphicalChordContainers ?? []) {
          const box = chord.GraphicalLabel.PositionAndShape;
          const x = box.AbsolutePosition.x + (box.BorderLeft + box.BorderRight) / 2;
          found.push({ x, line });
        }
      }
    }
  }
  return found;
}

/** Chord diagrams above their chord names, drawn over the score. */
function drawDiagrams(
  host: HTMLElement,
  view: View,
  spots: ChordSpot[],
  zoom: number,
  at: { x: number; y: number },
): DiagramArea[] {
  const shapes = view.diagrams;
  // Paired by order: if OSMD drew a different number of chord symbols, the
  // pairs would be wrong, so none are drawn.
  if (!shapes || shapes.length !== spots.length) return [];
  const areas: DiagramArea[] = [];
  const unit = 10 * zoom;
  const ink = getComputedStyle(document.documentElement).getPropertyValue("--color-content").trim() || "#e6e8ee";
  // Chords a beat apart can sit closer than a diagram is wide: a crowded
  // diagram moves right just far enough to clear the one before it.
  let previous: { line: Line; right: number } | null = null;
  const parts = shapes.map((shape, i) => {
    if (!shape) return "";
    const size = diagramSize(shape.frets.length);
    let left = spots[i].x - size.width / 2;
    const line = spots[i].line;
    if (previous && previous.line.sky === line.sky) left = Math.max(left, previous.right + DIAGRAM_GAP * 2);
    previous = { line, right: left + size.width };
    // On top of everything its staff draws across its width, chord names
    // included; a little wider than the diagram, as the skyline is sampled.
    const from = left - line.origin.x - SKY_MARGIN;
    const sky = line.origin.y + line.sky.getSkyLineMinForLabel(from, from + size.width + 2 * SKY_MARGIN);
    const x = at.x + left * unit;
    const y = at.y + (sky - DIAGRAM_GAP - size.height) * unit;
    areas.push({ x, y, width: size.width * unit, height: size.height * unit });
    return `<g class="chord-diagram">${diagramSvg(shape, x, y, unit, ink)}</g>`;
  });
  const layer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  layer.setAttribute("class", "chord-diagrams");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none";
  layer.innerHTML = parts.join("");
  host.appendChild(layer);
  return areas;
}

/** Engrave `view` into `host`, which must be laid out at its final width. */
async function draw(
  host: HTMLElement,
  view: View,
): Promise<{ boxes: MeasureBox[]; reach: number; diagrams: DiagramArea[] }> {
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
    // A run of empty bars drawn as one would leave the rest without a box,
    // so the playhead and clicks couldn't follow time through it.
    autoGenerateMultipleRestMeasuresFromRestMeasures: false,
  });
  await osmd.load(renamedParts(view.musicxml));
  const strings = view.diagrams?.find(Boolean)?.frets.length ?? 6;
  const size = diagramSize(strings);
  if (view.diagrams) {
    // Each diagram sits above whatever its staff draws across its width, so
    // the staff or system above must keep that much more distance. Chord
    // names sit a diagram's width apart, so neighbouring diagrams don't meet.
    const rules = osmd.EngravingRules;
    const room = size.height + DIAGRAM_GAP;
    rules.ChordSymbolXSpacing = Math.max(rules.ChordSymbolXSpacing, size.width + 1);
    rules.MinSkyBottomDistBetweenSystems += room;
    // Chords are on the first pitched part: below another part only when the
    // score starts with drums.
    const firstPart = /<part [^>]*>[\s\S]*?<\/part>/.exec(view.musicxml)?.[0] ?? "";
    if (firstPart.includes("<unpitched")) rules.MinSkyBottomDistBetweenStaves += room;
  }
  osmd.render();
  const svg = host.querySelector("svg");
  const offsetX = svg
    ? svg.getBoundingClientRect().left - host.getBoundingClientRect().left
    : 0;
  const offsetY = svg
    ? svg.getBoundingClientRect().top - host.getBoundingClientRect().top
    : 0;
  const diagrams = view.diagrams
    ? drawDiagrams(host, view, chordSpots(osmd.GraphicSheet.MeasureList), osmd.Zoom, { x: offsetX, y: offsetY })
    : [];
  const boxes = measureBoxes(osmd.GraphicSheet.MeasureList as never, osmd.Zoom).map(
    (b) => ({
      ...b,
      x: b.x + offsetX,
      top: b.top + offsetY,
      bottom: b.bottom + offsetY,
    }),
  );
  // Diagrams can sit well above their staff, over high notes and the chord name.
  const reach = view.diagrams ? (size.height + 2 * DIAGRAM_GAP + DIAGRAM_REACH) * 10 * osmd.Zoom : 0;
  return { boxes, reach, diagrams };
}

/** The notes as sheet music, with a playhead. Engraves again after changes. */
export function ScoreView(props: {
  doc: ProjectDoc;
  /** The audible notes: muted tracks are left out. */
  notes: ProjectNote[];
  /** True when the song has notes but every track is muted. */
  silenced: boolean;
  /** The key in use, chosen or detected, so the score agrees with the transport. */
  keyInUse: ChosenKey | null;
  /** False until the key in use is known, so the first score isn't engraved twice. */
  keyReady: boolean;
  audio: AudioEngine;
  visible: boolean;
  following: boolean;
  onUserScroll: () => void;
  /** Pitched tracks that can take tab, most notes first. */
  tracks: string[];
  /** Tracks silenced by a mute or by another track's solo. */
  muted: string[];
  onFretboard: (next: Fretboard) => void;
}) {
  const { doc, notes, silenced, keyInUse, keyReady, audio, visible, following } = props;
  const { onUserScroll, tracks, muted, onFretboard } = props;
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
  const [staleBuild, setStaleBuild] = useState(false);
  const [hasScore, setHasScore] = useState(false);
  // What fitting the tab changed, for the shown score.
  const [tabText, setTabText] = useState("");
  // What the shown score was engraved from, and what it should be.
  const wanted: Source = {
    notes,
    key: keyId(keyInUse),
    meter: doc.meter ?? null,
    grid: doc.beat_grid,
    fretboard: JSON.stringify(fretboardRequest(doc.fretboard)),
  };
  const [engraved, setEngraved] = useState<Source | null>(null);
  const stale = !sameSource(engraved, wanted);
  const latest = useRef(wanted);
  latest.current = wanted;
  const latestDoc = useRef(doc);
  latestDoc.current = doc;
  const latestKey = useRef(keyInUse);
  latestKey.current = keyInUse;
  // What MuseScore is working on now, so the same request isn't sent twice.
  const inFlight = useRef<Source | null>(null);

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
    inFlight.current = source;
    try {
      const view = await api.scoreView(
        scoreRequest(latestDoc.current, source.notes, latestKey.current),
      );
      if (id !== run.current || !content.current) return;
      // Drawn off to the side at full width, so the old score stays up until
      // the new one is ready.
      const page = document.createElement("div");
      page.className = "score-page";
      page.style.cssText =
        "position:absolute;inset:0 0 auto 0;visibility:hidden";
      content.current.appendChild(page);
      let drawnPage: { boxes: MeasureBox[]; reach: number; diagrams: DiagramArea[] };
      try {
        drawnPage = await draw(page, view);
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
      drawn.current = { view, page, ...drawnPage };
      lastMeasure.current = -1;
      setHasScore(true);
      setTabText(tabNote(view.tab, latestDoc.current.fretboard?.tuning ?? "guitar"));
      setEngraved(source);
      setState("ready");
    } catch (e) {
      if (id !== run.current) return;
      setStaleBuild(isStaleBuild(e));
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    } finally {
      if (id === run.current) inFlight.current = null;
    }
  }

  // Engrave when shown out of date: at once the first time, after a pause on edits.
  useEffect(() => {
    if (!visible || !stale) return;
    if (sameSource(inFlight.current, wanted)) return;
    // Wait a little for the key, but not for ever: if naming it fails, the
    // server finds its own.
    const wait = !keyReady ? KEY_WAIT_MS : engraved && hasScore ? REFRESH_DELAY_MS : 0;
    const timer = setTimeout(() => void engrave(), wait);
    return () => clearTimeout(timer);
    // `engrave` reads the latest inputs through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, stale, keyReady, notes, wanted.key, doc.meter, doc.beat_grid, wanted.fretboard]);

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
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    // Chord diagrams sit above their staff: a click on one counts as a click
    // on the measure under it.
    const onDiagram = score.diagrams.some((d) => x >= d.x && x <= d.x + d.width && y >= d.y && y <= d.y + d.height);
    const time =
      timeAt(score.view, score.boxes, x, y) ?? (onDiagram ? timeAbove(score.view, score.boxes, x, y, score.reach) : null);
    if (time === null) return;
    audio.seek(Math.min(time, audio.duration || time));
    lastMeasure.current = -1;
  };

  const busy = state === "engraving";
  return (
    // Hidden by visibility, not display, so a score arriving meanwhile is
    // still laid out at its real width.
    <div
      className={
        visible
          ? "absolute inset-0 flex flex-col bg-ink"
          : "pointer-events-none invisible absolute inset-0 flex flex-col bg-ink"
      }
      aria-hidden={!visible}
    >
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-line px-3">
        <span
          role="status"
          className="flex min-w-0 flex-1 items-center gap-2 truncate text-[13px] text-muted"
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
                : notes.length > 0
                  ? "Finding the key first."
                  : ""}
          {hasScore && !stale && !busy && tabText && (
            <span className="truncate text-faint">{tabText}</span>
          )}
        </span>
        <ScoreOptions value={doc.fretboard} tracks={tracks} muted={muted} onChange={onFretboard} />
        <Button
          disabled={busy || notes.length === 0}
          onClick={() => void engrave()}
        >
          <RefreshCw size={14} />
          Refresh
        </Button>
      </div>
      {error &&
        (staleBuild ? (
          <p
            role="alert"
            className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-2 text-[13px] text-content"
          >
            Studio was updated after this page opened. Reload the page to show
            the score.
            <Button onClick={() => location.reload()}>Reload</Button>
          </p>
        ) : (
          <p
            role="alert"
            className="shrink-0 border-b border-line px-3 py-2 text-[13px] text-danger"
          >
            The score could not be made. {error}
          </p>
        ))}
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
            {silenced
              ? "Every track is muted, so the score is empty."
              : "There are no notes to show yet. The score appears here once the song has notes."}
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
