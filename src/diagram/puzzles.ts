// The puzzle chart: what the player must do before what, worked out from the
// pack's rules, conditions and effects, and labelled in the game's words.
//
// A step is something the player does (a command a rule answers, taking or
// wearing something, a way that opens, a line of dialogue) or something that
// happens (arriving somewhere, every turn). A step needs states; other steps
// make them. Only steps that lead to a score or an ending are drawn.
//
// Rules are tried in order and the first that applies stops the rest, so a
// rule also needs whatever stops the rules before it from applying: a
// "you'd need a crowbar" rule ahead of "prise the strongbox" makes the crowbar a need
// of prising. Scripts can't be seen into, so what they do is not drawn.

import type { CompileResult } from '../engine/pack.ts';
import type { Comparison, Condition, Effect, Exit, Matcher, Rule, Value, World } from '../engine/types.ts';
import { CHAR, clip, firstSentence, label, LINE, n, svgDocument, textLine, wrap, wrapRuns, type Box, type Run } from './svg.ts';
import { actTitle, command, conditionWords, optionWords, places, prose, thingName } from './words.ts';

type Compiled = Pick<CompileResult, 'moves' | 'playerMoves'>;

type Need =
  | { kind: 'var'; name: string; cmp: Comparison }
  | { kind: 'has' | 'wearing' | 'placed'; id: string }
  | { kind: 'in'; obj: string; place: string }
  | { kind: 'act'; id: string; atLeast: boolean }
  | { kind: 'said'; ref: string }
  | { kind: 'reach'; gate: string; room: string }
  | { kind: 'knows'; text: string };

type Make =
  | { kind: 'var'; name: string; set?: Value; inc?: boolean; dec?: boolean }
  | { kind: 'has' | 'wearing' | 'placed'; id: string }
  | { kind: 'in'; obj: string; place: string }
  | { kind: 'act'; id: string }
  | { kind: 'said'; ref: string }
  | { kind: 'reach'; gate: string }
  | { kind: 'knows'; text: string };

type StepKind = 'rule' | 'take' | 'gate' | 'talk' | 'read' | 'ending';

interface Step {
  id: string;
  kind: StepKind;
  title: string;
  where: string;
  quote: string;
  points: number;
  ends: string[];
  /** Each clause is a list of alternatives. */
  needs: Need[][];
  makes: Make[];
}

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
// Steps

