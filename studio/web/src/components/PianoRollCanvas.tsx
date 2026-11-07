import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { AudioEngine } from "../audio";
import type { RollEditor } from "../editor/rollEditor";
import { KEY_WIDTH, PianoRoll, RULER_H, type GridDisplay } from "../pianoroll";

export function PianoRollCanvas(props: {
  rollRef: RefObject<PianoRoll | null>;
  editorRef: RefObject<RollEditor | null>;
  audio: AudioEngine;
  display: GridDisplay;
  onRange: (range: { start: number; end: number } | null) => void;
  setUserScrolled: Dispatch<SetStateAction<boolean>>;
}) {
  const { rollRef, editorRef, audio, display, onRange, setUserScrolled } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const roll = new PianoRoll(canvas);
    roll.setDisplay(display);
    rollRef.current = roll;

    // Wheel bindings follow the DAW convention (Ableton / FL / Reaper):
    //   ctrl/cmd + scroll → zoom the time axis (also what a macOS trackpad
    //                       pinch fires, so pinch zooms the timeline);
    //   alt/option + scroll → zoom the pitch axis;
    //   shift + scroll → pan the time axis;
    //   plain scroll → vertical wheel pans the pitch axis, horizontal wheel
    //                  (trackpad) pans time.
    // (Pitch zoom via the key strip is the click-drag gesture below.)
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.01);
      if (e.altKey) {
        roll.zoomPitch(factor, e.clientY - rect.top);
        setUserScrolled(true);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        roll.zoomTime(factor, e.clientX - rect.left);
        setUserScrolled(true);
        return;
      }
      if (e.shiftKey) {
        const d = e.deltaX !== 0 ? e.deltaX : e.deltaY;
        if (d !== 0) roll.scrollBy(d / roll.pxPerSec);
      } else {
        if (e.deltaX !== 0) roll.scrollBy(e.deltaX / roll.pxPerSec);
        if (e.deltaY !== 0) roll.scrollPitchBy(-e.deltaY);
      }
      setUserScrolled(true);
    };

    // Scrubbing: press-and-drag in the note area moves the playhead live under
    // the cursor (with follow mode on, the view scrolls along). Playback pauses
    // for the duration of the drag and resumes from the release point. The
    // move/up handlers live on the window so the scrub survives the pointer
    // leaving the canvas — dragging out past the left edge clamps to the start.
    // A plain click is just a zero-length scrub, so click-to-seek still works.
    let scrub: { wasPlaying: boolean } | null = null;
    const scrubTo = (clientX: number) => {
      const rect = canvas.getBoundingClientRect();
      // Leaving the canvas on the left means "to the start" — a stationary
      // cursor gets no more mousemove events, so it could never out-scroll
      // the view to reach 0 otherwise.
      const t =
        clientX < rect.left ? 0 : Math.max(0, roll.xToSeconds(clientX - rect.left));
      // Clock-only seek per move (a full seek() re-schedules every note); the
      // rAF loop reads it back into the roll's playhead each frame.
      audio.scrubTo(t);
      roll.setPlayhead(t);
    };

    // Ableton-style key-strip gesture: click-drag on the keyboard zooms the
    // pitch axis horizontally (drag right = zoom in) and pans it vertically
    // (grab-style). Anchored on the cursor's pitch.
    let keyDrag: { x: number; y: number } | null = null;
    let editing = false;
    let ruler: { x: number; from: number; moved: boolean } | null = null;
    let rulerRange: { start: number; end: number } | null = null;
    const onMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const editor = editorRef.current;
      if (x >= KEY_WIDTH && y < RULER_H) {
        ruler = { x, from: roll.xToSeconds(x), moved: false };
      } else if (x >= KEY_WIDTH && editor?.claims(y)) {
        editing = true;
        editor.down(x, y, e.shiftKey);
      } else if (x >= KEY_WIDTH) {
        setUserScrolled(false);
        scrub = { wasPlaying: audio.state === "started" };
        if (scrub.wasPlaying) audio.pause();
        scrubTo(e.clientX);
      } else {
        keyDrag = { x, y: e.clientY - rect.top };
      }
      e.preventDefault();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (ruler) {
        const x = e.clientX - canvas.getBoundingClientRect().left;
        if (Math.abs(x - ruler.x) < 4 && !ruler.moved) return;
        ruler.moved = true;
        const end = audio.duration || Infinity;
        const to = Math.min(end, Math.max(0, roll.xToSeconds(x)));
        const from = Math.min(end, ruler.from);
        rulerRange = { start: Math.min(from, to), end: Math.max(from, to) };
        roll.setRange(rulerRange);
        return;
      }
      if (editing) {
        const rect = canvas.getBoundingClientRect();
        editorRef.current?.move(e.clientX - rect.left, e.clientY - rect.top, e.altKey);
        return;
      }
      if (scrub) {
        scrubTo(e.clientX);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      if (keyDrag) {
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const dx = x - keyDrag.x;
        const dy = y - keyDrag.y;
        if (dx !== 0) roll.zoomPitch(Math.exp(dx * 0.01), y);
        if (dy !== 0) roll.scrollPitchBy(dy);
        keyDrag = { x, y };
        setUserScrolled(true);
        return;
      }
      // Hint the gesture with a resize cursor while hovering the key strip.
      const hoverX = e.clientX - rect.left;
      canvas.style.cursor =
        hoverX < KEY_WIDTH
          ? "ew-resize"
          : (editorRef.current?.cursorAt(hoverX, e.clientY - rect.top) ?? "default");
    };
    const onDoubleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (x >= KEY_WIDTH) editorRef.current?.add(x, e.clientY - rect.top);
    };
    const onMouseUp = () => {
      if (ruler) {
        // A click moves the playhead and clears the range. A drag keeps it.
        const chosen = rulerRange && rulerRange.end - rulerRange.start >= 0.25 ? rulerRange : null;
        if (ruler.moved) {
          roll.setRange(chosen);
          onRange(chosen);
        } else {
          roll.setRange(null);
          onRange(null);
          audio.seek(ruler.from);
          roll.setPlayhead(ruler.from);
          setUserScrolled(false);
        }
        ruler = null;
        rulerRange = null;
      }
      if (editing) {
        editing = false;
        editorRef.current?.up();
      }
      if (scrub) {
        // One real seek to rebuild the (one-shot) note schedule from the
        // release point, then resume if the drag interrupted playback.
        audio.seek(audio.seconds);
        if (scrub.wasPlaying) audio.play();
        scrub = null;
      }
      keyDrag = null;
    };

    // Touch: one finger drags the view (left/right scrolls time, up/down pans
    // the pitch axis when zoomed); two fingers pinch to zoom — horizontal
    // spread zooms time, vertical spread zooms the pitch axis.
    let pan: { x: number; y: number } | null = null;
    let pinch: { dx: number; dy: number } | null = null;
    const pinchSpan = (t: TouchList) => ({
      dx: Math.abs(t[0].clientX - t[1].clientX),
      dy: Math.abs(t[0].clientY - t[1].clientY),
    });

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinch = pinchSpan(e.touches);
        pan = null;
        e.preventDefault();
      } else if (e.touches.length === 1) {
        pan = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        const span = pinchSpan(e.touches);
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        const MIN = 12; // ignore tiny spans where the ratio gets noisy
        if (pinch.dx > MIN && span.dx > MIN) roll.zoomTime(span.dx / pinch.dx, cx);
        if (pinch.dy > MIN && span.dy > MIN) roll.zoomPitch(span.dy / pinch.dy, cy);
        pinch = span;
        setUserScrolled(true);
      } else if (pan && e.touches.length === 1) {
        e.preventDefault();
        const t = e.touches[0];
        roll.scrollBy(-(t.clientX - pan.x) / roll.pxPerSec);
        roll.scrollPitchBy(t.clientY - pan.y);
        pan = { x: t.clientX, y: t.clientY };
        setUserScrolled(true);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
      if (e.touches.length === 0) pan = null;
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("dblclick", onDoubleClick);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("dblclick", onDoubleClick);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    // `display` only seeds the roll; later changes go through setDisplay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio, rollRef, editorRef, setUserScrolled]);

  return (
    <section className="relative h-full overflow-hidden bg-black">
      <canvas id="piano-roll" className="block h-full w-full" width={1200} height={400} ref={canvasRef} />
    </section>
  );
}
