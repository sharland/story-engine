// The map: rooms laid out by compass from the start, each with its
// description as the player reads it. Words the player can use are coloured:
// things to take, scenery to examine, people, and the ways out. Words the
// text names that nothing answers to are underlined in red.

import type { CompileResult } from '../engine/pack.ts';
import { knownWords, roomScopes, stem, unexaminedNouns } from '../engine/shape.ts';
import type { Exit, Room, TextPart, World } from '../engine/types.ts';
import { CHAR, esc, exitPoint, label, LINE, n, svgDocument, textLine, wrapRuns, type Box, type Run } from './svg.ts';
import { conditionWords, prose, thingName } from '../engine/words.ts';

type Compiled = Pick<CompileResult, 'moves' | 'playerMoves'>;

const COMPASS: Record<string, [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
  northeast: [1, -1],
  northwest: [-1, -1],
  southeast: [1, 1],
  southwest: [-1, 1],
};
const PREFER: Record<string, Array<[number, number]>> = {
  up: [[0, -1], [1, -1], [-1, -1]],
  down: [[0, 1], [1, 1], [-1, 1]],
  in: [[1, 0], [0, 1], [1, 1]],
  out: [[-1, 0], [0, -1], [-1, -1]],
};

const TEXT_CHARS = 36;
const PAD = 10;
const BOX_W = TEXT_CHARS * CHAR + 2 * PAD;
const HEAD = 24;
const GAP_X = 130;
const GAP_Y = 64;
const MARGIN = 24;

