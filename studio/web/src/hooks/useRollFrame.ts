import { useEffect, type RefObject } from "react";
import type { AudioEngine } from "../audio";
import type { PianoRoll } from "../pianoroll";
import { formatClock, type ProgressEstimator } from "../progress";

/** Each frame: move the playhead, redraw the roll, and update live progress. */
export function useRollFrame(deps: {
  audio: AudioEngine;
  rollRef: RefObject<PianoRoll | null>;
  progress: ProgressEstimator;
  fillRef: RefObject<HTMLDivElement | null>;
  labelRef: RefObject<HTMLSpanElement | null>;
  /** Read each frame, so it stays current without re-subscribing. */
  transcribingRef: RefObject<boolean>;
  /** True while the roll is out of sight: it keeps time but isn't drawn. */
  hiddenRef: RefObject<boolean>;
  onFollowResumed: () => void;
}) {
  const { audio, rollRef, progress, fillRef, labelRef, transcribingRef, hiddenRef } = deps;
  const { onFollowResumed } = deps;
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      const roll = rollRef.current;
      if (roll) {
        const duration = audio.duration;
        roll.setPlayhead(audio.seconds);
        roll.setDuration(duration);
        roll.setTranscribedUntil(
          transcribingRef.current && duration > 0 ? progress.completedFraction() * duration : null,
        );
        if (!hiddenRef.current) roll.render();
        if (roll.consumeAutoResumed()) onFollowResumed();
      }
      if (fillRef.current) {
        const now = performance.now();
        fillRef.current.style.width = `${(progress.fraction(now) * 100).toFixed(1)}%`;
        const eta = progress.etaMs(now);
        if (labelRef.current) {
          labelRef.current.textContent = eta == null ? "Starting" : `About ${formatClock(eta / 1000)} left`;
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // `onFollowResumed` only sets state, so the first one stays good.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio, progress]);
}
