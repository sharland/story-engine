// The shape of a pack's map, measured the way docs/research/mud-structure.md
// measured the first DikuMUD worlds, and notes on the patterns that research
// found worth a second look. Notes are matters of judgement, not mistakes:
// validate keeps them apart from errors and warnings, and they never fail a
// pack.
//
//   neighbours  rooms joined to a room by an exit, either way
//   dead end    one neighbour
//   corridor    two neighbours and nothing in the room: no object, scenery,
//               character (placed, moved there or passing through) or rule
//               of its own. Pure pass-through.
//   loops       ways round rather than there and back: joined pairs of rooms
//               minus rooms plus separate parts
//   across      the longest shortest walk between two rooms, in steps
//   entrance    a room of a region that an exit or movePlayer effect from
//               outside the region leads to
//   detail      scenery or a fixture: part of the room, there to examine
//   gate        an exit with a condition, or through a door that starts locked

import type { CompileResult } from './pack.ts';
import type { TextDef, World } from './types.ts';

export interface Note {
  code: string;
  message: string;
  where?: string;
}

export interface AreaShape {
  /** A region id, "(no region)", or "(all rooms)" for the whole map. */
  label: string;
  rooms: number;
  /** Exits that lead to a room. */
  exits: number;
  deadEnds: number;
  corridors: number;
  longestCorridorRun: number;
  junctions: number;
  loops: number;
  across: number;
  contentRooms: number;
  roomsWithDetails: number;
  details: number;
  sharedDescriptions: number;
  descWordsMedian: number;
  gates: number;
  entrances: number;
  /** The other regions an exit joins this one to. */
  joins: string[];
}

export interface PackShape {
  whole: AreaShape;
  /** One per region, then rooms in no region, largest first. */
  areas: AreaShape[];
  notes: Note[];
}

/** Runs of this many empty pass-through rooms get a note. */
export const CORRIDOR_RUN = 3;
/** Regions at least this big with a single entrance get a note. */
export const SPUR_ROOMS = 5;
/** Regions at least this big with no loop get a note. */
export const LOOPLESS_ROOMS = 8;

/** The research's figures for the two DikuMUD worlds, to compare a pack with. */
export const MUD_FIGURES = [
  { label: 'DikuMUD 1991', exitsPerRoom: 2.3, deadEnds: 14, corridors: 17, loopsPer10: 1.3, content: 67, shared: 13, details: 45, words: 33 },
  { label: 'DikuMUD III', exitsPerRoom: 2.2, deadEnds: 26, corridors: 10, loopsPer10: 0.1, content: 79, shared: 13, details: 63, words: 52.5 },
] as const;

const NO_REGION = '(no region)';

type Compiled = Pick<CompileResult, 'moves' | 'playerMoves' | 'definedIn'>;