export function mapDiagram(w: World, c: Compiled): string {
  const cells = layout(w);
  const scope = roomScopes(w, c);

  // Each room's card, measured.
  const cards = new Map<string, { lines: Run[][]; h: number }>();
  for (const room of w.rooms.values()) {
    const lines = cardLines(w, room, scope.get(room.id)!);
    cards.set(room.id, { lines, h: HEAD + 8 + lines.length * LINE + 6 });
  }

  // Grid geometry: every column the same width, each row as tall as its tallest card.
  const xs = [...cells.values()].map(([x]) => x);
  const ys = [...cells.values()].map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const rows = Math.max(...ys) - minY + 1;
  const rowH = Array.from({ length: rows }, () => 0);
  for (const [id, [, y]] of cells) rowH[y - minY] = Math.max(rowH[y - minY], cards.get(id)!.h);
  const rowTop: number[] = [];
  let top = MARGIN + 52;
  for (const h of rowH) {
    rowTop.push(top);
    top += h + GAP_Y;
  }
  const boxes = new Map<string, Box>();
  for (const [id, [x, y]] of cells) {
    boxes.set(id, { x: MARGIN + (x - minX) * (BOX_W + GAP_X), y: rowTop[y - minY], w: BOX_W, h: cards.get(id)!.h });
  }
  const width = MARGIN * 2 + (Math.max(...xs) - minX + 1) * (BOX_W + GAP_X) - GAP_X;

  const body: string[] = [];
  const labels: string[] = [];
  body.push(textLine(MARGIN, MARGIN + 14, [{ text: `${w.manifest.title}: map`, cls: '' }], 'title'));
  body.push(
    textLine(
      MARGIN,
      MARGIN + 32,
      [{ text: 'Rooms laid out by compass from the start. Coloured words are ones the player can use there.', cls: '' }],
      'sub',
    ),
  );

  // Exits, grouped by the pair of rooms they join.
  const pairs = new Map<string, { a: string; b: string; ab: Exit[]; ba: Exit[] }>();
  for (const room of w.rooms.values()) {
    for (const e of room.exits.values()) {
      if (!e.to || !boxes.has(e.to) || e.to === room.id) continue;
      const [a, b] = [room.id, e.to].sort();
      const key = `${a}\n${b}`;
      if (!pairs.has(key)) pairs.set(key, { a, b, ab: [], ba: [] });
      (room.id === a ? pairs.get(key)!.ab : pairs.get(key)!.ba).push(e);
    }
  }
  for (const { a, b, ab, ba } of pairs.values()) {
    const A = boxes.get(a)!;
    const B = boxes.get(b)!;
    const [p, q] = endpoints(A, B);
    const all = [...ab, ...ba];
    const gated = all.some((e) => e.if !== null || lockedDoor(w, e));
    const oneWay = ab.length === 0 || ba.length === 0;
    const cls = gated ? 'edge-gate' : 'edge';
    const marker = gated ? 'url(#arrow-gate)' : 'url(#arrow)';
    const [from, to] = ab.length > 0 ? [p, q] : [q, p];
    body.push(
      `<line class="${cls}" x1="${n(from[0])}" y1="${n(from[1])}" x2="${n(to[0])}" y2="${n(to[1])}"${oneWay ? ` marker-end="${marker}"` : ''}/>`,
    );
    // Direction words where the drawing doesn't already say which way.
    // Labels sit on vertical and slanted lines, and above level ones so as not to hide them.
    const lift = p[1] === q[1] ? -9 : 0;
    const endLabel = (exits: Exit[], fromBox: Box, toBox: Box, at: [number, number], toward: [number, number]) => {
      if (exits.length === 0 || exits.every((e) => matches(e.dir, fromBox, toBox))) return;
      const t = 0.22;
      const x = at[0] + (toward[0] - at[0]) * t;
      const y = at[1] + (toward[1] - at[1]) * t + lift;
      labels.push(label(x, y, exits.map((e) => e.dir).join('/'), 'small exit'));
    };
    endLabel(ab, A, B, p, q);
    endLabel(ba, B, A, q, p);
    const gateText = all
      .map((e) => (e.if !== null ? conditionWords(w, e.if) : e.door ? `${thingName(w, e.door)}${lockedDoor(w, e) ? ' (locked)' : ''}` : ''))
      .filter((t, i, list) => t !== '' && list.indexOf(t) === i);
    if (gateText.length > 0) {
      labels.push(label((p[0] + q[0]) / 2, (p[1] + q[1]) / 2 + lift, gateText.join('; '), gated ? 'small gate' : 'small muted'));
    }
  }

  // Cards.
  for (const room of w.rooms.values()) {
    const box = boxes.get(room.id)!;
    const card = cards.get(room.id)!;
    const tint = regionTint(w, room.region);
    body.push(`<rect class="card" x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}" rx="4"/>`);
    body.push(
      `<rect class="band" x="${n(box.x + 0.6)}" y="${n(box.y + 0.6)}" width="${n(box.w - 1.2)}" height="${HEAD}" rx="3.5" fill="${tint}"/>`,
    );
    body.push(textLine(box.x + PAD, box.y + 16, [{ text: room.name, cls: '' }], 'head'));
    const tags = [room.id === w.manifest.start ? 'start' : '', room.region ?? ''].filter((t) => t !== '').join(' · ');
    if (tags) body.push(`<text x="${n(box.x + box.w - PAD)}" y="${n(box.y + 16)}" class="small muted" text-anchor="end">${esc(tags)}</text>`);
    card.lines.forEach((line, i) => body.push(textLine(box.x + PAD, box.y + HEAD + 8 + 10 + i * LINE, line)));
  }
  body.push(...labels);

  // Key.
  const keyY = top + 4;
  const key: Run[] = [
    { text: 'item', cls: 'item' },
    { text: ' to take   ', cls: 'muted' },
    { text: 'scenery', cls: 'scenery' },
    { text: ' to examine   ', cls: 'muted' },
    { text: 'person', cls: 'person' },
    { text: '   ', cls: '' },
    { text: 'exit', cls: 'exit' },
    { text: '   ', cls: '' },
    { text: 'named but not examinable', cls: 'missing' },
    { text: '   ', cls: '' },
    { text: 'grey italic', cls: 'muted em' },
    { text: ': shown only sometimes', cls: 'muted' },
  ];
  body.push(textLine(MARGIN, keyY, key));
  body.push(
    textLine(MARGIN, keyY + 18, [
      { text: 'Red dashed line', cls: 'gate' },
      { text: ': a way that opens only when the condition shown is met, or through a locked door. ', cls: 'muted' },
      { text: 'Arrow: one way only. Grey label: a door.', cls: 'muted' },
    ]),
  );
  return svgDocument(Math.max(width, 900), keyY + 34, `${w.manifest.title}: map`, body);
}

