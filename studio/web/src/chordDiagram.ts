/** A chord shape from the server: frets from string 1 (highest) down, null for muted. */
export type DiagramShape = { frets: (number | null)[]; first_fret: number };

/** Sizes in OSMD units (10 px each at zoom 1). */
export const DIAGRAM = {
  string: 0.8, // between strings
  fret: 0.9, // between frets
  marks: 0.8, // the row above the nut for open and muted marks
  frets: 4,
};

/** Space between a diagram and what it sits on, in OSMD units. */
export const DIAGRAM_GAP = 0.4;

export function diagramSize(strings: number) {
  return {
    width: (strings - 1) * DIAGRAM.string,
    height: DIAGRAM.marks + DIAGRAM.frets * DIAGRAM.fret,
  };
}

const n = (v: number) => Number(v.toFixed(2));

/**
 * SVG for one shape with its top-left corner at (x, y), in pixels. `unit` is
 * the pixels per OSMD unit. The lowest string is on the left, as charts draw it.
 */
export function diagramSvg(shape: DiagramShape, x: number, y: number, unit: number, ink: string): string {
  const count = shape.frets.length;
  const sx = DIAGRAM.string * unit;
  const fy = DIAGRAM.fret * unit;
  const top = y + DIAGRAM.marks * unit;
  const right = x + (count - 1) * sx;
  const bottom = top + DIAGRAM.frets * fy;
  const parts: string[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, width: number) =>
    parts.push(
      `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${ink}" stroke-width="${width}"/>`,
    );

  for (let i = 0; i < count; i++) line(x + i * sx, top, x + i * sx, bottom, 1);
  for (let k = 0; k <= DIAGRAM.frets; k++) {
    // The nut is thick when the diagram starts at the first fret.
    const width = k === 0 && shape.first_fret === 1 ? 2.5 : 1;
    line(x, top + k * fy, right, top + k * fy, width);
  }
  if (shape.first_fret > 1) {
    parts.push(
      `<text x="${n(x - 0.3 * unit)}" y="${n(top + 0.75 * fy)}" font-size="${n(0.75 * unit)}" ` +
        `text-anchor="end" fill="${ink}" class="diagram-first-fret">${shape.first_fret}</text>`,
    );
  }
  for (let i = 0; i < count; i++) {
    // Column i, from the left, is string `count - i`.
    const fret = shape.frets[count - 1 - i];
    const cx = x + i * sx;
    if (fret === null) {
      const r = 0.22 * unit;
      const cy = top - 0.4 * unit;
      parts.push(
        `<path class="diagram-muted" d="M${n(cx - r)} ${n(cy - r)}L${n(cx + r)} ${n(cy + r)}` +
          `M${n(cx + r)} ${n(cy - r)}L${n(cx - r)} ${n(cy + r)}" stroke="${ink}" stroke-width="1"/>`,
      );
    } else if (fret === 0) {
      parts.push(
        `<circle class="diagram-open" cx="${n(cx)}" cy="${n(top - 0.4 * unit)}" r="${n(0.22 * unit)}" ` +
          `fill="none" stroke="${ink}" stroke-width="1"/>`,
      );
    } else {
      const row = fret - shape.first_fret;
      parts.push(
        `<circle class="diagram-dot" cx="${n(cx)}" cy="${n(top + (row + 0.5) * fy)}" r="${n(0.3 * unit)}" fill="${ink}"/>`,
      );
    }
  }
  return parts.join("");
}
