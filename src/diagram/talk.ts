// Conversations: each character's menu as a tree of cards, with what they
// say, every line the player can choose, the reply, and where it leads; then
// the topics they answer to ASK and TELL.

import type { Condition, DialogueDef, DialogueOptionDef, Effect, TextDef, Thing, World } from '../engine/types.ts';
import { CHAR, esc, firstSentence, label, LINE, n, svgDocument, textLine, wrap, wrapRuns, type Box, type Run } from './svg.ts';
import { conditionWords, prose, thingName } from './words.ts';

const CARD_CHARS = 44;
const PAD = 10;
const CARD_W = CARD_CHARS * CHAR + 2 * PAD;
const GAP_COL = 40;
const GAP_ROW = 52;
const MARGIN = 24;

interface Line {
  runs: Run[];
  cls: string;
  /** Extra space above, for separators. */
  gap?: number;
  rule?: boolean;
}

interface Card {
  id: string;
  title: string;
  tag: string;
  lines: Line[];
  w: number;
  h: number;
  pill?: boolean;
}

export function talkDiagram(w: World): string {
  const title = `${w.manifest.title}: conversations`;
  const people = [...w.things.values()].filter((t) => w.dialogues.has(t.id) || t.topics.length > 0);
  const body: string[] = [
    textLine(MARGIN, MARGIN + 14, [{ text: title, cls: '' }], 'title'),
    textLine(
      MARGIN,
      MARGIN + 32,
      [{ text: 'Each line the player can choose, the reply, and where it leads. Numbers on lines are menu choices.', cls: '' }],
      'sub',
    ),
  ];
  let y = MARGIN + 60;
  let width = 720;
  if (people.length === 0) {
    body.push(textLine(MARGIN, y + 10, [{ text: 'No character has a conversation menu or topics.', cls: '' }]));
    return svgDocument(width, y + 40, title, body);
  }
  for (const person of people) {
    body.push(textLine(MARGIN, y + 12, [{ text: person.name, cls: 'person' }], 'head'));
    y += 26;
    const d = w.dialogues.get(person.id);
    if (d) {
      const drawn = drawDialogue(w, person, d, y);
      body.push(...drawn.body);
      y = drawn.bottom + 18;
      width = Math.max(width, drawn.right + MARGIN);
    }
    if (person.topics.length > 0) {
      const card = topicsCard(w, person);
      body.push(...drawCard(card, { x: MARGIN, y, w: card.w, h: card.h }));
      y += card.h + 18;
    }
    y += 16;
  }
  return svgDocument(width, y + 10, title, body);
}

