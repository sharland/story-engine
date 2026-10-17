// The parser: input text -> tokens -> grammar match -> resolved command.
//
// Grammar patterns are strings such as "put OBJ in/into OBJ2". Lower-case
// tokens are literal words ("/" separates alternatives); OBJ and OBJ2 are noun
// phrases, TEXT is free text and DIR is one direction word. Every pattern
// that fits is ranked by its number of literal words; the best one whose noun
// phrases resolve wins.

import { RESERVED_WORDS } from './stdlib.ts';
import { normaliseWords } from './text.ts';
import type { Thing, World } from './types.ts';

export type Slot = 'OBJ' | 'OBJ2' | 'TEXT' | 'DIR';

type PatternToken = { kind: 'word'; words: string[] } | { kind: 'slot'; slot: Slot };

export interface Pattern {
  action: string;
  source: string;
  tokens: PatternToken[];
  literals: number;
  index: number;
}

export type Bindings = Partial<Record<Slot, string[]>>;

export interface Candidate {
  pattern: Pattern;
  bindings: Bindings;
  /** The words typed, when the whole input matched this pattern. */
  typed?: string[];
}

export interface ParsedCommand {
  action: string;
  nouns: string[];
  all: boolean;
  second: string | null;
  topic: string | null;
  dir: string | null;
  /** Lines to print before acting, such as "(with the key)". */
  notes: Array<{ key: string; params: Record<string, string> }>;
}

export type ParseOutcome =
  | { kind: 'ok'; command: ParsedCommand }
  | { kind: 'error'; key: string; params: Record<string, string> }
  | { kind: 'question'; pending: Pending; key: string; params: Record<string, string> };

export type Pending =
  | { kind: 'which'; candidate: Candidate; slot: Slot; phrase: number; options: string[] }
  | { kind: 'missing'; candidate: Candidate; slot: Slot };

/** What the parser needs to know about the game at this moment. */
export interface ParserEnv {
  world: World;
  scope(): Thing[];
  isHeld(id: string): boolean;
  isDirectlyHeld(id: string): boolean;
  isWorn(id: string): boolean;
  pronoun(word: 'it' | 'them' | 'him' | 'her'): string | null;
  /** Objects "all" stands for, for this action. */
  allFor(action: string, second: string | null): string[];
  /** Fill an omitted second noun (a key for unlock), or null. */
  implicitSecond(action: string, noun: string): string | null;
  /** Would locking or unlocking this need a key right now? (Not if it is already done.) */
  keyNeeded(action: 'lock' | 'unlock', noun: string): boolean;
  theName(id: string): string;
}

const SLOT_NAMES: Slot[] = ['OBJ', 'OBJ2', 'TEXT', 'DIR'];

export function compilePattern(action: string, source: string, index: number): Pattern {
  const tokens: PatternToken[] = source
    .trim()
    .split(/\s+/)
    .map((t) => (SLOT_NAMES.includes(t as Slot) ? { kind: 'slot', slot: t as Slot } : { kind: 'word', words: t.split('/') }));
  return { action, source, tokens, literals: tokens.filter((t) => t.kind === 'word').length, index };
}

/** Pack patterns come first so that, at equal rank, they win. */
export function compileGrammar(world: World): Pattern[] {
  const packFirst: Pattern[] = [];
  const standard: Pattern[] = [];
  let index = 0;
  for (const verb of world.verbs.values()) {
    verb.patterns.forEach((p, i) => {
      const target = verb.builtin && i < verb.standardCount ? standard : packFirst;
      target.push(compilePattern(verb.id, p, 0));
    });
  }
  return [...packFirst, ...standard].map((p) => ({ ...p, index: index++ }));
}

/** Every word the game knows: grammar words, directions, object words, keywords. */
export function knownWords(world: World, grammar: Pattern[]): Set<string> {
  const known = new Set<string>(RESERVED_WORDS);
  for (const p of grammar) for (const t of p.tokens) if (t.kind === 'word') t.words.forEach((w) => known.add(w));
  for (const w of world.directionWords.keys()) known.add(w);
  for (const t of world.things.values()) t.words.forEach((w) => known.add(w));
  for (const r of world.rooms.values()) normaliseWords(r.name).forEach((w) => known.add(w));
  return known;
}

