/** Where the mouse lands on a note decides what a drag does. */
export type NoteZone = "body" | "left" | "right";
export type NoteHit = { noteId: string; zone: NoteZone };

/** A note in display time. */
export type RollRect = { id: string; instrument: string; pitch: number; start: number; end: number };

/** How the roll maps time and pitch to pixels at this moment. */
export type RollView = {
  /** Pixels of keyboard to the left of time 0's column. */
  keyWidth: number;
  /** Seconds at the note area's left edge. */
  offsetSec: number;
  pxPerSec: number;
  /** Pitch whose row starts at y = 0. Fractional when pitch-zoomed. */
  pitchTop: number;
  rowH: number;
};

const EDGE_PX = 6;
const BUCKET_SEC = 2;

/** Notes sorted into fixed time buckets, so a hit test only reads nearby notes. */
export class NoteIndex {
  private buckets = new Map<number, RollRect[]>();

  constructor(notes: RollRect[]) {
    for (const n of notes) {
      const first = Math.floor(n.start / BUCKET_SEC);
      const last = Math.floor(n.end / BUCKET_SEC);
      for (let b = first; b <= last; b++) {
        const bucket = this.buckets.get(b);
        if (bucket) bucket.push(n);
        else this.buckets.set(b, [n]);
      }
    }
  }

  /** Notes overlapping `[from, to]`. A note may appear more than once. */
  *inRange(from: number, to: number): Generator<RollRect> {
    const last = Math.floor(to / BUCKET_SEC);
    for (let b = Math.floor(from / BUCKET_SEC); b <= last; b++) {
      for (const n of this.buckets.get(b) ?? []) yield n;
    }
  }
}

export const timeAtX = (x: number, v: RollView) => (x - v.keyWidth) / v.pxPerSec + v.offsetSec;
export const xAtTime = (t: number, v: RollView) => v.keyWidth + (t - v.offsetSec) * v.pxPerSec;
export const pitchAtY = (y: number, v: RollView) => Math.ceil(v.pitchTop - y / v.rowH);

/**
 * The note under (x, y), or null. Only notes of `instrument` count, because the
 * others are dimmed and not editable. When notes overlap, the one drawn last
 * wins, as it is on top.
 */
export function hitTest(
  x: number,
  y: number,
  index: NoteIndex,
  view: RollView,
  instrument: string | null,
): NoteHit | null {
  const pitch = pitchAtY(y, view);
  const t = timeAtX(x, view);
  const slack = EDGE_PX / view.pxPerSec;
  let found: RollRect | null = null;
  for (const n of index.inRange(t - slack, t + slack)) {
    if (n.pitch !== pitch) continue;
    if (instrument !== null && n.instrument !== instrument) continue;
    if (xAtTime(n.start, view) - 1 > x) continue;
    // Thin notes still get a grabbable width, as they are drawn at least 2 px.
    if (Math.max(xAtTime(n.end, view), xAtTime(n.start, view) + 4) < x) continue;
    found = n;
  }
  if (!found) return null;
  const left = xAtTime(found.start, view);
  const right = Math.max(xAtTime(found.end, view), left + 4);
  // Leave the middle for moving, however short the note.
  const edge = Math.min(EDGE_PX, (right - left) / 3);
  if (x - left <= edge) return { noteId: found.id, zone: "left" };
  if (right - x <= edge) return { noteId: found.id, zone: "right" };
  return { noteId: found.id, zone: "body" };
}

/** Ids of notes touching a rectangle given in time and pitch. */
export function notesInBox(
  box: { fromTime: number; toTime: number; lowPitch: number; highPitch: number },
  index: NoteIndex,
  instrument: string | null,
): Set<string> {
  const ids = new Set<string>();
  for (const n of index.inRange(box.fromTime, box.toTime)) {
    if (instrument !== null && n.instrument !== instrument) continue;
    if (n.pitch < box.lowPitch || n.pitch > box.highPitch) continue;
    if (n.end < box.fromTime || n.start > box.toTime) continue;
    ids.add(n.id);
  }
  return ids;
}