function drawDialogue(w: World, person: Thing, d: DialogueDef, top: number): { body: string[]; bottom: number; right: number } {
  const nodes = d.nodes ?? {};
  const start: Card = { id: '(start)', title: `TALK TO ${person.name.toUpperCase()}`, tag: '', lines: [], w: (person.name.length + 10) * CHAR + 24, h: 26, pill: true };
  const cards = new Map<string, Card>([[start.id, start]]);
  for (const [id, node] of Object.entries(nodes)) cards.set(id, nodeCard(w, person, d, id, node));

  // Links: entry conditions from the start, and menu choices between nodes.
  const links: Array<{ from: string; to: string; label: string }> = [];
  const entries = d.entry && d.entry.length > 0 ? d.entry : [{ node: 'start' }];
  entries.forEach((e, i) => {
    if (!cards.has(e.node)) return;
    const text = e.if ? `if ${conditionWords(w, e.if)}` : i > 0 ? 'otherwise' : '';
    links.push({ from: start.id, to: e.node, label: text });
  });
  for (const [id, node] of Object.entries(nodes)) {
    const targets = new Map<string, number[]>();
    (node.options ?? []).forEach((o, i) => {
      if (o.then && o.then !== 'end' && o.then !== id && cards.has(o.then)) targets.set(o.then, [...(targets.get(o.then) ?? []), i + 1]);
    });
    for (const [to, numbers] of targets) links.push({ from: id, to, label: numbers.join(', ') });
  }

  // Rows by distance from the start.
  const depth = new Map<string, number>([[start.id, 0]]);
  const queue = [start.id];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const l of links) {
      if (l.from === at && !depth.has(l.to)) {
        depth.set(l.to, depth.get(at)! + 1);
        queue.push(l.to);
      }
    }
  }
  const lastRow = Math.max(...depth.values());
  for (const id of cards.keys()) if (!depth.has(id)) depth.set(id, lastRow + 1); // reached only by script
  const rows: string[][] = [];
  for (const [id, dpt] of depth) (rows[dpt] ??= []).push(id);

  const rowWidth = (row: string[]) => row.reduce((t, id) => t + cards.get(id)!.w, 0) + GAP_COL * (row.length - 1);
  const widest = Math.max(...rows.filter(Boolean).map(rowWidth));
  const boxes = new Map<string, Box>();
  let y = top;
  for (const row of rows) {
    if (!row) continue;
    let x = MARGIN + (widest - rowWidth(row)) / 2;
    const h = Math.max(...row.map((id) => cards.get(id)!.h));
    for (const id of row) {
      const c = cards.get(id)!;
      boxes.set(id, { x, y, w: c.w, h: c.h });
      x += c.w + GAP_COL;
    }
    y += h + GAP_ROW;
  }

  const body: string[] = [];
  const labels: string[] = [];
  let right = MARGIN + widest;
  for (const l of links) {
    const a = boxes.get(l.from)!;
    const b = boxes.get(l.to)!;
    if (b.y > a.y) {
      const x1 = a.x + a.w / 2;
      const y1 = a.y + a.h;
      const x2 = b.x + b.w / 2;
      const y2 = b.y;
      const my = (y1 + y2) / 2;
      body.push(`<path class="edge" d="M${n(x1)},${n(y1)} C${n(x1)},${n(my)} ${n(x2)},${n(my)} ${n(x2)},${n(y2 - 2)}" marker-end="url(#arrow)"/>`);
      if (l.label) labels.push(label(x1 + (x2 - x1) * 0.5, my, l.label, 'small muted'));
    } else {
      // Back to an earlier card: round the right-hand side.
      const x1 = a.x + a.w;
      const y1 = a.y + a.h / 2;
      const x2 = b.x + b.w;
      const y2 = b.y + Math.min(20, b.h / 2);
      const bulge = Math.max(x1, x2) + 60;
      right = Math.max(right, bulge + 20);
      body.push(`<path class="edge-soft" d="M${n(x1)},${n(y1)} C${n(bulge)},${n(y1)} ${n(bulge)},${n(y2)} ${n(x2 + 2)},${n(y2)}" marker-end="url(#arrow-soft)"/>`);
      if (l.label) labels.push(label(bulge - 14, (y1 + y2) / 2, l.label, 'small muted'));
    }
  }
  for (const [id, c] of cards) body.push(...drawCard(c, boxes.get(id)!));
  body.push(...labels);
  return { body, bottom: y - GAP_ROW, right };
}

function nodeCard(w: World, person: Thing, d: DialogueDef, id: string, node: NonNullable<DialogueDef['nodes']>[string]): Card {
  const lines: Line[] = [];
  lines.push(...sayLines(w, person, node.say));
  const fx = effectWords(w, node.do ?? []);
  if (fx) lines.push(...wrap(fx, CARD_CHARS + 4).map((r) => ({ runs: r, cls: 'small muted' })));
  let first = true;
  (node.options ?? []).forEach((o, i) => {
    lines.push(...optionLines(w, id, o, i + 1, first));
    first = false;
  });
  if (!node.noLeave) {
    lines.push({ runs: [{ text: '0. Leave', cls: '' }], cls: 'muted', gap: first ? 4 : 6, rule: first });
    const leave = prose(w, d.leave);
    if (leave) lines.push(...wrap(quoted(firstSentence(leave, 80)), CARD_CHARS).map((r) => ({ runs: r, cls: 'small muted em' })));
  }
  const tags = [node.noLeave ? 'no leaving' : '', node.resumeText ? 'own resume line' : ''].filter((t) => t).join(' · ');
  return { id, title: id, tag: tags, lines, w: CARD_W, h: cardHeight(lines) };
}