export function packShape(w: World, c: Compiled): PackShape {
  const ids = [...w.rooms.keys()];
  const area = (id: string) => w.rooms.get(id)?.region ?? NO_REGION;

  // Undirected neighbours.
  const nbr = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const r of w.rooms.values()) {
    for (const e of r.exits.values()) {
      if (!e.to || e.to === r.id || !nbr.has(e.to)) continue;
      nbr.get(r.id)!.add(e.to);
      nbr.get(e.to)!.add(r.id);
    }
  }

  // What each room holds, at the start or at some point.
  const content = new Set<string>();
  const details = new Map<string, number>(ids.map((id) => [id, 0]));
  const scope = roomScopes(w, c);
  for (const [r, things] of scope) {
    for (const id of things) {
      const t = w.things.get(id)!;
      if (t.door) continue;
      content.add(r);
      if (t.kind === 'object' && (t.scenery || t.fixed) && (t.foundIn.includes(r) || t.location === r)) {
        details.set(r, details.get(r)! + 1);
      }
    }
  }
  for (const rule of w.rules) {
    for (const x of rule.in === undefined ? [] : Array.isArray(rule.in) ? rule.in : [rule.in]) if (w.rooms.has(x)) content.add(x);
  }
  const isCorridor = (id: string) => nbr.get(id)!.size === 2 && !content.has(id);

  // Descriptions, as plain words.
  const words = new Map(ids.map((id) => [id, plainText(w, w.rooms.get(id)!.description)]));
  const sameAs = new Map<string, string[]>();
  for (const id of ids) {
    const key = words.get(id)!.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (key === '') continue;
    sameAs.set(key, [...(sameAs.get(key) ?? []), id]);
  }
  const shared = new Set([...sameAs.values()].filter((g) => g.length > 1).flat());

  const entryRooms = new Set(c.playerMoves.map((m) => m.room));
  const measure = (label: string, members: string[]): AreaShape => {
    const inside = new Set(members);
    const pairs = new Set<string>();
    let exits = 0;
    let gates = 0;
    const joins = new Set<string>();
    const entrances = new Set<string>();
    for (const id of members) {
      for (const e of w.rooms.get(id)!.exits.values()) {
        if (!e.to || !w.rooms.has(e.to)) continue;
        exits++;
        const door = e.door ? w.things.get(e.door) : undefined;
        if (e.if !== null || door?.initialProps.locked === true) gates++;
        if (inside.has(e.to)) {
          if (e.to !== id) pairs.add([id, e.to].sort().join('\n'));
        } else joins.add(area(e.to));
      }
    }
    for (const r of w.rooms.values()) {
      if (inside.has(r.id)) continue;
      for (const e of r.exits.values()) {
        if (e.to && inside.has(e.to)) {
          entrances.add(e.to);
          joins.add(area(r.id));
        }
      }
    }
    for (const r of entryRooms) if (inside.has(r)) entrances.add(r);
    const within = (id: string) => [...nbr.get(id)!].filter((n) => inside.has(n));
    const parts = components(members, within);
    const runs = components(members.filter(isCorridor), (id) => within(id).filter(isCorridor));
    const counts = members.map((id) => wordCount(words.get(id)!)).sort((a, b) => a - b);
    return {
      label,
      rooms: members.length,
      exits,
      deadEnds: members.filter((id) => nbr.get(id)!.size === 1).length,
      corridors: members.filter(isCorridor).length,
      longestCorridorRun: Math.max(0, ...runs.map((r) => r.length)),
      junctions: members.filter((id) => nbr.get(id)!.size >= 3).length,
      loops: pairs.size - members.length + parts.length,
      across: Math.max(0, ...members.map((id) => Math.max(...bfs(id, within).values()))),
      contentRooms: members.filter((id) => content.has(id)).length,
      roomsWithDetails: members.filter((id) => details.get(id)! > 0).length,
      details: members.reduce((n, id) => n + details.get(id)!, 0),
      sharedDescriptions: members.filter((id) => shared.has(id)).length,
      descWordsMedian: median(counts),
      gates,
      entrances: entrances.size,
      joins: [...joins].filter((j) => j !== label).sort(),
    };
  };

  const byArea = new Map<string, string[]>();
  for (const id of ids) byArea.set(area(id), [...(byArea.get(area(id)) ?? []), id]);
  const areas = [...byArea]
    .map(([label, members]) => measure(label, members))
    .sort((a, b) => b.rooms - a.rooms || a.label.localeCompare(b.label));
  const whole = measure('(all rooms)', ids);

  // Notes.
  const notes: Note[] = [];
  const where = (id: string) => c.definedIn.get(id);
  const list = (xs: string[]) => {
    const q = xs.map((x) => `"${x}"`);
    return q.length <= 2 ? q.join(' and ') : `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}`;
  };

  for (const group of sameAs.values()) {
    if (group.length < 2) continue;
    notes.push({
      code: 'shared-description',
      message:
        `Rooms ${list(group)} have the same description. Rooms that read alike feel like filler: ` +
        'make them one room, or give each something of its own',
      where: where(group[0]),
    });
  }

  for (const run of components(ids.filter(isCorridor), (id) => [...nbr.get(id)!].filter(isCorridor))) {
    if (run.length < CORRIDOR_RUN) continue;
    notes.push({
      code: 'corridor-run',
      message:
        `Rooms ${list(pathOrder(run, nbr))} are ${run.length} empty rooms in a row that the player only walks through. ` +
        'Make the journey one room, or put something in the middle',
      where: where(run[0]),
    });
  }

  for (const id of ids) {
    if (nbr.get(id)!.size !== 1 || content.has(id)) continue;
    notes.push({
      code: 'empty-dead-end',
      message: `Room "${id}" is a dead end with nothing in it. Make it worth the trip (a person, a find, a clue) or fold it into its neighbour`,
      where: where(id),
    });
  }

  const startArea = area(w.manifest.start);
  for (const a of areas) {
    if (a.label === NO_REGION || a.label === startArea || a.rooms < SPUR_ROOMS || a.entrances !== 1) continue;
    notes.push({
      code: 'one-way-in',
      message:
        `Region "${a.label}" (${a.rooms} rooms) has one way in, so players leave the way they came. ` +
        'Consider a second entrance, ideally from a different region',
    });
  }

  const regions = areas.filter((a) => a.label !== NO_REGION).length;
  for (const a of areas) {
    if (a.rooms < LOOPLESS_ROOMS || a.loops > 0) continue;
    const what = regions === 0 ? 'The map' : a.label === NO_REGION ? 'The part of the map in no region' : `Region "${a.label}"`;
    notes.push({
      code: 'no-loop',
      message:
        `${what} has ${a.rooms} rooms and no loop, so every trip is there and back (${a.across} steps across). ` +
        'Join two rooms that are far apart to give players a way round',
    });
  }

  for (const id of ids) {
    const room = w.rooms.get(id)!;
    const known = knownWords(w, id, scope.get(id)!);
    const missing = unexaminedNouns(`${plainText(w, room.description)}\n${plainText(w, room.firstVisit)}`, known);
    if (missing.length === 0) continue;
    notes.push({
      code: 'unexamined-noun',
      message:
        `Room "${id}" names ${list(missing)}, which the player can't examine here. ` +
        'Players try what the text names: add scenery, or list words that don\'t matter in validator.ignoreWords',
      where: where(id),
    });
  }

  return { whole, areas, notes };
}