function buildSteps(w: World, c: Compiled): Map<string, Step> {
  const steps = new Map<string, Step>();
  const add = (s: Step) => steps.set(s.id, s);
  const reach = reachability(w, c);
  const reachNeed = (room: string | null | undefined): Need[][] => {
    const gate = room ? reach.via.get(room) : undefined;
    return gate ? [[{ kind: 'reach', gate, room: room! }]] : [];
  };
  const reachAll = (rooms: string[]): Need[][] => {
    const gates = new Set(rooms.map((r) => reach.via.get(r) ?? null));
    return gates.size === 1 && rooms.length > 0 ? reachNeed(rooms[0]) : [];
  };

  // Rules.
  for (const r of w.rules) {
    const fx = effects(w, r.do ?? []);
    if (fx.makes.length === 0 && fx.points === 0 && fx.ends.length === 0) continue;
    const blocked = blockers(w, r);
    if (blocked === null) continue; // an earlier rule always answers first
    const action = r.actions[0];
    const own = needsOf(w, r.if);
    // Where it happens: the rule's rooms, or else where the thing it is about
    // stays put (or is picked up).
    const target = first(r.object);
    const thing = target ? w.things.get(target) : undefined;
    const stays = thing && (thing.fixed || thing.scenery || thing.door || (thing.kind === 'character' && !thing.wander));
    const at = thing && (stays || action === 'take') ? startRoom(w, thing.id) : null;
    const rooms = r.in !== undefined ? roomsOf(w, r.in) : at ? [at] : [];
    const title =
      action === 'arrive'
        ? `arrive in ${places(w, r.in) || 'any room'}`
        : action === 'everyTurn'
          ? 'every turn'
          : action === 'start'
            ? 'at the start'
            : `> ${command(w, action, { object: r.object, with: r.with, topic: r.topic, dir: r.dir })}`;
    const where = [action !== 'arrive' && r.in !== undefined ? `in ${places(w, r.in)}` : '', ...own.also, ...blocked.also]
      .filter((x) => x !== '')
      .join(' · ');
    const knows: Need[][] = [];
    for (const text of topicsOf(r)) {
      const source = knowledgeSource(w, text, steps, reachNeed);
      if (!source) continue;
      add(source);
      knows.push([{ kind: 'knows', text }]);
    }
    add({
      id: `rule:${r.id}`,
      kind: 'rule',
      title,
      where,
      quote: firstSentence(prose(w, r.say ?? fx.say, first(r.object)), 90),
      points: fx.points,
      ends: fx.ends,
      needs: [...own.needs, ...blocked.needs, ...reachAll(rooms), ...knows],
      makes: fx.makes,
    });
  }

  // Dialogue options that change something, or that something asks about.
  const saidAbout = new Set<string>();
  const scan = (cond: Condition | null | undefined) => {
    for (const x of atoms(cond)) if ('said' in x) saidAbout.add(x.said);
  };
  for (const r of w.rules) scan(r.if);
  for (const d of w.dialogues.values()) for (const node of Object.values(d.nodes ?? {})) for (const o of node.options ?? []) scan(o.if);
  for (const [who, d] of w.dialogues) {
    const person = w.things.get(who);
    for (const node of Object.values(d.nodes ?? {})) {
      for (const o of node.options ?? []) {
        const fx = effects(w, o.do ?? []);
        const ref = `${who}.${o.id}`;
        if (fx.makes.length === 0 && fx.points === 0 && fx.ends.length === 0 && !saidAbout.has(ref)) continue;
        const own = needsOf(w, o.if);
        add({
          id: `talk:${ref}`,
          kind: 'talk',
          title: `${person?.name ?? who}: ${clip(prose(w, o.text), 60)}`,
          where: own.also.join(' · '),
          quote: firstSentence(prose(w, o.reply ?? o.line), 90),
          points: fx.points,
          ends: fx.ends,
          needs: [...own.needs, ...reachNeed(person?.location)],
          makes: [{ kind: 'said', ref }, ...fx.makes],
        });
      }
    }
  }

  // Topics that change something.
  for (const t of w.things.values()) {
    for (const topic of t.topics) {
      const fx = effects(w, topic.do ?? []);
      if (fx.makes.length === 0 && fx.points === 0 && fx.ends.length === 0) continue;
      const own = needsOf(w, topic.if);
      add({
        id: `topic:${t.id}:${topic.id}`,
        kind: 'talk',
        title: `> ask ${t.name} about ${topic.keys[0]}`,
        where: own.also.join(' · '),
        quote: firstSentence(prose(w, topic.text), 90),
        points: fx.points,
        ends: fx.ends,
        needs: [...own.needs, ...reachNeed(t.location)],
        makes: fx.makes,
      });
    }
  }

  // Ways that open: a condition on an exit, a locked door, a region's entry condition.
  for (const g of reach.gates) {
    const own = needsOf(w, g.condition);
    add({
      id: `gate:${g.id}`,
      kind: 'gate',
      title: g.title,
      where: [`from ${w.rooms.get(g.from)!.name}`, ...own.also].join(' · '),
      quote: firstSentence(prose(w, g.refusal), 90),
      points: 0,
      ends: [],
      needs: [...own.needs, ...reachNeed(g.from)],
      makes: [{ kind: 'reach', gate: g.id }],
    });
    const door = g.door ? w.things.get(g.door) : undefined;
    for (const key of door?.keys ?? []) {
      add({
        id: `unlock:${g.door}:${key}`,
        kind: 'take',
        title: `> unlock ${door!.name} with ${thingName(w, key)}`,
        where: `in ${w.rooms.get(g.from)!.name}`,
        quote: '',
        points: 0,
        ends: [],
        needs: [[{ kind: 'has', id: key }], ...reachNeed(g.from)],
        makes: [{ kind: 'var', name: `${g.door}.locked`, set: false }],
      });
    }
  }

  // Taking, wearing and putting: the standard actions that make "carrying",
  // "wearing" and "in" true. Made for whatever some step needs.
  const wanted = new Set<string>();
  const want = (need: Need) => {
    const key = needKey(need);
    if (wanted.has(key) || !needIsOpen(w, need)) return;
    wanted.add(key);
    if (need.kind === 'has') {
      const t = w.things.get(need.id);
      if (!t || t.kind !== 'object' || t.fixed) return;
      const room = startRoom(w, t.id);
      const s: Step = {
        id: `take:${t.id}`,
        kind: 'take',
        title: `> take ${t.name}`,
        where: placeChain(w, t.id),
        quote: '',
        points: 0,
        ends: [],
        needs: [...reachNeed(room), ...(t.location === null ? [[{ kind: 'placed' as const, id: t.id }]] : [])],
        makes: [{ kind: 'has', id: t.id }],
      };
      add(s);
      s.needs.flat().forEach(want);
    } else if (need.kind === 'wearing') {
      const t = w.things.get(need.id);
      if (!t) return;
      const s: Step = {
        id: `wear:${t.id}`,
        kind: 'take',
        title: `> wear ${t.name}`,
        where: '',
        quote: '',
        points: 0,
        ends: [],
        needs: [[{ kind: 'has', id: t.id }]],
        makes: [{ kind: 'wearing', id: t.id }],
      };
      add(s);
      s.needs.flat().forEach(want);
    } else if (need.kind === 'in') {
      const t = w.things.get(need.obj);
      const place = w.things.get(need.place);
      if (!t || !place || t.fixed || !(place.container || place.surface)) return;
      const s: Step = {
        id: `put:${t.id}:${place.id}`,
        kind: 'take',
        title: `> put ${t.name} ${place.surface ? 'on' : 'in'} ${place.name}`,
        where: placeChain(w, place.id),
        quote: '',
        points: 0,
        ends: [],
        needs: [[{ kind: 'has', id: t.id }], ...reachNeed(startRoom(w, place.id))],
        makes: [{ kind: 'in', obj: t.id, place: place.id }],
      };
      add(s);
      s.needs.flat().forEach(want);
    }
  };
  for (const s of [...steps.values()]) s.needs.flat().forEach(want);

  // Endings.
  for (const [id, e] of w.endings) {
    if (![...steps.values()].some((s) => s.ends.includes(id))) continue;
    add({ id: `end:${id}`, kind: 'ending', title: e.title, where: e.win ? 'win' : 'lose', quote: '', points: 0, ends: [], needs: [], makes: [] });
  }
  return steps;
}