function sayLines(w: World, person: Thing, say: TextDef | undefined): Line[] {
  if (say === undefined) return [{ runs: [{ text: '(no opening line)', cls: '' }], cls: 'small muted' }];
  const out: Line[] = [];
  const parts = typeof say === 'string' ? [say] : say;
  for (const p of parts) {
    if (typeof p === 'string') {
      out.push(...wrap(prose(w, p, person.id), CARD_CHARS).map((r) => ({ runs: r, cls: 'person em' })));
      continue;
    }
    if (p.if) out.push({ runs: [{ text: `if ${conditionWords(w, p.if as Condition)}:`, cls: '' }], cls: 'small muted' });
    out.push(...wrap(prose(w, p.text, person.id), CARD_CHARS).map((r) => ({ runs: r, cls: 'person em' })));
    if (p.else) {
      out.push({ runs: [{ text: 'otherwise:', cls: '' }], cls: 'small muted' });
      out.push(...wrap(prose(w, p.else, person.id), CARD_CHARS).map((r) => ({ runs: r, cls: 'person em' })));
    }
  }
  return out;
}

function optionLines(w: World, nodeId: string, o: DialogueOptionDef, number: number, first: boolean): Line[] {
  const out: Line[] = [];
  const text = wrapRuns([{ text: `${number}. ${prose(w, o.text)}`, cls: '' }], CARD_CHARS);
  text.forEach((r, i) => out.push({ runs: r, cls: 'b', gap: i === 0 ? (first ? 4 : 6) : 0, rule: i === 0 && first }));
  const reply = prose(w, o.reply);
  if (reply) out.push(...wrap(quoted(firstSentence(reply, 120)), CARD_CHARS - 3).map((r) => ({ runs: [{ text: '   ', cls: '' }, ...r], cls: 'small em' })));
  const flags = [
    o.if ? `only if ${conditionWords(w, o.if)}${o.locked ? ' (shown locked)' : ''}` : '',
    o.once ? 'once' : '',
    effectWords(w, o.do ?? []),
    o.then === 'end' ? 'ends the talk' : o.then && o.then !== nodeId ? `→ ${o.then}` : 'back to this menu',
  ].filter((f) => f);
  out.push(...wrap(flags.join(' · '), CARD_CHARS + 2).map((r) => ({ runs: [{ text: '   ', cls: '' }, ...r], cls: 'small muted' })));
  return out;
}

/** Effects, briefly: "sets guard bribed · trust +1 · +5 points". */
function effectWords(w: World, fx: Effect[]): string {
  const out: string[] = [];
  const name = (v: string) => {
    const dot = v.indexOf('.');
    return dot > 0 ? `${thingName(w, v.slice(0, dot))} ${v.slice(dot + 1)}` : v;
  };
  for (const e of fx) {
    if ('set' in e) out.push(e.to === true ? `sets ${name(e.set)}` : e.to === false ? `clears ${name(e.set)}` : `${name(e.set)} = ${String(e.to)}`);
    else if ('inc' in e) out.push(`${name(e.inc)} +${e.by ?? 1}`);
    else if ('dec' in e) out.push(`${name(e.dec)} −${e.by ?? 1}`);
    else if ('award' in e) out.push(`+${w.scores.get(e.award)?.points ?? 0} points`);
    else if ('end' in e) out.push(`ends the game: ${w.endings.get(e.end)?.title ?? e.end}`);
    else if ('move' in e) out.push(`moves ${thingName(w, e.move)}`);
    else if ('act' in e) out.push(`starts act ${e.act}`);
    else if ('converse' in e) out.push(`talks to ${thingName(w, e.converse)}`);
    else if ('if' in e) out.push('…');
  }
  return out.join(' · ');
}