/**
 * The things that can be in each room: placed there (in or on something
 * there, too), found there, moved there by an effect, or wandering through.
 */
export function roomScopes(w: World, c: Pick<CompileResult, 'moves'>): Map<string, Set<string>> {
  const scope = new Map<string, Set<string>>([...w.rooms.keys()].map((id) => [id, new Set()]));
  const roomOf = (place: string | null, depth = 0): string | null => {
    if (place === null || depth > 20) return null;
    if (w.rooms.has(place)) return place;
    return roomOf(w.things.get(place)?.location ?? null, depth + 1);
  };
  for (const t of w.things.values()) {
    const rooms = new Set(t.foundIn.filter((r) => w.rooms.has(r)));
    const start = roomOf(t.location);
    if (start) rooms.add(start);
    for (const r of t.wander?.rooms ?? []) if (w.rooms.has(r)) rooms.add(r);
    for (const m of c.moves) {
      const to = m.thing === t.id ? roomOf(m.to) : null;
      if (to) rooms.add(to);
    }
    for (const r of rooms) scope.get(r)!.add(t.id);
  }
  return scope;
}

/** Words a room's text may use that the player can act on there (as stems; see stem()). */
export function knownWords(w: World, roomId: string, scope: Set<string>): Set<string> {
  const room = w.rooms.get(roomId)!;
  const known = new Set(w.validator.ignoreWords.map(stem));
  const add = (text: string) => {
    for (const x of text.toLowerCase().match(/[a-z]+/g) ?? []) known.add(stem(x));
  };
  add(room.name);
  for (const e of room.exits.values()) if (e.to) add(w.rooms.get(e.to)?.name ?? '');
  for (const word of w.directionWords.keys()) known.add(stem(word));
  for (const t of scope) for (const word of w.things.get(t)!.words) known.add(stem(word));
  return known;
}

// ---------------------------------------------------------------------------
// Graph helpers

function components(ids: string[], next: (id: string) => Iterable<string>): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const part: string[] = [];
    const queue = [id];
    seen.add(id);
    while (queue.length > 0) {
      const at = queue.shift()!;
      part.push(at);
      for (const n of next(at)) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    out.push(part);
  }
  return out;
}

function bfs(from: string, next: (id: string) => Iterable<string>): Map<string, number> {
  const dist = new Map([[from, 0]]);
  const queue = [from];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const n of next(at)) {
      if (!dist.has(n)) {
        dist.set(n, dist.get(at)! + 1);
        queue.push(n);
      }
    }
  }
  return dist;
}

