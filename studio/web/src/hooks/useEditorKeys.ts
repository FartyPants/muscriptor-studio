import { useEffect, type RefObject } from "react";
import type { AudioEngine } from "../audio";
import { Autosaver } from "../editor/autosave";
import type { RollEditor } from "../editor/rollEditor";

/** The keyboard on the project screen, and the warning before leaving unsaved work. */
export function useEditorKeys(
  audio: AudioEngine,
  editorRef: RefObject<RollEditor | null>,
  toggleLoop: () => void,
) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select")) return;
      // The roll is behind an open dialog, so its keys are too.
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key.toLowerCase() === "l" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!e.repeat) toggleLoop();
        return;
      }
      if (editorRef.current?.key(e)) e.preventDefault();
    };
    // Space is the transport's, so it can't press whatever was clicked last. It
    // runs first, in the capture phase. Three cases keep Space's usual meaning:
    // typing, a dialog, and a control reached with Tab, for keyboard users.
    const onSpace = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const focused = document.activeElement as HTMLElement | null;
      if ((e.target as HTMLElement).closest('input:not([type="range"]):not([type="checkbox"]), textarea')) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (focused && focused !== document.body && focused.matches(":focus-visible")) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      focused?.blur();
      if (audio.state === "started") audio.pause();
      else audio.play();
    };
    // A clicked control gives focus back, so the keyboard keeps working the roll.
    const onRelease = () => {
      const focused = document.activeElement as HTMLElement | null;
      if (!focused?.matches('button, input[type="range"], input[type="checkbox"]')) return;
      if (focused.closest('[role="dialog"]') || focused.matches(":focus-visible")) return;
      focused.blur();
    };
    // A failed or waiting save would lose edits if the page closed now.
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!Autosaver.anyUnsaved) return;
      Autosaver.flushAll();
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onSpace, true);
    window.addEventListener("pointerup", onRelease);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onSpace, true);
      window.removeEventListener("pointerup", onRelease);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [audio, editorRef, toggleLoop]);
}