function topicsCard(w: World, person: Thing): Card {
  const lines: Line[] = [];
  const talk = prose(w, person.talk, person.id);
  if (talk) lines.push(...wrap(`talk to: ${quoted(firstSentence(talk, 100))}`, CARD_CHARS).map((r) => ({ runs: r, cls: 'small muted' })));
  person.topics.forEach((t, i) => {
    lines.push(...wrap(t.keys.join(' / '), CARD_CHARS).map((r, k) => ({ runs: r, cls: 'b', gap: k === 0 ? (i === 0 ? 4 : 6) : 0, rule: k === 0 && i === 0 })));
    lines.push(...wrap(quoted(firstSentence(prose(w, t.text, person.id), 120)), CARD_CHARS - 3).map((r) => ({ runs: [{ text: '   ', cls: '' }, ...r], cls: 'small em' })));
    const flags = [t.if ? `only if ${conditionWords(w, t.if)}` : '', t.once ? 'once' : '', effectWords(w, t.do ?? [])].filter((f) => f);
    if (flags.length > 0) lines.push(...wrap(flags.join(' · '), CARD_CHARS + 2).map((r) => ({ runs: [{ text: '   ', cls: '' }, ...r], cls: 'small muted' })));
  });
  const none = prose(w, person.noTopic, person.id);
  if (none) lines.push(...wrap(`anything else: ${quoted(firstSentence(none, 100))}`, CARD_CHARS).map((r, k) => ({ runs: r, cls: 'small muted', gap: k === 0 ? 6 : 0 })));
  return { id: `topics:${person.id}`, title: 'ASK / TELL ABOUT', tag: `${person.topics.length} topics`, lines, w: CARD_W, h: cardHeight(lines) };
}

/** Text in quotation marks, unless it already starts with speech. */
function quoted(text: string): string {
  return /^["“‘']/.test(text) ? text : `“${text}”`;
}

const HEAD = 24;

function cardHeight(lines: Line[]): number {
  return HEAD + 8 + lines.reduce((t, l) => t + LINE + (l.gap ?? 0), 0) + 6;
}

function drawCard(c: Card, b: Box): string[] {
  if (c.pill) {
    return [
      `<rect class="card" x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" rx="13" stroke-width="2"/>`,
      `<text x="${n(b.x + b.w / 2)}" y="${n(b.y + 17)}" class="b" text-anchor="middle">${esc(c.title)}</text>`,
    ];
  }
  const out = [
    `<rect class="card" x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" rx="4"/>`,
    `<rect class="band" x="${n(b.x + 0.6)}" y="${n(b.y + 0.6)}" width="${n(b.w - 1.2)}" height="${HEAD}" rx="3.5" fill="#f3e7f1"/>`,
    textLine(b.x + PAD, b.y + 16, [{ text: c.title, cls: '' }], 'head'),
  ];
  if (c.tag) out.push(`<text x="${n(b.x + b.w - PAD)}" y="${n(b.y + 16)}" class="small muted" text-anchor="end">${esc(c.tag)}</text>`);
  let y = b.y + HEAD + 8 + 10;
  for (const l of c.lines) {
    y += l.gap ?? 0;
    if (l.rule) out.push(`<line x1="${n(b.x + PAD)}" y1="${n(y - 12)}" x2="${n(b.x + b.w - PAD)}" y2="${n(y - 12)}" stroke="#d9d3c7"/>`);
    out.push(textLine(b.x + PAD, y, l.runs, l.cls));
    y += LINE;
  }
  return out;
}