/** What a list of effects does, looking inside "if" effects too. */
function effects(w: World, list: Effect[]): { makes: Make[]; points: number; ends: string[]; say: string | undefined } {
  const out = { makes: [] as Make[], points: 0, ends: [] as string[], say: undefined as string | undefined };
  const walk = (fx: Effect[]) => {
    for (const e of fx) {
      if ('set' in e) out.makes.push({ kind: 'var', name: e.set, set: e.to });
      else if ('inc' in e) out.makes.push({ kind: 'var', name: e.inc, inc: true });
      else if ('dec' in e) out.makes.push({ kind: 'var', name: e.dec, dec: true });
      else if ('move' in e) out.makes.push(e.to === 'player' ? { kind: 'has', id: e.move } : { kind: 'in', obj: e.move, place: e.to }, { kind: 'placed', id: e.move });
      else if ('act' in e) out.makes.push({ kind: 'act', id: e.act });
      else if ('award' in e) out.points += w.scores.get(e.award)?.points ?? 0;
      else if ('end' in e) out.ends.push(e.end);
      else if ('if' in e) {
        walk(e.then ?? []);
        walk(e.else ?? []);
      } else if ('say' in e && out.say === undefined && typeof e.say === 'string') out.say = e.say;
    }
  };
  walk(list);
  return out;
}

interface Needs {
  needs: Need[][];
  /** Conditions that aren't steps to take: where, who is here, what must not be so. */
  also: string[];
}

function needsOf(w: World, cond: Condition | null | undefined): Needs {
  const out: Needs = { needs: [], also: [] };
  if (cond) collect(w, cond, false, out);
  return out;
}