// ---------------------------------------------------------------------------
// Input

const ARTICLES = new Set(['a', 'an', 'the']);

/** Split a line into commands, each a list of tokens. */
export function splitInput(line: string): string[][] {
  const commands: string[][] = [];
  for (const part of line.split(/[.;!?]+/)) {
    let current: string[] = [];
    for (const tok of tokenize(part)) {
      if (tok === 'then') {
        if (current.length > 0) commands.push(current);
        current = [];
      } else current.push(tok);
    }
    if (current.length > 0) commands.push(current);
  }
  return commands;
}

export function tokenize(s: string): string[] {
  const spaced = s.toLowerCase().replace(/[‘’']/g, '').replace(/,/g, ' , ');
  const out: string[] = [];
  for (const raw of spaced.split(/\s+/)) {
    if (raw === ',') {
      out.push(',');
      continue;
    }
    for (const w of normaliseWords(raw)) if (!ARTICLES.has(w)) out.push(w);
  }
  // Drop stray commas at either end.
  while (out[0] === ',') out.shift();
  while (out[out.length - 1] === ',') out.pop();
  return out;
}

// ---------------------------------------------------------------------------
// Matching

export function matchPattern(p: Pattern, tokens: string[], directionWords: Map<string, string>): Bindings[] {
  const results: Bindings[] = [];
  const walk = (pi: number, ti: number, b: Bindings) => {
    if (pi === p.tokens.length) {
      if (ti === tokens.length) results.push(b);
      return;
    }
    const tok = p.tokens[pi];
    if (tok.kind === 'word') {
      if (ti < tokens.length && tok.words.includes(tokens[ti])) walk(pi + 1, ti + 1, b);
      return;
    }
    if (tok.slot === 'DIR') {
      if (ti < tokens.length && directionWords.has(tokens[ti])) walk(pi + 1, ti + 1, { ...b, DIR: [tokens[ti]] });
      return;
    }
    for (let end = ti + 1; end <= tokens.length; end++) {
      const span = tokens.slice(ti, end);
      if (span.includes(',') && tok.slot !== 'OBJ') continue;
      walk(pi + 1, end, { ...b, [tok.slot]: span });
    }
  };
  walk(0, 0, {});
  return results;
}

/** A pattern whose final noun the player left off: "take", "put X in". */
function matchPrefix(p: Pattern, tokens: string[], directionWords: Map<string, string>): Candidate | null {
  const last = p.tokens[p.tokens.length - 1];
  if (p.tokens.length < 2 || last.kind !== 'slot' || (last.slot !== 'OBJ' && last.slot !== 'OBJ2')) return null;
  const head: Pattern = { ...p, tokens: p.tokens.slice(0, -1) };
  const m = matchPattern(head, tokens, directionWords);
  return m.length > 0 ? { pattern: p, bindings: m[0] } : null;
}

// ---------------------------------------------------------------------------
// Parsing

export function parse(env: ParserEnv, grammar: Pattern[], tokens: string[], known: Set<string>): ParseOutcome {
  const candidates: Candidate[] = [];
  for (const p of grammar) {
    for (const b of matchPattern(p, tokens, env.world.directionWords)) candidates.push({ pattern: p, bindings: b, typed: tokens });
  }
  candidates.sort((a, b) => b.pattern.literals - a.pattern.literals || a.pattern.index - b.pattern.index);

  if (candidates.length === 0) {
    // A command with its last noun left off asks for it.
    let nounError: ParseOutcome | null = null;
    for (const p of grammar) {
      const c = matchPrefix(p, tokens, env.world.directionWords);
      if (!c) continue;
      const last = p.tokens[p.tokens.length - 1] as { kind: 'slot'; slot: Slot };
      let firstId: string | null = null;
      if (last.slot === 'OBJ2') {
        const r = resolveSlot(env, c, 'OBJ', known);
        if (r.kind === 'error') nounError ??= r;
        if (r.kind !== 'ok' || r.ids.length !== 1) continue;
        firstId = r.ids[0];
      }
      return {
        kind: 'question',
        pending: { kind: 'missing', candidate: c, slot: last.slot },
        key: 'whatToVerb',
        params: { verb: typedPhrase(env, c, tokens, firstId) },
      };
    }
    if (nounError) return nounError;
    const unknown = tokens.find((t) => t !== ',' && !known.has(t));
    if (unknown) return { kind: 'error', key: 'unknownWord', params: { word: unknown } };
    return { kind: 'error', key: 'notUnderstood', params: {} };
  }

  let firstError: ParseOutcome | null = null;
  // Actions whose better-ranked pattern named someone or something not here.
  const absent = new Set<string>();
  for (const c of candidates) {
    // Free text must not swallow it: "answer her with yes" when she has gone
    // is not "answer" with the text "her with yes".
    if (c.bindings.TEXT && absent.has(c.pattern.action)) continue;
    const r = resolveCandidate(env, c, known);
    if (r.kind === 'ok' || r.kind === 'question') return r;
    if (r.key === 'cantSeeThat' || r.key === 'pronounGone') absent.add(c.pattern.action);
    firstError ??= r;
  }
  return firstError!;
}

/**
 * Re-run a candidate after the player answered a question. Returns null if
 * the input does not answer a "which" question; for a missing noun it returns
 * the resolution, which may be an error the caller weighs against parsing the
 * input as a new command.
 */
export function answer(
  env: ParserEnv,
  pending: Pending,
  tokens: string[],
  known: Set<string>,
): ParseOutcome | null {
  if (pending.kind === 'which') {
    const words = tokens.filter((t) => t !== ',' && t !== 'one' && t !== 'ones');
    const narrowed = pending.options.filter((id) => {
      const t = env.world.things.get(id);
      return t !== undefined && words.length > 0 && words.every((w) => t.words.has(w));
    });
    if (narrowed.length === 0) return null;
    const phrases = splitPhrases(pending.candidate.bindings[pending.slot] ?? []);
    phrases[pending.phrase] = [...words, ...phrases[pending.phrase]];
    const merged = phrases.flatMap((p, i) => (i === 0 ? p : [',', ...p]));
    const candidate: Candidate = {
      pattern: pending.candidate.pattern,
      bindings: { ...pending.candidate.bindings, [pending.slot]: merged },
    };
    return resolveCandidate(env, candidate, known);
  }
  const candidate: Candidate = {
    pattern: pending.candidate.pattern,
    bindings: { ...pending.candidate.bindings, [pending.slot]: tokens },
  };
  return resolveCandidate(env, candidate, known);
}

type SlotResult =
  | { kind: 'ok'; ids: string[]; all: boolean }
  | { kind: 'error'; key: string; params: Record<string, string> }
  | { kind: 'which'; phrase: number; options: string[] };

function resolveCandidate(env: ParserEnv, c: Candidate, known: Set<string>): ParseOutcome {
  const action = c.pattern.action;
  const verb = env.world.verbs.get(action)!;
  const cmd: ParsedCommand = {
    action,
    nouns: [],
    all: false,
    second: null,
    // A bare "yes" or "no" is its own answer.
    topic: c.bindings.TEXT
      ? c.bindings.TEXT.filter((t) => t !== ',').join(' ')
      : action === 'answer' && c.typed
        ? c.typed.filter((t) => t !== ',').join(' ')
        : null,
    dir: c.bindings.DIR ? env.world.directionWords.get(c.bindings.DIR[0]) ?? null : null,
    notes: [],
  };

  // Resolve the second noun first: "take all from box" needs it for "all".
  if (c.bindings.OBJ2) {
    const r = resolveSlot(env, c, 'OBJ2', known);
    if (r.kind === 'error') return r;
    if (r.kind === 'which') return question(env, c, 'OBJ2', r);
    if (r.ids.length > 1) return { kind: 'error', key: 'noMultiples', params: {} };
    cmd.second = r.ids[0];
  }
  if (c.bindings.OBJ) {
    const r = resolveSlot(env, c, 'OBJ', known, cmd.second);
    if (r.kind === 'error') return r;
    if (r.kind === 'which') return question(env, c, 'OBJ', r);
    if ((r.ids.length > 1 || r.all) && !verb.multi) return { kind: 'error', key: 'noMultiples', params: {} };
    if (r.ids.length === 0) return { kind: 'error', key: r.all ? 'nothingForAll' : 'cantSeeThat', params: { verb: verbWords(c) } };
    cmd.nouns = r.ids;
    cmd.all = r.all;
  }

  // "unlock door": use a key the player holds, or ask for one.
  if (
    !c.bindings.OBJ2 &&
    cmd.nouns.length === 1 &&
    (action === 'lock' || action === 'unlock') &&
    env.keyNeeded(action, cmd.nouns[0])
  ) {
    const key = env.implicitSecond(action, cmd.nouns[0]);
    if (key) {
      cmd.second = key;
      cmd.notes.push({ key: 'withKey', params: { second: key } });
    } else {
      const thing = env.world.things.get(cmd.nouns[0]);
      if (thing && thing.lockable) {
        const withPattern = env.world.verbs.get(action)!.patterns.find((p) => /OBJ2/.test(p));
        if (withPattern) {
          const full = compilePattern(action, withPattern, c.pattern.index);
          return {
            kind: 'question',
            pending: { kind: 'missing', candidate: { pattern: full, bindings: { OBJ: c.bindings.OBJ } }, slot: 'OBJ2' },
            key: 'whatToVerb',
            params: { verb: `${verbWords(c)} ${env.theName(cmd.nouns[0])} with` },
          };
        }
      }
    }
  }
  return { kind: 'ok', command: cmd };
}

function question(env: ParserEnv, c: Candidate, slot: Slot, r: { phrase: number; options: string[] }): ParseOutcome {
  const names = r.options.map((id) => env.theName(id));
  const list = names.length === 2 ? `${names[0]} or ${names[1]}` : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  return {
    kind: 'question',
    pending: { kind: 'which', candidate: c, slot, phrase: r.phrase, options: r.options },
    key: 'which',
    params: { list },
  };
}

/** The literal words of the pattern, as typed: "pick up", "put". */
function verbWords(c: Candidate): string {
  const first = c.pattern.tokens[0];
  return first && first.kind === 'word' ? first.words[0] : c.pattern.action;
}

/** The words the player typed, with the first noun named: "put the X in". */
function typedPhrase(env: ParserEnv, c: Candidate, tokens: string[], firstId: string | null): string {
  const out: string[] = [];
  let ti = 0;
  for (const t of c.pattern.tokens) {
    if (ti >= tokens.length) break;
    if (t.kind === 'word') {
      // Abbreviations ("x", "l") read badly in a question; use the full word.
      out.push(tokens[ti].length < 3 ? t.words[0] : tokens[ti]);
      ti += 1;
    } else {
      const span = c.bindings[t.slot] ?? [];
      out.push(t.slot === 'OBJ' && firstId ? env.theName(firstId) : span.join(' '));
      ti += span.length;
    }
  }
  return out.join(' ');
}

function splitPhrases(tokens: string[]): string[][] {
  const phrases: string[][] = [[]];
  for (const t of tokens) {
    if (t === ',' || t === 'and') phrases.push([]);
    else phrases[phrases.length - 1].push(t);
  }
  return phrases.filter((p) => p.length > 0);
}

function resolveSlot(
  env: ParserEnv,
  c: Candidate,
  slot: 'OBJ' | 'OBJ2',
  known: Set<string> = new Set(),
  second: string | null = null,
): SlotResult {
  const tokens = c.bindings[slot] ?? [];
  const action = c.pattern.action;

  // "all", "everything", "all but X"
  if (slot === 'OBJ' && (tokens[0] === 'all' || tokens[0] === 'everything')) {
    let ids = env.allFor(action, second);
    const rest = tokens.slice(1);
    if (rest.length > 0) {
      if (rest[0] !== 'but' && rest[0] !== 'except') return { kind: 'error', key: 'notUnderstood', params: {} };
      for (const phrase of splitPhrases(rest.slice(1))) {
        const r = resolvePhrase(env, phrase, action, slot, known);
        if (r.kind === 'ok') ids = ids.filter((id) => !r.ids.includes(id));
      }
    }
    return { kind: 'ok', ids, all: true };
  }

  const phrases = splitPhrases(tokens);
  if (phrases.length === 0) return { kind: 'error', key: 'notUnderstood', params: {} };
  const ids: string[] = [];
  for (let i = 0; i < phrases.length; i++) {
    const r = resolvePhrase(env, phrases[i], action, slot, known);
    if (r.kind === 'error') return r;
    if (r.kind === 'which') return { ...r, phrase: i };
    for (const id of r.ids) if (!ids.includes(id)) ids.push(id);
  }
  return { kind: 'ok', ids, all: false };
}

const PRONOUNS = ['it', 'them', 'him', 'her'] as const;

function resolvePhrase(
  env: ParserEnv,
  phrase: string[],
  action: string,
  slot: 'OBJ' | 'OBJ2',
  known: Set<string>,
): SlotResult {
  const inScope = env.scope();
  if (phrase.length === 1 && (PRONOUNS as readonly string[]).includes(phrase[0])) {
    const id = env.pronoun(phrase[0] as (typeof PRONOUNS)[number]);
    if (!id) return { kind: 'error', key: 'noPronoun', params: { word: phrase[0] } };
    if (!inScope.some((t) => t.id === id)) return { kind: 'error', key: 'pronounGone', params: { noun: id } };
    return { kind: 'ok', ids: [id], all: false };
  }

  let matches = inScope.filter((t) => phrase.every((w) => t.words.has(w)));
  if (matches.length === 0) {
    const unknown = phrase.find((w) => !known.has(w));
    if (unknown) return { kind: 'error', key: 'unknownWord', params: { word: unknown } };
    return { kind: 'error', key: 'cantSeeThat', params: {} };
  }
  if (matches.length === 1) return { kind: 'ok', ids: [matches[0].id], all: false };

  // Prefer things named by one of their nouns over adjective-only matches.
  const byNoun = matches.filter((t) => phrase.some((w) => t.nouns.includes(w)));
  if (byNoun.length > 0) matches = byNoun;
  // Prefer an exact match of the whole name.
  const exact = matches.filter((t) => t.name.toLowerCase() === phrase.join(' '));
  if (exact.length > 0) matches = exact;
  // Prefer what makes sense for the action.
  const prefer = preference(env, action, slot);
  if (prefer) {
    const preferred = matches.filter((t) => prefer(t.id));
    if (preferred.length > 0) matches = preferred;
  }
  if (matches.length === 1) return { kind: 'ok', ids: [matches[0].id], all: false };
  // Indistinguishable things (same name): take the first.
  if (matches.every((t) => t.name === matches[0].name)) return { kind: 'ok', ids: [matches[0].id], all: false };
  return { kind: 'which', phrase: 0, options: matches.map((t) => t.id) };
}

function preference(env: ParserEnv, action: string, slot: 'OBJ' | 'OBJ2'): ((id: string) => boolean) | null {
  if (slot !== 'OBJ') return null;
  switch (action) {
    case 'take':
      return (id) => !env.isDirectlyHeld(id);
    case 'drop':
    case 'putIn':
    case 'putOn':
    case 'give':
    case 'show':
    case 'eat':
    case 'drink':
    case 'throw':
      return (id) => env.isHeld(id);
    case 'wear':
      return (id) => !env.isWorn(id);
    case 'takeOff':
      return (id) => env.isWorn(id);
    default:
      return null;
  }
}
