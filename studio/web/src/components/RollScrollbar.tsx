import { useEffect, useRef, type PointerEvent, type RefObject } from "react";
import { offsetAtThumb, thumbGeometry } from "../editor/scrollbar";
import { KEY_WIDTH, type PianoRoll } from "../pianoroll";

/** Horizontal scrollbar for the roll, lined up with its note area. */
export function RollScrollbar(props: {
  rollRef: RefObject<PianoRoll | null>;
  /** The user moved the view, so it should stop following the playhead. */
  onScroll: () => void;
}) {
  const { rollRef, onScroll } = props;
  const track = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  /** Where in the thumb the drag took hold. */
  const grab = useRef<number | null>(null);

  // Per frame and off React state: the view moves on its own during playback.
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      const state = rollRef.current?.scrollState;
      if (state && track.current && thumb.current) {
        const { left, width } = thumbGeometry(state, track.current.clientWidth);
        thumb.current.style.transform = `translateX(${left}px)`;
        thumb.current.style.width = `${width}px`;
        track.current.setAttribute("aria-valuenow", String(Math.round(state.offsetSec)));
        track.current.setAttribute(
          "aria-valuemax",
          String(Math.round(Math.max(0, state.totalSec - state.viewSec))),
        );
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [rollRef]);

  const moveThumbTo = (left: number) => {
    const roll = rollRef.current;
    const width = track.current?.clientWidth ?? 0;
    if (!roll) return;
    roll.scrollTo(offsetAtThumb(left, roll.scrollState, width));
    onScroll();
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const box = track.current!.getBoundingClientRect();
    const thumbBox = thumb.current!.getBoundingClientRect();
    const x = e.clientX;
    // On the thumb: hold it where it was taken. On the track: center it there.
    grab.current =
      x >= thumbBox.left && x <= thumbBox.right ? x - thumbBox.left : thumbBox.width / 2;
    track.current!.setPointerCapture(e.pointerId);
    moveThumbTo(x - box.left - grab.current);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (grab.current === null) return;
    moveThumbTo(e.clientX - track.current!.getBoundingClientRect().left - grab.current);
  };

  const release = () => {
    grab.current = null;
  };

  return (
    <div className="shrink-0 border-t border-line py-1 pr-1" style={{ paddingLeft: KEY_WIDTH }}>
      <div
        ref={track}
        role="scrollbar"
        aria-label="Scroll through time"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={0}
        aria-valuenow={0}
        aria-controls="piano-roll"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={release}
        className="h-2.5 touch-none rounded-full bg-panel"
      >
        <div ref={thumb} className="h-full rounded-full bg-line-strong hover:bg-faint" />
      </div>
    </div>
  );
}
