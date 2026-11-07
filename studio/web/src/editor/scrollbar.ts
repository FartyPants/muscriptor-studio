/** The smallest thumb still easy to grab, in pixels. */
export const MIN_THUMB_PX = 28;

export type ScrollState = {
  /** Seconds at the view's left edge. */
  offsetSec: number;
  /** Seconds the view shows. */
  viewSec: number;
  /** Seconds of content. */
  totalSec: number;
};

/** The thumb's left edge and width on a track `trackPx` wide. */
export function thumbGeometry(state: ScrollState, trackPx: number): { left: number; width: number } {
  const { offsetSec, viewSec, totalSec } = state;
  if (totalSec <= viewSec || trackPx <= 0) return { left: 0, width: trackPx };
  const width = Math.min(trackPx, Math.max(MIN_THUMB_PX, (viewSec / totalSec) * trackPx));
  const travel = trackPx - width;
  const fraction = offsetSec / (totalSec - viewSec);
  return { left: Math.min(travel, Math.max(0, fraction * travel)), width };
}

/** The view offset that puts the thumb's left edge at `left`. */
export function offsetAtThumb(left: number, state: ScrollState, trackPx: number): number {
  const { viewSec, totalSec } = state;
  const { width } = thumbGeometry(state, trackPx);
  const travel = trackPx - width;
  if (travel <= 0) return 0;
  const fraction = Math.min(1, Math.max(0, left / travel));
  return fraction * (totalSec - viewSec);
}