/** A run of corridor rooms in walking order, from one end. */
function pathOrder(run: string[], nbr: Map<string, Set<string>>): string[] {
  const inRun = new Set(run);
  const end = run.find((id) => [...nbr.get(id)!].filter((n) => inRun.has(n)).length < 2) ?? run[0];
  return [...bfs(end, (id) => [...nbr.get(id)!].filter((n) => inRun.has(n))).keys()];
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

// ---------------------------------------------------------------------------
// Text

/** A text field as plain prose: passages resolved, every variant included, templates removed. */
export function plainText(w: World, def: TextDef | null | undefined): string {
  if (def === null || def === undefined) return '';
  if (typeof def === 'string') {
    const text = def.startsWith('@@') ? def.slice(1) : def.startsWith('@') ? (w.texts.get(def.slice(1)) ?? '') : def;
    return text.replace(/\{\{|\}\}/g, ' ').replace(/\{[^{}]*\}/g, ' ');
  }
  return def.map((p) => (typeof p === 'string' ? plainText(w, p) : `${plainText(w, p.text)}\n${plainText(w, p.else)}`)).join('\n');
}

function wordCount(text: string): number {
  return (text.match(/[A-Za-z0-9]+(?:['’][A-Za-z]+)*/g) ?? []).length;
}

/** Words that start a noun phrase. ("Her" and "that" are left out: too often something else.) */
const DETERMINERS = new Set(['a', 'an', 'the', 'some', 'another', 'this', 'these', 'those', 'your', 'his', 'their', 'its', 'my', 'our', 'of', 'with']);

/** Words that end a noun phrase: prepositions, conjunctions, pronouns, auxiliaries. */
const STOP = new Set(
  (
    'to in into on onto at by for from without over under behind beside besides between across along ' +
    'through past near against up down out off above below inside outside toward towards about beyond among beneath ' +
    'within upon like as than and or but nor so yet if when while where whereas that which who whom whose what ' +
    'is are was were be been being has have had do does did can could will would shall should may might must ' +
    'it they them you he she we i me us him her there here not no nothing something anything everything ' +
    'all both each every one ones only just still even also too very again then now once'
  ).split(' '),
);

/** Verbs common in room descriptions; after a phrase's first word they end it ("a path drops away"). */
const VERBS = new Set(
  (
    'lies lie stands stand sits sit hangs hang leads lead runs run rises rise falls fall drops climbs opens closes ' +
    'glows glow hums hum fills fill covers cover lines looks seems waits leans rests holds hold reaches points faces ' +
    'sweeps stretches winds curves bends turns sways creaks drips flickers burns shines smells sounds blocks gives ' +
    'give stays keeps lets clings cling grows grow spills spill line lean look seem wait stretch'
  ).split(' '),
);

/** Words for places in a room, amounts and the like, not for things to examine. */
const NOT_THINGS = new Set(
  (
    'back front side sides edge edges middle centre center rest end top bottom left right way room place area spot ' +
    'handful moment while lot bit kind sort smell sound noise silence distance first second last next other same ' +
    'own whole half little few many most more much such usual'
  ).split(' '),
);

/** Crude singular, so "pans" matches "pan" and "boxes" matches "box". */
export function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(?:ss|x|ch|sh|z)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}

/**
 * Noun phrases ("the rope bridge", "a copper kettle") none of whose words
 * the player could use: up to three words after a determiner, "of" or
 * "with", or at the start of a sentence, stopping at punctuation, a stop word
 * or a common verb.
 */
export function unexaminedNouns(text: string, known: Set<string>): string[] {
  const tokens = text.replace(/’/g, "'").match(/[A-Za-z]+(?:['-][A-Za-z]+)*|[^\sA-Za-z]/g) ?? [];
  const forms = (word: string) => (word.endsWith('ves') ? [stem(word), `${word.slice(0, -3)}f`, `${word.slice(0, -3)}fe`] : [stem(word)]);
  const isKnown = (word: string) => [word, ...word.split('-')].some((part) => forms(part).some((f) => known.has(f)));
  const found: string[] = [];
  let sentenceStart = true;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const lower = token.toLowerCase();
    const atStart = sentenceStart;
    sentenceStart = /^[.!?:;"]$/.test(token) || (sentenceStart && !/[A-Za-z]/.test(token));
    if (!/[A-Za-z]/.test(token)) continue;
    // A phrase starts after a determiner, after a possessive, or at the start of a sentence.
    let from: number;
    let lead: string;
    if (DETERMINERS.has(lower)) {
      from = i + 1;
      lead = lower === 'of' || lower === 'with' ? '' : `${lower} `;
    } else if (atStart && !STOP.has(lower) && !NOT_THINGS.has(lower)) {
      from = i;
      lead = '';
    } else continue;
    // Up to three words that could name a thing; adverbs and words like
    // "usual" are kept for the message but not weighed.
    const phrase: string[] = [];
    const isFiller = (x: string) => NOT_THINGS.has(x) || (x.length > 4 && x.endsWith('ly'));
    for (let j = from; j < tokens.length && phrase.filter((x) => !isFiller(x)).length < 3; j++) {
      const possessive = /'s$/i.test(tokens[j]);
      const word = tokens[j].toLowerCase().replace(/'s$/, '');
      if (!/^[a-z]/.test(word) || STOP.has(word) || DETERMINERS.has(word)) break;
      if (phrase.length > 0 && VERBS.has(word)) break;
      phrase.push(word);
      if (possessive) break;
    }
    const things = phrase.filter((x) => !isFiller(x));
    if (things.length === 0 || things.some(isKnown)) continue;
    const shown = `${lead}${phrase.join(' ')}`;
    if (!found.includes(shown)) found.push(shown);
  }
  return found;
}
