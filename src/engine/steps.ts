// What must happen before what: a pack's rules, conditions and effects read
// as steps. A step is something the player does (a command a rule answers,
// taking or wearing something, a way that opens, a line of dialogue) or
// something that happens (arriving somewhere, every turn). A step needs
// states; other steps make them.
//
// Rules are tried in order and the first that applies stops the rest, so a
// rule also needs whatever stops the rules before it from applying: a
// "you'd need a crowbar" rule ahead of "prise the strongbox" makes the crowbar
// a need of prising.
//
// The puzzle chart draws these steps; the validator runs them forward from
// the start to find endings and scores nothing can reach. It is a model, not
// the game: scripts can't be seen into, and once a state is made it is taken
// to stay made.

import type { CompileResult } from './pack.ts';
import type { Comparison, Condition, Effect, Exit, Matcher, Rule, Value, World } from './types.ts';
import { actTitle, clip, command, conditionWords, firstSentence, optionWords, places, prose, thingName } from './words.ts';

type Compiled = Pick<CompileResult, 'moves' | 'playerMoves'>;

export type Need =
  | { kind: 'var'; name: string; cmp: Comparison }
  | { kind: 'has' | 'wearing' | 'placed'; id: string }
  | { kind: 'in'; obj: string; place: string }
  | { kind: 'act'; id: string; atLeast: boolean }
  | { kind: 'said'; ref: string }
  | { kind: 'reach'; gate: string; room: string }
  | { kind: 'knows'; text: string };

export type Make =
  | { kind: 'var'; name: string; set?: Value; inc?: boolean; dec?: boolean }
  | { kind: 'has' | 'wearing' | 'placed'; id: string }
  | { kind: 'in'; obj: string; place: string }
  | { kind: 'act'; id: string }
  | { kind: 'said'; ref: string }
  | { kind: 'reach'; gate: string }
  | { kind: 'knows'; text: string };

export type StepKind = 'rule' | 'take' | 'gate' | 'talk' | 'read' | 'ending';

export interface Step {
  id: string;
  kind: StepKind;
  title: string;
  where: string;
  quote: string;
  points: number;
  awards: string[];
  ends: string[];
  /** Each clause is a list of alternatives. */
  needs: Need[][];
  makes: Make[];
}

export interface Gate {
  id: string;
  from: string;
  to: string;
  title: string;
  condition: Condition;
  refusal: Exit['else'];
  door: string | null;
}

export interface Reach {
  gates: Map<string, Gate>;
  /** For each room that isn't open from the start, every gate that opens a way to it. */
  opens: Map<string, string[]>;
}

