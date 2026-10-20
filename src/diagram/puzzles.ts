// The puzzle chart: what the player must do before what, from the step model
// in src/engine/steps.ts, labelled in the game's words. Only steps that lead
// to a score or an ending are drawn. Scripts can't be seen into, so what they
// do is not drawn.

import type { CompileResult } from '../engine/pack.ts';
import { buildSteps, fulfils, needIsOpen, needWords, type Need, type Step, type StepKind } from '../engine/steps.ts';
import type { World } from '../engine/types.ts';
import { CHAR, clip, label, LINE, n, svgDocument, textLine, wrap, wrapRuns, type Box, type Run } from './svg.ts';

type Compiled = Pick<CompileResult, 'moves' | 'playerMoves'>;

const NODE_CHARS = 34;
const PAD = 10;
const NODE_W = NODE_CHARS * CHAR + 2 * PAD;
const GAP_COL = 36;
const GAP_ROW = 58;
const MARGIN = 24;

export function puzzlesDiagram(w: World, c: Compiled): string {
  const steps = buildSteps(w, c);
  const { nodes, edges } = chart(w, steps);
  return draw(w, nodes, edges);
}

// ---------------------------------------------------------------------------
// From steps to a chart: keep what leads to a score or an ending

interface Node {
  id: string;
  step: Step | null;
  /** For "either" junctions. */
  label?: string;
}

interface Edge {
  from: string;
  to: string;
  label: string;
}

function chart(w: World, steps: Map<string, Step>): { nodes: Node[]; edges: Edge[] } {
  const makers = (need: Need) => [...steps.values()].filter((s) => s.makes.some((m) => fulfils(w, m, need)));
  const kept = new Set<string>();
  const queue = [...steps.values()].filter((s) => s.points > 0 || s.ends.length > 0).map((s) => s.id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (kept.has(id)) continue;
    kept.add(id);
    const s = steps.get(id)!;
    for (const e of s.ends) queue.push(`end:${e}`);
    for (const clause of s.needs) for (const need of clause) if (needIsOpen(w, need)) for (const m of makers(need)) queue.push(m.id);
  }

  const nodes: Node[] = [...steps.values()].filter((s) => kept.has(s.id)).map((s) => ({ id: s.id, step: s }));
  const edges: Edge[] = [];
  for (const node of [...nodes]) {
    const s = node.step!;
    for (const e of s.ends) edges.push({ from: s.id, to: `end:${e}`, label: '' });
    for (const clause of s.needs) {
      const open = clause.filter((need) => needIsOpen(w, need));
      if (open.length < clause.length) continue; // already true at the start
      const sources = open.map((need) => ({ need, from: makers(need).filter((m) => m.id !== s.id && kept.has(m.id)) }));
      const found = sources.filter((x) => x.from.length > 0);
      if (found.length === 0) {
        s.where = [s.where, `needs ${open.map((x) => needWords(w, x)).join(' or ')}`].filter((x) => x).join(' · ');
        continue;
      }
      if (open.length > 1) {
        const either = `either:${s.id}:${s.needs.indexOf(clause)}`;
        nodes.push({ id: either, step: null, label: 'either' });
        edges.push({ from: either, to: s.id, label: '' });
        for (const x of found) for (const m of x.from) edges.push({ from: m.id, to: either, label: needWords(w, x.need) });
      } else {
        for (const m of found[0].from) edges.push({ from: m.id, to: s.id, label: needWords(w, found[0].need) });
      }
    }
  }
  return { nodes, edges: dedupe(edges) };
}

