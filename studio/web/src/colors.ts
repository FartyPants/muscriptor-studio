/**
 * Eight colours chosen to stay apart from each other on black. Every pair is at
 * least ΔE 19 in normal vision and 10 under simulated colour blindness (OKLab
 * ×100, checked with a palette validator). Order them freely, but re-check any
 * change: colours picked by eye drift together quickly.
 */
export const PALETTE = [
  "#2dd290", // green
  "#ec9513", // orange
  "#c113ec", // purple
  "#ecec13", // yellow
  "#2595b1", // blue
  "#ec1313", // red
  "#baaaf8", // lavender
  "#aaf8f8", // ice
] as const;

/** More than eight instruments reuse the palette in a darker shade. */
const DARKER = 0.6;

const assigned = new Map<string, string>();

function shade(hex: string, factor: number): string {
  const channel = (at: number) =>
    Math.round(parseInt(hex.slice(at, at + 2), 16) * factor)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/**
 * The colour of `name` in the current project. The first instruments in a song
 * take the palette in order, so a song never repeats a colour needlessly. A
 * colour stays with its instrument, whatever happens to the others.
 */
export function instrumentColor(name: string): string {
  let color = assigned.get(name);
  if (!color) {
    const index = assigned.size;
    const base = PALETTE[index % PALETTE.length];
    color = index < PALETTE.length ? base : shade(base, DARKER);
    assigned.set(name, color);
  }
  return color;
}

/** Start a new project's colours. */
export function resetInstrumentColors() {
  assigned.clear();
}