export function buildSteps(w: World, c: Compiled): Map<string, Step> {
  const steps = new Map<string, Step>();
  const add = (s: Step) => steps.set(s.id, s);
  const reach = reachability(w, c);
  const reachNeed = (room: string | null | undefined): Need[][] => {
    const gates = room ? (reach.opens.get(room) ?? []) : [];
    return gates.length > 0 ? [gates.map((gate) => ({ kind: 'reach', gate, room: room! }))] : [];
  };
  // Any one of several rooms will do: no need if one is open from the start.
  const reachAny = (rooms: string[]): Need[][] => {
    if (rooms.length === 0 || rooms.some((r) => (reach.opens.get(r) ?? []).length === 0)) return [];
    const clause = rooms.flatMap((r) => reachNeed(r)[0]);
    return [clause.filter((x, i) => clause.findIndex((y) => needKey(y) === needKey(x)) === i)];
  };

  // Rules.
  for (const r of w.rules) {
    const fx = effects(w, r.do ?? []);
    if (fx.makes.length === 0 && fx.awards.length === 0 && fx.ends.length === 0) continue;
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
      awards: fx.awards,
      ends: fx.ends,
      needs: [...own.needs, ...blocked.needs, ...reachAny(rooms), ...knows],
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
        if (fx.makes.length === 0 && fx.awards.length === 0 && fx.ends.length === 0 && !saidAbout.has(ref)) continue;
        const own = needsOf(w, o.if);
        add({
          id: `talk:${ref}`,
          kind: 'talk',
          title: `${person?.name ?? who}: ${clip(prose(w, o.text), 60)}`,
          where: own.also.join(' · '),
          quote: firstSentence(prose(w, o.reply ?? o.line), 90),
          points: fx.points,
          awards: fx.awards,
          ends: fx.ends,
          needs: [...own.needs, ...reachNeed(person ? startRoom(w, person.id) : null)],
          makes: [{ kind: 'said', ref }, ...fx.makes],
        });
      }
    }
  }

  // Topics that change something.
  for (const t of w.things.values()) {
    for (const topic of t.topics) {
      const fx = effects(w, topic.do ?? []);
      if (fx.makes.length === 0 && fx.awards.length === 0 && fx.ends.length === 0) continue;
      const own = needsOf(w, topic.if);
      add({
        id: `topic:${t.id}:${topic.id}`,
        kind: 'talk',
        title: `> ask ${t.name} about ${topic.keys[0]}`,
        where: own.also.join(' · '),
        quote: firstSentence(prose(w, topic.text), 90),
        points: fx.points,
        awards: fx.awards,
        ends: fx.ends,
        needs: [...own.needs, ...reachNeed(startRoom(w, t.id))],
        makes: fx.makes,
      });
    }
  }

  // Ways that open: a condition on an exit, a locked door, a region's entry condition.
  for (const g of reach.gates.values()) {
    const own = needsOf(w, g.condition);
    add({
      id: `gate:${g.id}`,
      kind: 'gate',
      title: g.title,
      where: [`from ${w.rooms.get(g.from)!.name}`, ...own.also].join(' · '),
      quote: firstSentence(prose(w, g.refusal), 90),
      points: 0,
      awards: [],
      ends: [],
      needs: [...own.needs, ...reachNeed(g.from)],
      makes: [{ kind: 'reach', gate: g.id }],
    });
  }

  // The standard actions that make "carrying", "wearing", "in", "open",
  // "unlocked" and "on" true, made for whatever some step needs.
  const wanted = new Set<string>();
  const step = (s: Omit<Step, 'quote' | 'points' | 'awards' | 'ends'>) => {
    if (steps.has(s.id)) return;
    const full: Step = { quote: '', points: 0, awards: [], ends: [], ...s };
    add(full);
    full.needs.flat().forEach(want);
  };
  const want = (need: Need): void => {
    const key = needKey(need);
    if (wanted.has(key) || !needIsOpen(w, need)) return;
    wanted.add(key);
    if (need.kind === 'has') {
      const t = w.things.get(need.id);
      if (!t || t.kind !== 'object' || t.fixed) return;
      step({
        id: `take:${t.id}`,
        kind: 'take',
        title: `> take ${t.name}`,
        where: placeChain(w, t.id),
        needs: [...reachNeed(startRoom(w, t.id)), ...(t.location === null ? [[{ kind: 'placed' as const, id: t.id }]] : [])],
        makes: [{ kind: 'has', id: t.id }],
      });
    } else if (need.kind === 'wearing') {
      const t = w.things.get(need.id);
      if (!t) return;
      step({ id: `wear:${t.id}`, kind: 'take', title: `> wear ${t.name}`, where: '', needs: [[{ kind: 'has', id: t.id }]], makes: [{ kind: 'wearing', id: t.id }] });
    } else if (need.kind === 'in') {
      const t = w.things.get(need.obj);
      if (!t || t.kind !== 'object' || t.fixed) return;
      const room = w.rooms.get(need.place);
      if (room) {
        step({
          id: `drop:${t.id}:${room.id}`,
          kind: 'take',
          title: `> drop ${t.name}`,
          where: `in ${room.name}`,
          needs: [[{ kind: 'has', id: t.id }], ...reachNeed(room.id)],
          makes: [{ kind: 'in', obj: t.id, place: room.id }],
        });
        return;
      }
      const place = w.things.get(need.place);
      if (!place || !(place.container || place.surface)) return;
      step({
        id: `put:${t.id}:${place.id}`,
        kind: 'take',
        title: `> put ${t.name} ${place.surface ? 'on' : 'in'} ${place.name}`,
        where: placeChain(w, place.id),
        needs: [[{ kind: 'has', id: t.id }], ...reachNeed(startRoom(w, place.id))],
        makes: [{ kind: 'in', obj: t.id, place: place.id }],
      });
    } else if (need.kind === 'var') {
      const dot = need.name.indexOf('.');
      const t = dot > 0 ? w.things.get(need.name.slice(0, dot)) : undefined;
      if (!t) return;
      const prop = need.name.slice(dot + 1);
      const to = compare(true, need.cmp) ? true : compare(false, need.cmp) ? false : null;
      if (to === null) return;
      const here = t.kind === 'object' && !t.fixed ? [[{ kind: 'has' as const, id: t.id }]] : reachNeed(startRoom(w, t.id));
      const where = t.kind === 'object' && !t.fixed ? '' : placeChain(w, t.id) || `in ${t.foundIn.map((r) => w.rooms.get(r)?.name ?? r).join(' or ')}`;
      if (prop === 'open' && t.openable) {
        const locked = t.lockable && t.initialProps.locked === true;
        step({
          id: `${to ? 'open' : 'close'}:${t.id}`,
          kind: 'take',
          title: `> ${to ? 'open' : 'close'} ${t.name}`,
          where,
          needs: [...here, ...(to && locked ? [[{ kind: 'var' as const, name: `${t.id}.locked`, cmp: { eq: false } }]] : [])],
          makes: [{ kind: 'var', name: need.name, set: to }],
        });
      } else if (prop === 'locked' && t.lockable) {
        for (const key of t.keys) {
          step({
            id: `${to ? 'lock' : 'unlock'}:${t.id}:${key}`,
            kind: 'take',
            title: `> ${to ? 'lock' : 'unlock'} ${t.name} with ${thingName(w, key)}`,
            where,
            needs: [[{ kind: 'has', id: key }], ...here],
            makes: [{ kind: 'var', name: need.name, set: to }],
          });
        }
      } else if (prop === 'on' && t.switchable) {
        step({
          id: `switch-${to ? 'on' : 'off'}:${t.id}`,
          kind: 'take',
          title: `> switch ${to ? 'on' : 'off'} ${t.name}`,
          where,
          needs: here,
          makes: [{ kind: 'var', name: need.name, set: to }],
        });
      }
    }
  };
  for (const s of [...steps.values()]) s.needs.flat().forEach(want);

  // Endings.
  for (const [id, e] of w.endings) {
    if (![...steps.values()].some((s) => s.ends.includes(id))) continue;
    add({ id: `end:${id}`, kind: 'ending', title: e.title, where: e.win ? 'win' : 'lose', quote: '', points: 0, awards: [], ends: [], needs: [], makes: [] });
  }
  return steps;
}