function collect(w: World, c: Condition, negated: boolean, out: Needs): void {
  if ('not' in c) return collect(w, c.not, !negated, out);
  if ('all' in c && !negated) return c.all.forEach((x) => collect(w, x, false, out));
  if ('any' in c && negated) return c.any.forEach((x) => collect(w, x, true, out));
  if ('any' in c && !negated) {
    const alternatives = c.any.map((x) => needOf(x, false));
    if (alternatives.every((x) => x !== null)) out.needs.push(alternatives as Need[]);
    else out.also.push(conditionWords(w, c));
    return;
  }
  const need = needOf(c, negated);
  if (need) out.needs.push([need]);
  else out.also.push(negated ? `unless ${conditionWords(w, c)}` : conditionWords(w, c));
}

function needOf(c: Condition, negated: boolean): Need | null {
  if ('var' in c) {
    const cmp: Comparison = { eq: c.eq, ne: c.ne, gt: c.gt, gte: c.gte, lt: c.lt, lte: c.lte };
    return { kind: 'var', name: c.var, cmp: negated ? flip(cmp) : cmp };
  }
  if (negated) return null;
  if ('has' in c) return { kind: 'has', id: c.has };
  if ('wearing' in c) return { kind: 'wearing', id: c.wearing };
  if ('obj' in c) return { kind: 'in', obj: c.obj, place: c.in };
  if ('act' in c) return { kind: 'act', id: c.act, atLeast: false };
  if ('actAtLeast' in c) return { kind: 'act', id: c.actAtLeast, atLeast: true };
  if ('said' in c) return { kind: 'said', ref: c.said };
  return null;
}

function flip(c: Comparison): Comparison {
  if (c.eq !== undefined) return { ne: c.eq };
  if (c.ne !== undefined) return { eq: c.ne };
  if (c.gte !== undefined) return { lt: c.gte };
  if (c.gt !== undefined) return { lte: c.gt };
  if (c.lte !== undefined) return { gt: c.lte };
  if (c.lt !== undefined) return { gte: c.lt };
  return { eq: false };
}

function atoms(c: Condition | null | undefined): Condition[] {
  if (!c) return [];
  if ('all' in c) return c.all.flatMap(atoms);
  if ('any' in c) return c.any.flatMap(atoms);
  if ('not' in c) return atoms(c.not);
  return [c];
}

function first(m: Matcher | undefined): string | undefined {
  return Array.isArray(m) ? m[0] : m;
}

function list(m: Matcher | undefined): string[] | undefined {
  return m === undefined ? undefined : Array.isArray(m) ? m : [m];
}

/**
 * What a rule needs because the rules before it must not answer first. Null
 * if an earlier rule always answers, so this one never runs.
 */
function blockers(w: World, r: Rule): Needs | null {
  const out: Needs = { needs: [], also: [] };
  if (['arrive', 'everyTurn', 'start'].includes(r.actions[0])) return out;
  for (const s of w.rules) {
    if (s === r) break;
    if (s.when !== r.when || s.continue || s.once || !s.actions.some((a) => r.actions.includes(a))) continue;
    if (!covers(w, s, r)) continue;
    if (!s.if) return null;
    collect(w, { not: s.if }, false, out);
  }
  return out;
}

/** Does rule s apply in every situation rule r applies in? */
function covers(w: World, s: Rule, r: Rule): boolean {
  const field = (a: Matcher | undefined, b: Matcher | undefined) => {
    const sa = list(a);
    const rb = list(b);
    if (sa === undefined) return true;
    if (rb === undefined) return false;
    return sa.includes('*') || rb.every((x) => sa.includes(x));
  };
  const rooms = (m: Matcher | undefined) => {
    const l = list(m);
    return l === undefined ? undefined : l.flatMap((x) => (w.rooms.has(x) ? [x] : [...w.rooms.values()].filter((y) => y.region === x).map((y) => y.id)));
  };
  return (
    field(s.object, r.object) &&
    field(s.with, r.with) &&
    field(s.dir, r.dir) &&
    field(s.topic, r.topic) &&
    field(rooms(s.in), rooms(r.in))
  );
}

function roomsOf(w: World, m: Matcher | undefined): string[] {
  const l = list(m) ?? [];
  return l.flatMap((x) => (w.rooms.has(x) ? [x] : [...w.rooms.values()].filter((y) => y.region === x).map((y) => y.id)));
}

