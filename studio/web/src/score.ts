import { NO_FRETBOARD, type ChosenKey, type Fretboard, type ProjectDoc, type ProjectNote, type ScoreView, type TabReport } from "./api";

/** OSMD draws 10 pixels to its unit at zoom 1. */
const UNIT_PX = 10;
/** A staff's five lines span four units. */
const STAFF_UNITS = 4;
/** Room above and below the staves for the playhead. */
const PLAYHEAD_PAD = 12;

/** One measure as drawn: where its notes run, across all of its system's staves. */
export type MeasureBox = {
  /** Left of the first note's space, after any clef, key or time signature. */
  x: number;
  width: number;
  /** Width of that clef and signature area, left of `x`. */
  lead: number;
  top: number;
  bottom: number;
};

/** What the score is engraved from. Its meter is the roll's, so the bars match. */
export function scoreRequest(
  doc: ProjectDoc,
  notes: ProjectNote[],
  key: ChosenKey | null,
) {
  const grid = doc.beat_grid;
  const meter = doc.meter ?? grid?.beats_per_bar ?? 4;
  return {
    notes: notes.map(({ instrument, pitch, start, end }) => ({
      instrument,
      pitch,
      start,
      end,
    })),
    beat_grid: grid && {
      ...grid,
      onset_delay: grid.onset_delay ?? 0,
      steady: grid.steady ?? true,
      beats: grid.beats ?? null,
    },
    options: grid
      ? {
          beats_per_bar: meter,
          quantize: true,
          fill_gaps: 0.25,
          trim_leading_bars: false,
        }
      : {},
    key,
    chords: true,
    page: "letter",
    fretboard: fretboardRequest(doc.fretboard),
  };
}

/** The fretboard choice to send: none at all when it asks for nothing. */
export function fretboardRequest(choice: Fretboard | null | undefined): Fretboard | null {
  const fretboard = { ...NO_FRETBOARD, ...choice };
  return fretboard.tab || fretboard.diagrams ? fretboard : null;
}

const PLAYS: Record<Fretboard["tuning"], string> = {
  guitar: "guitar",
  drop_d: "guitar",
  ukulele: "ukulele",
  ukulele_low_g: "ukulele",
};

/** What fitting the tab changed, in words. Empty when nothing changed. */
export function tabNote(report: TabReport | null, tuning: Fretboard["tuning"]): string {
  if (!report || (report.moved === 0 && report.dropped === 0)) return "";
  const parts = [];
  if (report.moved) {
    const notes = report.moved === 1 ? "1 note" : `${report.moved.toLocaleString()} notes`;
    parts.push(`${notes} moved by an octave to fit the ${PLAYS[tuning]}`);
  }
  if (report.dropped) {
    const notes = report.dropped === 1 ? "1 chord note" : `${report.dropped.toLocaleString()} chord notes`;
    parts.push(`${notes} left out so each chord fits one hand`);
  }
  return `Tab: ${parts.join(", ")}.`;
}

/**
 * Part names as the rest of Studio shows them. MuseScore names a part after
 * its sound and its track, as in "Classical Guitar, acoustic guitar"; the
 * track is the instrument the user knows.
 */
export function renamedParts(xml: string): string {
  return xml.replace(
    /<part-name>([^<]*), ([^<,]+)<\/part-name>/g,
    (_, _sound, track: string) => {
      const name = track.trim();
      return `<part-name>${name.charAt(0).toUpperCase()}${name.slice(1)}</part-name>`;
    },
  );
}

type OsmdBox = {
  AbsolutePosition: { x: number; y: number };
  Size: { width: number; height: number };
};
type OsmdMeasure =
  | {
      PositionAndShape: OsmdBox;
      beginInstructionsWidth: number;
      endInstructionsWidth: number;
    }
  | undefined;

/**
 * Each measure's box in pixels, relative to the page OSMD drew. `measureList`
 * is OSMD's `GraphicSheet.MeasureList`: measures, then one entry per staff.
 */