/** What a list of effects does, looking inside "if" effects too. */
function effects(w: World, list: Effect[]): { makes: Make[]; points: number; awards: string[]; ends: string[]; say: string | undefined } {
  const out = { makes: [] as Make[], points: 0, awards: [] as string[], ends: [] as string[], say: undefined as string | undefined };
  const walk = (fx: Effect[]) => {
    for (const e of fx) {
      if ('set' in e) out.makes.push({ kind: 'var', name: e.set, set: e.to });
      else if ('inc' in e) out.makes.push({ kind: 'var', name: e.inc, inc: true });
      else if ('dec' in e) out.makes.push({ kind: 'var', name: e.dec, dec: true });
      else if ('move' in e) out.makes.push(e.to === 'player' ? { kind: 'has', id: e.move } : { kind: 'in', obj: e.move, place: e.to }, { kind: 'placed', id: e.move });
      else if ('act' in e) out.makes.push({ kind: 'act', id: e.act });
      else if ('award' in e) {
        out.awards.push(e.award);
        out.points += w.scores.get(e.award)?.points ?? 0;
      } else if ('end' in e) out.ends.push(e.end);
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
  const rooms = (m: Matcher | undefined) => (m === undefined ? undefined : roomsOf(w, m));
  return field(s.object, r.object) && field(s.with, r.with) && field(s.dir, r.dir) && field(s.topic, r.topic) && field(rooms(s.in), rooms(r.in));
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
      if (existing) {
        if (!existing.makes.some((m) => m.kind === 'knows' && m.text === text)) existing.makes.push({ kind: 'knows', text });
        return existing;
      }
      const sentence = words.split(/(?<=[.!?])\s+/).find((x) => x.includes(text)) ?? words;
      return {
        id,
        kind: 'read',
        title: `> ${verb} ${t.name}`,
        where: placeChain(w, t.id),
        quote: clip(sentence, 90),
        points: 0,
        awards: [],
        ends: [],
        needs: reachNeed(startRoom(w, t.id)),
        makes: [{ kind: 'knows', text }],
      };
    }
  }
  return null;
}