/** Literal words a rule's topic asks for, like a door code. */
function topicsOf(r: Rule): string[] {
  return (list(r.topic) ?? []).filter((t) => /\d/.test(t) || t.length >= 4);
}

/** Where the player can learn a literal: a thing's text that contains it. */
function knowledgeSource(w: World, text: string, steps: Map<string, Step>, reachNeed: (room: string | null | undefined) => Need[][]): Step | null {
  for (const t of w.things.values()) {
    for (const [verb, def] of [
      ['read', t.read],
      ['examine', t.description],
    ] as const) {
      const words = prose(w, def, t.id);
      if (!words.includes(text)) continue;
      const id = `read:${t.id}`;
      const existing = steps.get(id);
      if (existing) return existing;
      const sentence = words.split(/(?<=[.!?])\s+/).find((x) => x.includes(text)) ?? words;
      return {
        id,
        kind: 'read',
        title: `> ${verb} ${t.name}`,
        where: placeChain(w, t.id),
        quote: clip(sentence, 90),
        points: 0,
        ends: [],
        needs: reachNeed(startRoom(w, t.id)),
        makes: [{ kind: 'knows', text }],
      };
    }
  }
  return null;
}

function startRoom(w: World, id: string): string | null {
  let at: string | null = id;
  for (let i = 0; at !== null && i < 20; i++) {
    if (w.rooms.has(at)) return at;
    const t = w.things.get(at);
    if (!t) return null;
    at = t.location ?? t.foundIn[0] ?? null;
  }
  return null;
}