export function measureBoxes(
  measureList: OsmdMeasure[][],
  zoom: number,
): MeasureBox[] {
  const px = UNIT_PX * zoom;
  return measureList.map((staves) => {
    const drawn = staves.filter((m): m is NonNullable<OsmdMeasure> =>
      Boolean(m),
    );
    if (drawn.length === 0)
      return { x: 0, width: 0, lead: 0, top: 0, bottom: 0 };
    const first = drawn[0];
    const { x } = first.PositionAndShape.AbsolutePosition;
    const begin = first.beginInstructionsWidth || 0;
    const end = first.endInstructionsWidth || 0;
    const ys = drawn.map((m) => m.PositionAndShape.AbsolutePosition.y);
    return {
      x: (x + begin) * px,
      lead: begin * px,
      width: Math.max(0, first.PositionAndShape.Size.width - begin - end) * px,
      top: Math.min(...ys) * px - PLAYHEAD_PAD,
      bottom: (Math.max(...ys) + STAFF_UNITS) * px + PLAYHEAD_PAD,
    };
  });
}

/** The measure playing at `time`, or -1 outside the score. */
export function measureAt(
  view: Pick<ScoreView, "measures" | "end">,
  time: number,
): number {
  const { measures, end } = view;
  if (measures.length === 0 || time < measures[0] || time >= end) return -1;
  let lo = 0;
  let hi = measures.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measures[mid] <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const measureEnd = (view: Pick<ScoreView, "measures" | "end">, i: number) =>
  view.measures[i + 1] ?? view.end;

/** Where the playhead goes at `time`, or null outside the score. */
export function positionAt(
  view: Pick<ScoreView, "measures" | "end">,
  boxes: MeasureBox[],
  time: number,
): { x: number; top: number; bottom: number; measure: number } | null {
  const i = measureAt(view, time);
  const box = boxes[i];
  if (i < 0 || !box || box.width === 0) return null;
  const start = view.measures[i];
  const fraction = Math.min(
    1,
    (time - start) / (measureEnd(view, i) - start || 1),
  );
  return {
    x: box.x + fraction * box.width,
    top: box.top,
    bottom: box.bottom,
    measure: i,
  };
}

/** The time under a point on the page, or null when it is in no measure. */
export function timeAt(
  view: Pick<ScoreView, "measures" | "end">,
  boxes: MeasureBox[],
  x: number,
  y: number,
): number | null {
  // Clicks left of a measure's notes, on its clef or signature, mean its start.
  const i = boxes.findIndex(
    (b) =>
      b.width > 0 &&
      y >= b.top &&
      y <= b.bottom &&
      x <= b.x + b.width &&
      x >= b.x - b.lead - 4,
  );
  if (i < 0 || i >= view.measures.length) return null;
  const box = boxes[i];
  const fraction = Math.min(1, Math.max(0, (x - box.x) / box.width));
  const start = view.measures[i];
  return Math.max(0, start + fraction * (measureEnd(view, i) - start));
}

/**
 * Whether loading the score code failed because the page is older than the
 * build on the server: each build renames that file and removes the old one.
 */
export const isStaleBuild = (e: unknown) =>
  e instanceof TypeError &&
  /dynamically imported module|Importing a module script failed/i.test(e.message);

/** The notes playback lets through: a solo silences every other track, else mutes do. */
export function audibleNotes(
  notes: ProjectNote[],
  muted: Set<string>,
  solo: Set<string>,
): ProjectNote[] {
  if (solo.size === 0 && muted.size === 0) return notes;
  return notes.filter((n) => (solo.size > 0 ? solo.has(n.instrument) : !muted.has(n.instrument)));
}

/**
 * A click just above the score, within `reach` pixels of a measure's top, as a
 * click on that measure's top edge. Null when there is none so close.
 */
export function timeAbove(
  view: Pick<ScoreView, "measures" | "end">,
  boxes: MeasureBox[],
  x: number,
  y: number,
  reach: number,
): number | null {
  let nearest: MeasureBox | null = null;
  for (const b of boxes) {
    if (x < b.x - b.lead || x >= b.x + b.width) continue;
    if (b.top <= y || b.top - y > reach) continue;
    if (!nearest || b.top < nearest.top) nearest = b;
  }
  return nearest ? timeAt(view, boxes, x, nearest.top) : null;
}

/**
 * What makes one export's MusicXML differ from another's. The page size only
 * affects PDFs, and the server decides quantizing for sheet music itself.
 */
export function engravingKey(body: { page?: unknown; options: Record<string, unknown> }): string {
  const { page: _page, options, ...rest } = body;
  const { quantize: _quantize, ...kept } = options;
  return JSON.stringify({ ...rest, options: kept });
}