function dedupe(edges: Edge[]): Edge[] {
  const seen = new Map<string, Edge>();
  for (const e of edges) {
    const key = `${e.from}\n${e.to}`;
    const had = seen.get(key);
    if (!had) seen.set(key, { ...e });
    else if (e.label && !had.label.split(', ').includes(e.label)) had.label = had.label ? `${had.label}, ${e.label}` : e.label;
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Drawing: rows by depth, top to bottom

function draw(w: World, nodes: Node[], edges: Edge[]): string {
  const title = `${w.manifest.title}: puzzles`;
  if (nodes.length === 0) {
    return svgDocument(640, 90, title, [
      textLine(MARGIN, MARGIN + 14, [{ text: title, cls: '' }], 'title'),
      textLine(MARGIN, MARGIN + 36, [{ text: 'No rule awards points or ends the game, so there is nothing to chart.', cls: '' }], 'sub'),
    ]);
  }
  const incoming = new Map<string, Edge[]>(nodes.map((x) => [x.id, []]));
  const outgoing = new Map<string, Edge[]>(nodes.map((x) => [x.id, []]));
  for (const e of edges) {
    incoming.get(e.to)?.push(e);
    outgoing.get(e.from)?.push(e);
  }

  // Break cycles: an edge back to a node still being visited is drawn but not used for depth.
  const back = new Set<Edge>();
  const state = new Map<string, number>();
  const dfs = (id: string) => {
    state.set(id, 1);
    for (const e of outgoing.get(id)!) {
      const s = state.get(e.to) ?? 0;
      if (s === 1) back.add(e);
      else if (s === 0) dfs(e.to);
    }
    state.set(id, 2);
  };
  for (const x of nodes) if (!state.has(x.id)) dfs(x.id);
  const ins = (id: string) => incoming.get(id)!.filter((e) => !back.has(e));
  const outs = (id: string) => outgoing.get(id)!.filter((e) => !back.has(e));

  // Rows by depth; a step nothing leads to sits just above the first step it leads to.
  const depth = new Map<string, number>();
  const depthOf = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    depth.set(id, 0);
    const d = Math.max(0, ...ins(id).map((e) => depthOf(e.from) + 1));
    depth.set(id, d);
    return d;
  };
  for (const x of nodes) depthOf(x.id);
  for (const x of nodes) {
    if (ins(x.id).length > 0 || outs(x.id).length === 0) continue;
    depth.set(x.id, Math.min(...outs(x.id).map((e) => depth.get(e.to)!)) - 1);
  }

  // Cards.
  const cards = new Map<string, { lines: Array<{ runs: Run[]; cls: string }>; h: number; w: number }>();
  for (const x of nodes) {
    if (!x.step) {
      cards.set(x.id, { lines: [], h: 22, w: 64 });
      continue;
    }
    const s = x.step;
    const lines: Array<{ runs: Run[]; cls: string }> = [];
    if (s.kind === 'ending') {
      lines.push({ runs: [{ text: `END: ${s.title}`, cls: '' }], cls: s.where === 'win' ? 'goal' : 'end' });
      cards.set(x.id, { lines, h: 30, w: Math.min(NODE_W, (s.title.length + 5) * CHAR + 2 * PAD + 8) });
      continue;
    }
    for (const l of wrap(s.title, NODE_CHARS)) lines.push({ runs: l, cls: 'b' });
    if (s.where) for (const l of wrap(s.where, NODE_CHARS + 4)) lines.push({ runs: l, cls: 'small muted' });
    if (s.quote) for (const l of wrapRuns([{ text: `“${s.quote}”`, cls: '' }], NODE_CHARS).slice(0, 3)) lines.push({ runs: l, cls: 'em' });
    if (s.points > 0) lines.push({ runs: [{ text: badge(s), cls: '' }], cls: 'goal' });
    cards.set(x.id, { lines, h: 12 + lines.length * LINE + 4, w: NODE_W });
  }

  // Place rows top to bottom; each card as near as it can be to the middle of what leads to it.
  const rows: string[][] = [];
  for (const x of nodes) (rows[depth.get(x.id)!] ??= []).push(x.id);
  const boxes = new Map<string, Box>();
  const top = MARGIN + 56;
  let y = top;
  const centre = (id: string) => {
    const b = boxes.get(id)!;
    return b.x + b.w / 2;
  };
  for (const row of rows) {
    if (!row) continue;
    const wanted = row.map((id, k) => {
      const from = ins(id).map((e) => e.from).filter((f) => boxes.has(f));
      return { id, x: from.length > 0 ? from.reduce((t, f) => t + centre(f), 0) / from.length : Number.NaN, k };
    });
    // Cards with nothing above them go after the rest, in their own order.
    const free = wanted.filter((v) => Number.isNaN(v.x));
    const fixed = wanted.filter((v) => !Number.isNaN(v.x)).sort((a, b) => a.x - b.x);
    let right = MARGIN;
    const order = [...fixed, ...free];
    const placed: Array<{ id: string; x: number }> = [];
    for (const v of order) {
      const card = cards.get(v.id)!;
      const want = Number.isNaN(v.x) ? right : v.x - card.w / 2;
      const x = Math.max(right, want);
      placed.push({ id: v.id, x });
      right = x + card.w + GAP_COL;
    }
    const h = Math.max(...row.map((id) => cards.get(id)!.h));
    for (const p of placed) {
      const card = cards.get(p.id)!;
      boxes.set(p.id, { x: p.x, y: y + (h - card.h) / 2, w: card.w, h: card.h });
    }
    y += h + GAP_ROW;
  }
  // Sources were placed in input order; put each above the middle of what it leads to, and lay the rows out again.
  const relayout = () => {
    for (const row of rows) {
      if (!row) continue;
      const items = row.map((id) => ({ id, b: boxes.get(id)! })).sort((a, b) => a.b.x - b.b.x);
      let right = MARGIN;
      for (const it of items) {
        it.b.x = Math.max(right, it.b.x);
        right = it.b.x + it.b.w + GAP_COL;
      }
    }
  };
  for (const x of nodes) {
    if (ins(x.id).length > 0 || outs(x.id).length === 0) continue;
    const to = outs(x.id).map((e) => centre(e.to));
    const b = boxes.get(x.id)!;
    b.x = Math.max(MARGIN, to.reduce((t, v) => t + v, 0) / to.length - b.w / 2);
  }
  relayout();
  const width = Math.max(...[...boxes.values()].map((b) => b.x + b.w)) + MARGIN;
  let height = y;

  const body: string[] = [];
  const labels: string[] = [];
  const taken: Box[] = [...boxes.values()];
  body.push(textLine(MARGIN, MARGIN + 14, [{ text: title, cls: '' }], 'title'));
  body.push(
    textLine(
      MARGIN,
      MARGIN + 32,
      [{ text: 'What must happen before what, worked out from the rules. Each line is labelled with what it makes true.', cls: '' }],
      'sub',
    ),
  );
  const labelled = new Set<string>();
  for (const e of edges) {
    const a = boxes.get(e.from)!;
    const b = boxes.get(e.to)!;
    if (back.has(e)) {
      const x1 = a.x + a.w;
      const y1 = a.y + a.h / 2;
      const x2 = b.x + b.w;
      const y2 = b.y + b.h / 2;
      const bulge = Math.max(x1, x2) + 50;
      body.push(`<path class="edge-soft" d="M${n(x1)},${n(y1)} C${n(bulge)},${n(y1)} ${n(bulge)},${n(y2)} ${n(x2 + 2)},${n(y2)}" marker-end="url(#arrow-soft)"/>`);
      continue;
    }
    const x1 = a.x + a.w / 2;
    const y1 = a.y + a.h;
    const x2 = b.x + b.w / 2;
    const y2 = b.y;
    const my = (y1 + y2) / 2;
    body.push(`<path class="edge" d="M${n(x1)},${n(y1)} C${n(x1)},${n(my)} ${n(x2)},${n(my)} ${n(x2)},${n(y2 - 2)}" marker-end="url(#arrow)"/>`);
    // One label per thing a step makes, just below the step.
    const key = `${e.from}\n${e.label}`;
    if (!e.label || labelled.has(key)) continue;
    labelled.add(key);
    const text = clip(e.label, 34);
    const lw = text.length * CHAR * (10 / 11) + 8;
    let lx = x1 + (x2 - x1) * 0.15;
    const ly = y1 + Math.min(16, (y2 - y1) / 2);
    const overlaps = () => taken.some((p) => lx + lw / 2 > p.x && lx - lw / 2 < p.x + p.w && ly + 7 > p.y && ly - 7 < p.y + p.h);
    for (let k = 0; k < 30 && overlaps(); k++) lx += (k % 2 === 0 ? 1 : -1) * (k + 1) * 12;
    taken.push({ x: lx - lw / 2, y: ly - 7, w: lw, h: 14 });
    labels.push(label(lx, ly, text, 'small muted'));
  }
  for (const x of nodes) {
    const b = boxes.get(x.id)!;
    const card = cards.get(x.id)!;
    if (!x.step) {
      body.push(`<rect class="card-muted" x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" rx="11"/>`);
      body.push(`<text x="${n(b.x + b.w / 2)}" y="${n(b.y + 15)}" class="small muted" text-anchor="middle">either</text>`);
      continue;
    }
    const s = x.step;
    if (s.kind === 'ending') {
      body.push(`<rect class="card" x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" rx="15" stroke-width="2"/>`);
      body.push(textLine(b.x + b.w / 2, b.y + 19, card.lines[0].runs, card.lines[0].cls).replace('<text ', '<text text-anchor="middle" '));
      continue;
    }
    body.push(`<rect class="card" x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" rx="4"/>`);
    body.push(`<rect class="band" x="${n(b.x + 0.6)}" y="${n(b.y + 0.6)}" width="5" height="${n(b.h - 1.2)}" fill="${STRIPE[s.kind]}"/>`);
    card.lines.forEach((l, i) => body.push(textLine(b.x + PAD, b.y + 18 + i * LINE, l.runs, l.cls)));
  }
  body.push(...labels);

  height = Math.max(height, ...[...boxes.values()].map((b) => b.y + b.h + 24));
  const keyY = height + 4;
  body.push(
    textLine(MARGIN, keyY, [
      { text: '▌', cls: '' },
      { text: ' a command a rule answers   ', cls: 'muted' },
      { text: '▌', cls: 'item' },
      { text: ' taking, wearing, putting   ', cls: 'muted' },
      { text: '▌', cls: 'gate' },
      { text: ' a way that opens', cls: 'muted' },
    ]),
  );
  body.push(
    textLine(MARGIN, keyY + 16, [
      { text: '▌', cls: 'person' },
      { text: ' something said   ', cls: 'muted' },
      { text: '▌', cls: 'scenery' },
      { text: ' something read   ', cls: 'muted' },
      { text: 'Steps that lead to no score or ending are left out,', cls: 'muted' },
    ]),
  );
  body.push(textLine(MARGIN, keyY + 32, [{ text: 'and so is anything only a script does. A full spoiler.', cls: 'muted' }]));
  return svgDocument(Math.max(width, 720), keyY + 46, title, body);
}

const STRIPE: Record<StepKind, string> = {
  rule: '#1f1d1a',
  take: '#0d7a4f',
  gate: '#c0262d',
  talk: '#7a3fb0',
  read: '#1c6a8c',
  ending: '#2f5e1e',
};

function badge(s: Step): string {
  return `+${s.points} point${s.points === 1 ? '' : 's'}`;
}