/** The room a thing starts in, looking through what holds it. */
export function startRoom(w: World, id: string): string | null {
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
// Reachability: which ways that open lead to each room

/**
 * Rooms open from the start are those the start (or a movePlayer target)
 * reaches without crossing a gate. Every other room lists each gate that,
 * once crossed, leads to it without crossing another. A gate's own step
 * needs its starting room, so gates behind gates chain.
 */
export function reachability(w: World, c: Compiled): Reach {
  const gateOf = (from: string, e: Exit): Gate | null => {
    if (!e.to || !w.rooms.has(e.to)) return null;
    const to = w.rooms.get(e.to)!;
    const region = to.region !== null && to.region !== w.rooms.get(from)!.region ? w.regions.get(to.region) : undefined;
    const door = e.door ? w.things.get(e.door) : undefined;
    const locked = door?.initialProps.locked === true;
    const condition: Condition | null = e.if ? e.if : locked ? { var: `${door!.id}.locked`, eq: false } : (region?.if ?? null);
    if (!condition) return null;
    const id = locked ? `door:${door!.id}:${from}` : `${from}:${e.dir}`;
    const title = locked ? `> ${e.dir} through ${door!.name}` : `> ${e.dir} to ${to.name}`;
    return { id, from, to: e.to, title, condition, refusal: e.if ? e.else : (region?.else ?? null), door: locked ? door!.id : null };
  };
  const open = (from: string[]) => {
    const seen = new Set(from);
    const queue = [...from];
    while (queue.length > 0) {
      const at = queue.shift()!;
      for (const e of w.rooms.get(at)!.exits.values()) {
        if (!e.to || !w.rooms.has(e.to) || seen.has(e.to) || gateOf(at, e)) continue;
        seen.add(e.to);
        queue.push(e.to);
      }
    }
    return seen;
  };
  const starts = [w.manifest.start, ...w.validator.assumeReachable, ...c.playerMoves.map((m) => m.room)].filter((r) => w.rooms.has(r));
  const base = open(starts);
  const gates = new Map<string, Gate>();
  const opens = new Map<string, string[]>();
  for (const room of w.rooms.values()) {
    for (const e of room.exits.values()) {
      const g = gateOf(room.id, e);
      if (!g) continue;
      const beyond = [...open([g.to])].filter((r) => !base.has(r));
      if (beyond.length === 0) continue;
      gates.set(g.id, g);
      for (const r of beyond) opens.set(r, [...(opens.get(r) ?? []), g.id]);
    }
  }
  return { gates, opens };
}

// ---------------------------------------------------------------------------
// Needs and makes

export function needKey(n: Need): string {
  return JSON.stringify(n);
}

function initialValue(w: World, name: string): Value | undefined {
  const dot = name.indexOf('.');
  if (dot > 0) {
    const holder = w.things.get(name.slice(0, dot)) ?? w.rooms.get(name.slice(0, dot));
    return holder?.initialProps[name.slice(dot + 1)];
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
export function needIsOpen(w: World, need: Need): boolean {
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

export function fulfils(w: World, m: Make, need: Need): boolean {
  if (m.kind !== need.kind) return false;
  switch (need.kind) {
    case 'var': {
      const v = m as Extract<Make, { kind: 'var' }>;
      if (v.name !== need.name) return false;
      if (v.set !== undefined) return compare(v.set, need.cmp);
      const c = need.cmp;
      const plain = c.eq === undefined && c.ne === undefined && c.gt === undefined && c.gte === undefined && c.lt === undefined && c.lte === undefined;
      const number = typeof c.eq === 'number' || typeof c.ne === 'number';
      if (v.inc) return plain || number || c.gt !== undefined || c.gte !== undefined;
      if (v.dec) return number || c.lt !== undefined || c.lte !== undefined;
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

export function needWords(w: World, need: Need): string {
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
// Running the steps forward: what can be reached at all

export interface Progress {
  /** Steps that can happen, given everything before them. */
  done: Set<string>;
  /** Why a step can't happen: the first need nothing meets, traced back. */
  why: (stepId: string) => string;
}

/**
 * Start from the opening state and keep taking every step whose needs are
 * met until nothing changes. What is made is taken to stay made, so this
 * finds what can never happen, not what could be undone.
 */
export function runForward(w: World, steps: Map<string, Step>): Progress {
  const done = new Set<string>();
  const made: Make[] = [];
  const met = (need: Need) => !needIsOpen(w, need) || made.some((m) => fulfils(w, m, need));
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of steps.values()) {
      if (done.has(s.id) || s.kind === 'ending') continue;
      if (s.needs.every((clause) => clause.some(met))) {
        done.add(s.id);
        made.push(...s.makes);
        changed = true;
      }
    }
  }
  const scripted = w.scripts.effects.size > 0 || w.scripts.actions.size > 0 || w.scripts.conditions.size > 0;
  const name = (s: Step) => `"${s.title.replace(/^> /, '')}"`;
  const why = (stepId: string): string => {
    const parts: string[] = [];
    const seen = new Set<string>();
    let at = steps.get(stepId);
    for (let depth = 0; at && depth < 8; depth++) {
      seen.add(at.id);
      const clause = at.needs.find((cl) => !cl.some(met));
      if (!clause) break;
      const words = clause.map((x) => needWords(w, x)).join(' or ');
      const makers = [...steps.values()].filter((s) => s.makes.some((m) => clause.some((x) => fulfils(w, m, x))));
      parts.push(`${name(at)} needs ${words}`);
      if (makers.length === 0) {
        parts.push(`and nothing in the pack makes that${scripted ? ' (unless a script does)' : ''}`);
        break;
      }
      const next = makers.find((m) => !seen.has(m.id));
      if (!next) {
        parts.push(`which only ${makers.map(name).join(' or ')} can make: a loop`);
        break;
      }
      at = next;
    }
    return parts.join(', ');
  };
  return { done, why };
}
