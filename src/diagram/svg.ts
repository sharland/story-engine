// SVG building blocks for the diagrams: escaping, monospace text measured by
// characters, word wrapping with coloured runs, boxes and arrows.
// Monospace keeps the layout exact without measuring fonts.

export { clip, firstSentence } from '../engine/words.ts';

export const FONT = 11;
/** Width of one character at FONT size; about right for common monospace fonts. */
export const CHAR = FONT * 0.6;
export const LINE = 14;

export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A run of text with a style class ("" for plain). */
export interface Run {
  text: string;
  cls: string;
}

/** Wrap runs to lines of at most `width` characters, breaking at spaces only. */
export function wrapRuns(runs: Run[], width: number): Run[][] {
  // Words are what lies between spaces, and may span runs ("east" + ",").
  const words: Run[][] = [];
  let current: Run[] = [];
  for (const r of runs) {
    for (const piece of r.text.split(/(\s+)/)) {
      if (piece === '') continue;
      if (/^\s+$/.test(piece)) {
        if (current.length > 0) words.push(current);
        current = [];
      } else current.push({ text: piece, cls: r.cls });
    }
  }
  if (current.length > 0) words.push(current);
  const lines: Run[][] = [];
  let line: Run[] = [];
  let length = 0;
  for (const word of words) {
    const size = word.reduce((k, r) => k + r.text.length, 0);
    if (length > 0 && length + 1 + size > width) {
      lines.push(line);
      line = [];
      length = 0;
    }
    if (length > 0) {
      // A space between two words of one style takes that style.
      const before = line[line.length - 1].cls;
      line.push({ text: ' ', cls: before === word[0].cls ? before : '' });
      length++;
    }
    line.push(...word);
    length += size;
  }
  if (line.length > 0) lines.push(line);
  return lines.map(merge);
}

/** Join neighbouring runs of the same style. */
function merge(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && last.cls === r.cls) last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

export function wrap(text: string, width: number, cls = ''): Run[][] {
  return wrapRuns([{ text, cls }], width);
}

/** One line of runs as an SVG <text> with <tspan>s. */
export function textLine(x: number, y: number, runs: Run[], cls = ''): string {
  const spans = runs
    .map((r) => (r.cls ? `<tspan class="${r.cls}">${esc(r.text)}</tspan>` : esc(r.text)))
    .join('');
  return `<text x="${n(x)}" y="${n(y)}"${cls ? ` class="${cls}"` : ''} xml:space="preserve">${spans}</text>`;
}

/** A number for SVG output: at most one decimal place. */
export function n(x: number): string {
  return String(Math.round(x * 10) / 10);
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the line from a box's centre towards a point leaves the box. */
export function exitPoint(b: Box, tx: number, ty: number): [number, number] {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const sx = dx === 0 ? Infinity : b.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : b.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return [cx + dx * s, cy + dy * s];
}

export const PALETTE = {
  paper: '#faf8f3',
  ink: '#1f1d1a',
  muted: '#77706a',
  rule: '#d9d3c7',
  card: '#ffffff',
  item: '#0d7a4f',
  scenery: '#1c6a8c',
  person: '#7a3fb0',
  exit: '#b0590e',
  gate: '#c0262d',
  missing: '#c0262d',
  goal: '#2f5e1e',
  end: '#8a1c1c',
};

/** The document: a background, shared styles and arrowheads. */
export function svgDocument(width: number, height: number, title: string, body: string[]): string {
  const p = PALETTE;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(width)} ${n(height)}" role="img" aria-label="${esc(title)}">`,
    `<title>${esc(title)}</title>`,
    '<style>',
    `text { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace; font-size: ${FONT}px; fill: ${p.ink}; }`,
    `.title { font-size: 16px; font-weight: 700; }`,
    `.sub, .muted { fill: ${p.muted}; }`,
    `.head { font-size: 12px; font-weight: 700; }`,
    `.small { font-size: 10px; }`,
    `.em { font-style: italic; }`,
    `.b { font-weight: 700; }`,
    `.item { fill: ${p.item}; font-weight: 700; }`,
    `.scenery { fill: ${p.scenery}; font-weight: 700; }`,
    `.person { fill: ${p.person}; font-weight: 700; }`,
    `.exit { fill: ${p.exit}; font-weight: 700; }`,
    `.missing { fill: ${p.missing}; text-decoration: underline; }`,
    `.gate { fill: ${p.gate}; }`,
    `.goal { fill: ${p.goal}; font-weight: 700; }`,
    `.end { fill: ${p.end}; font-weight: 700; }`,
    `.card { fill: ${p.card}; stroke: ${p.ink}; stroke-width: 1.2; }`,
    `.card-muted { fill: ${p.card}; stroke: ${p.muted}; stroke-width: 1; stroke-dasharray: 4 3; }`,
    `.band { stroke: none; }`,
    `.edge { fill: none; stroke: ${p.ink}; stroke-width: 1.4; }`,
    `.edge-gate { fill: none; stroke: ${p.gate}; stroke-width: 1.6; stroke-dasharray: 6 4; }`,
    `.edge-soft { fill: none; stroke: ${p.muted}; stroke-width: 1.2; }`,
    `.label-bg { fill: ${p.paper}; }`,
    '</style>',
    '<defs>',
    `<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${p.ink}"/></marker>`,
    `<marker id="arrow-gate" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${p.gate}"/></marker>`,
    `<marker id="arrow-soft" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${p.muted}"/></marker>`,
    '</defs>',
    `<rect width="100%" height="100%" fill="${p.paper}"/>`,
    ...body,
    '</svg>',
    '',
  ].join('\n');
}

/** A label with a paper-coloured background, centred on a point. */
export function label(x: number, y: number, text: string, cls = 'small'): string {
  const w = text.length * CHAR * (cls.includes('small') ? 10 / FONT : 1) + 8;
  return (
    `<rect class="label-bg" x="${n(x - w / 2)}" y="${n(y - 8)}" width="${n(w)}" height="14" rx="3"/>` +
    `<text x="${n(x)}" y="${n(y + 3)}" class="${cls}" text-anchor="middle">${esc(text)}</text>`
  );
}