/** Lay rooms on a grid: breadth-first from the start, each placed by the direction it was reached in. */
function layout(w: World): Map<string, [number, number]> {
  const cells = new Map<string, [number, number]>();
  const taken = new Set<string>();
  const put = (id: string, x: number, y: number) => {
    cells.set(id, [x, y]);
    taken.add(`${x},${y}`);
  };
  const free = (x: number, y: number) => !taken.has(`${x},${y}`);
  const nearest = (x: number, y: number, prefer: Array<[number, number]>): [number, number] => {
    for (const [dx, dy] of prefer) if (free(x + dx, y + dy)) return [x + dx, y + dy];
    for (let r = 1; r < 50; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) === r && free(x + dx, y + dy)) return [x + dx, y + dy];
        }
      }
    }
    return [x, y + 50];
  };
  const order = (e: Exit) => (e.dir in COMPASS ? 0 : 1);
  const visit = (start: string) => {
    const queue = [start];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const [x, y] = cells.get(id)!;
      const exits = [...w.rooms.get(id)!.exits.values()].filter((e) => e.to && w.rooms.has(e.to)).sort((a, b) => order(a) - order(b));
      for (const e of exits) {
        if (cells.has(e.to!)) continue;
        const prefer = e.dir in COMPASS ? [COMPASS[e.dir]] : (PREFER[e.dir] ?? []);
        const [nx, ny] = nearest(x, y, prefer);
        put(e.to!, nx, ny);
        queue.push(e.to!);
      }
    }
  };
  put(w.manifest.start, 0, 0);
  visit(w.manifest.start);
  // Rooms no exit reaches (only movePlayer, or nothing): a row of their own below.
  for (const id of w.rooms.keys()) {
    if (cells.has(id)) continue;
    const maxY = Math.max(...[...cells.values()].map(([, y]) => y));
    const [x, y] = nearest(0, maxY + 1, [[0, 0]]);
    put(id, x, y);
    visit(id);
  }
  return cells;
}

/** Does the drawing already show this direction (a compass exit drawn that way)? */
function matches(dir: string, from: Box, to: Box): boolean {
  const v = COMPASS[dir];
  if (!v) return false;
  const dx = Math.sign(Math.round(to.x - from.x));
  const dy = Math.sign(Math.round(to.y - from.y));
  return dx === v[0] && dy === v[1];
}

/** Line ends for two cards: straight across for neighbours in a row or column. */
function endpoints(A: Box, B: Box): [[number, number], [number, number]] {
  if (A.y === B.y && A.x !== B.x) {
    const y = A.y + Math.min(A.h, B.h) / 2;
    const [l, r] = A.x < B.x ? [A, B] : [B, A];
    const p: [number, number] = [l.x + l.w, y];
    const q: [number, number] = [r.x, y];
    return A.x < B.x ? [p, q] : [q, p];
  }
  const ac: [number, number] = [A.x + A.w / 2, A.y + A.h / 2];
  const bc: [number, number] = [B.x + B.w / 2, B.y + B.h / 2];
  return [exitPoint(A, bc[0], bc[1]), exitPoint(B, ac[0], ac[1])];
}

function lockedDoor(w: World, e: Exit): boolean {
  return e.door !== null && w.things.get(e.door)?.initialProps.locked === true;
}

const TINTS = ['#e9f0f7', '#f6ece0', '#e8f3e6', '#f3e7f1', '#f7f3dc'];

function regionTint(w: World, region: string | null): string {
  if (region === null) return '#efebe3';
  const ids = [...new Set([...w.rooms.values()].map((r) => r.region).filter((r): r is string => r !== null))].sort();
  return TINTS[ids.indexOf(region) % TINTS.length];
}