function placeChain(w: World, id: string): string {
  const parts: string[] = [];
  let at = w.things.get(id)?.location ?? null;
  for (let i = 0; at !== null && i < 20; i++) {
    const room = w.rooms.get(at);
    if (room) {
      parts.push(`in ${room.name}`);
      break;
    }
    const t = w.things.get(at);
    if (!t) break;
    parts.push(`${t.surface ? 'on' : t.kind === 'character' ? 'with' : 'in'} the ${t.name}`);
    at = t.location;
  }
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Reachability: which way that opens each room lies behind

interface Gate {
  id: string;
  from: string;
  to: string;
  title: string;
  condition: Condition | null;
  refusal: Exit['else'];
  door: string | null;
}

function reachability(w: World, c: Compiled): { via: Map<string, string | null>; gates: Gate[] } {
  const gateOf = (from: string, e: Exit): Gate | null => {
    if (!e.to || !w.rooms.has(e.to)) return null;
    const to = w.rooms.get(e.to)!;
    const region = to.region !== null && to.region !== w.rooms.get(from)!.region ? w.regions.get(to.region) : undefined;
    const door = e.door ? w.things.get(e.door) : undefined;
    const locked = door?.initialProps.locked === true;
    const condition: Condition | null = e.if
      ? e.if
      : locked
        ? { var: `${door!.id}.locked`, eq: false }
        : region?.if
          ? region.if
          : null;
    if (!condition) return null;
    const id = locked ? `door:${door!.id}` : `${from}:${e.dir}`;
    const title = locked ? `> ${e.dir} through ${door!.name}` : `> ${e.dir} to ${to.name}`;
    return { id, from, to: e.to, title, condition, refusal: e.if ? e.else : (region?.else ?? null), door: locked ? door!.id : null };
  };
  // 0-1 breadth-first search: an open way costs nothing, a gated one costs one.
  const via = new Map<string, string | null>();
  const cost = new Map<string, number>();
  const gates = new Map<string, Gate>();
  const deque: string[] = [];
  const starts = [w.manifest.start, ...w.validator.assumeReachable, ...c.playerMoves.map((m) => m.room)];
  for (const s of starts) {
    if (!w.rooms.has(s) || cost.has(s)) continue;
    cost.set(s, s === w.manifest.start ? 0 : 0);
    via.set(s, null);
    deque.push(s);
  }
  while (deque.length > 0) {
    const at = deque.shift()!;
    for (const e of w.rooms.get(at)!.exits.values()) {
      if (!e.to || !w.rooms.has(e.to)) continue;
      const g = gateOf(at, e);
      if (g) gates.set(g.id, gates.get(g.id) ?? g);
      const next = cost.get(at)! + (g ? 1 : 0);
      if (cost.has(e.to) && cost.get(e.to)! <= next) continue;
      cost.set(e.to, next);
      via.set(e.to, g ? g.id : via.get(at)!);
      if (g) deque.push(e.to);
      else deque.unshift(e.to);
    }
  }
  const used = new Set(via.values());
  return { via, gates: [...gates.values()].filter((g) => used.has(g.id)) };
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

function needKey(n: Need): string {
  return JSON.stringify(n);
}

function initialValue(w: World, name: string): Value | undefined {
  const dot = name.indexOf('.');
  if (dot > 0) {
    const id = name.slice(0, dot);
    const prop = name.slice(dot + 1);
    const holder = w.things.get(id) ?? w.rooms.get(id);
    return holder?.initialProps[prop];
  }
  return w.vars[name];
}

function compare(v: Value | undefined, c: Comparison): boolean {
  const x = v ?? null;
  if (c.eq !== undefined) return x === c.eq || (c.eq === false && !x);
  if (c.ne !== undefined) return x !== c.ne && !(c.ne === false && !x);
  const num = typeof x === 'number' ? x : 0;
  if (c.gte !== undefined) return num >= c.gte;
  if (c.gt !== undefined) return num > c.gt;
  if (c.lte !== undefined) return num <= c.lte;
  if (c.lt !== undefined) return num < c.lt;
  return !!x;
}

/** Is a need not already met when the game starts? */
function needIsOpen(w: World, need: Need): boolean {
  switch (need.kind) {
    case 'var':
      return !compare(initialValue(w, need.name), need.cmp);
    case 'has':
      return w.things.get(need.id)?.location !== 'player';
    case 'in':
      return w.things.get(need.obj)?.location !== need.place;
    case 'act':
      return need.atLeast ? w.acts.findIndex((a) => a.id === need.id) > 0 : w.acts[0]?.id !== need.id;
    case 'placed':
      return w.things.get(need.id)?.location === null;
    default:
      return true;
  }
}

function fulfils(w: World, m: Make, need: Need): boolean {
  if (m.kind !== need.kind) return false;
  switch (need.kind) {
    case 'var': {
      const v = m as Extract<Make, { kind: 'var' }>;
      if (v.name !== need.name) return false;
      if (v.set !== undefined) return compare(v.set, need.cmp);
      const c = need.cmp;
      if (v.inc) return c.gt !== undefined || c.gte !== undefined || (c.eq === undefined && c.ne === undefined && c.lt === undefined && c.lte === undefined);
      if (v.dec) return c.lt !== undefined || c.lte !== undefined;
      return false;
    }
    case 'has':
    case 'wearing':
    case 'placed':
      return (m as { id: string }).id === need.id;
    case 'in':
      return (m as { obj: string }).obj === need.obj && (m as { place: string }).place === need.place;
    case 'act': {
      const made = w.acts.findIndex((a) => a.id === (m as { id: string }).id);
      const wanted = w.acts.findIndex((a) => a.id === need.id);
      return need.atLeast ? made >= wanted : made === wanted;
    }
    case 'said':
      return (m as { ref: string }).ref === need.ref;
    case 'reach':
      return (m as { gate: string }).gate === need.gate;
    case 'knows':
      return (m as { text: string }).text === need.text;
  }
}

function needWords(w: World, need: Need): string {
  switch (need.kind) {
    case 'var':
      return conditionWords(w, { var: need.name, ...need.cmp });
    case 'has':
      return `carrying ${thingName(w, need.id)}`;
    case 'wearing':
      return `wearing ${thingName(w, need.id)}`;
    case 'placed':
      return `${thingName(w, need.id)} put somewhere`;
    case 'in':
      return `${thingName(w, need.obj)} in ${thingName(w, need.place)}`;
    case 'act':
      return `act ${actTitle(w, need.id)}${need.atLeast ? ' or later' : ''}`;
    case 'said':
      return `said ${clip(optionWords(w, need.ref), 30)}`;
    case 'reach':
      return `reach ${w.rooms.get(need.room)?.name ?? need.room}`;
    case 'knows':
      return `knows "${need.text}"`;
  }
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