/** The card's lines: the description with coloured words, then who and what is here. */
function cardLines(w: World, room: Room, scope: Set<string>): Run[][] {
  // Coloured words: nouns of things that can be here, and the room's ways out.
  const classes = new Map<string, string>();
  for (const id of scope) {
    const t = w.things.get(id)!;
    const cls = t.kind === 'character' ? 'person' : t.scenery || t.fixed || t.door ? 'scenery' : 'item';
    const nouns = t.nouns.length > 0 ? t.nouns : [t.name.split(/\s+/).pop()!];
    for (const noun of nouns) {
      const key = stem(noun);
      const was = classes.get(key);
      if (!was || rank(cls) < rank(was)) classes.set(key, cls);
    }
  }
  const exitWords = new Set<string>();
  for (const [word, dir] of w.directionWords) {
    if (room.exits.has(dir) && word.length > 2 && !['in', 'out'].includes(word)) exitWords.add(word);
  }
  const text = prose(w, room.description);
  const missing = new Set(
    unexaminedNouns(text, knownWords(w, room.id, scope)).flatMap((phrase) => phrase.split(' ').slice(1)),
  );

  const runs: Run[] = [];
  const parts: TextPart[] = room.description === null ? [] : typeof room.description === 'string' ? [room.description] : room.description;
  for (const part of parts) {
    if (runs.length > 0) runs.push({ text: ' ', cls: '' });
    if (typeof part === 'string') runs.push(...colour(prose(w, part), classes, exitWords, missing));
    else runs.push({ text: prose(w, part.text), cls: 'muted em' });
  }
  const lines = wrapRuns(runs, TEXT_CHARS);

  // Portable things and people, with where they start.
  const extra: Run[][] = [];
  for (const id of scope) {
    const t = w.things.get(id)!;
    if (t.kind === 'object' && (t.scenery || t.fixed || t.door)) continue;
    const at = t.location && t.location !== room.id && w.things.has(t.location) ? `, ${placeWords(w, t.location)}` : '';
    const later = t.location === null || (t.kind === 'object' && !startsIn(w, t.id, room.id)) ? ' (later)' : '';
    const roams = t.wander ? ' (roams)' : '';
    extra.push(...wrapRuns([{ text: '+ ', cls: 'muted' }, { text: t.name, cls: t.kind === 'character' ? 'person' : 'item' }, { text: `${at}${later}${roams}`, cls: 'muted' }], TEXT_CHARS));
  }
  const blocked = [...room.exits.values()].filter((e) => !e.to).map((e) => e.dir);
  if (blocked.length > 0) extra.push(...wrapRuns([{ text: `${blocked.join(', ')}: no way on`, cls: 'muted' }], TEXT_CHARS));
  if (extra.length > 0) return [...lines, [], ...extra];
  return lines;
}

function rank(cls: string): number {
  return ['person', 'item', 'scenery'].indexOf(cls);
}

function startsIn(w: World, id: string, room: string): boolean {
  let at = w.things.get(id)?.location ?? null;
  for (let i = 0; at !== null && i < 20; i++) {
    if (at === room) return true;
    at = w.things.get(at)?.location ?? null;
  }
  return false;
}

function placeWords(w: World, container: string): string {
  const t = w.things.get(container)!;
  return `${t.surface ? 'on' : t.kind === 'character' ? 'with' : 'in'} the ${t.name}`;
}

function colour(text: string, classes: Map<string, string>, exits: Set<string>, missing: Set<string>): Run[] {
  const runs: Run[] = [];
  for (const piece of text.split(/([A-Za-z][A-Za-z'’-]*)/)) {
    if (piece === '') continue;
    const lower = piece.toLowerCase().replace(/['’]s$/, '');
    const cls = /^[A-Za-z]/.test(piece)
      ? (classes.get(stem(lower)) ?? (exits.has(lower) ? 'exit' : missing.has(lower) ? 'missing' : ''))
      : '';
    const last = runs[runs.length - 1];
    if (last && last.cls === cls) last.text += piece;
    else runs.push({ text: piece, cls });
  }
  return runs;
}

