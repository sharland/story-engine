// Shape checks for pack data. Each check reports problems as issues and
// records every cross-reference so they can all be resolved once the whole
// pack has been read.

import { STANDARD_MESSAGES } from './stdlib.ts';
import { passageRef, suggest, templateTokens } from './text.ts';
import type { Issue } from './types.ts';

export type RefKind =
  | 'room'
  | 'thing'
  | 'entity'
  | 'location'
  | 'door'
  | 'region'
  | 'roomOrRegion'
  | 'act'
  | 'event'
  | 'ending'
  | 'score'
  | 'passage'
  | 'var'
  | 'varWrite'
  | 'action'
  | 'direction'
  | 'scriptCondition'
  | 'scriptEffect'
  | 'dialogue'
  | 'dialogueNode'
  | 'saidOption';

export interface Ref {
  kind: RefKind;
  id: string;
  where: string;
}

/** Effects that move things, kept for reachability analysis. */
export interface MoveRecord {
  thing: string;
  to: string;
  where: string;
}

export const ID_PATTERN = /^[a-z][a-z0-9_-]*$/;
export const RESERVED_IDS = ['player', 'nowhere', 'here', 'noun', 'second'];

export class Checker {
  issues: Issue[] = [];
  refs: Ref[] = [];
  moves: MoveRecord[] = [];
  playerMoves: Array<{ room: string; where: string }> = [];
  passagesUsed = new Set<string>();
  /** Dialogue nodes opened directly by converse effects. */
  conversesTo: Array<{ character: string; node: string }> = [];
  /** Acts started, endings reached, scores awarded and events scheduled by effects. */
  targets: Array<{ kind: 'act' | 'end' | 'award' | 'schedule'; id: string }> = [];

  error(where: string, code: string, message: string): void {
    this.issues.push({ level: 'error', code, message, where });
  }
  warn(where: string, code: string, message: string): void {
    this.issues.push({ level: 'warning', code, message, where });
  }
  ref(kind: RefKind, id: string, where: string): void {
    this.refs.push({ kind, id, where });
  }
}

export type FieldCheck = (c: Checker, v: unknown, where: string) => void;

export interface Spec {
  fields: Record<string, FieldCheck>;
  required?: string[];
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Keys starting with "_" are author comments. */
export function liveKeys(o: Record<string, unknown>): string[] {
  return Object.keys(o).filter((k) => !k.startsWith('_'));
}

export function checkObject(c: Checker, v: unknown, where: string, spec: Spec): v is Record<string, unknown> {
  if (!isPlainObject(v)) {
    c.error(where, 'type', 'Expected an object');
    return false;
  }
  for (const r of spec.required ?? []) {
    if (v[r] === undefined) c.error(where, 'missing-field', `Missing required field "${r}"`);
  }
  for (const k of liveKeys(v)) {
    const check = spec.fields[k];
    if (!check) {
      const s = suggest(k, Object.keys(spec.fields));
      c.warn(`${where}.${k}`, 'unknown-key', `Unknown field "${k}"${s ? ` (did you mean "${s}"?)` : ''}; it is ignored`);
      continue;
    }
    if (v[k] === undefined) continue;
    check(c, v[k], `${where}.${k}`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Primitive checks

export const str: FieldCheck = (c, v, where) => {
  if (typeof v !== 'string') c.error(where, 'type', 'Expected a string');
};
export const num: FieldCheck = (c, v, where) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) c.error(where, 'type', 'Expected a number');
};
export const bool: FieldCheck = (c, v, where) => {
  if (typeof v !== 'boolean') c.error(where, 'type', 'Expected true or false');
};
export const value: FieldCheck = (c, v, where) => {
  if (!(v === null || ['string', 'number', 'boolean'].includes(typeof v))) {
    c.error(where, 'type', 'Expected a string, number, true/false or null');
  }
};
export const strings: FieldCheck = (c, v, where) => {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) c.error(where, 'type', 'Expected a list of strings');
};
export const words: FieldCheck = (c, v, where) => {
  strings(c, v, where);
  if (Array.isArray(v)) {
    for (const w of v) {
      if (typeof w === 'string' && !/^[a-z0-9-]+$/.test(w)) {
        c.error(where, 'bad-word', `"${w}" must be a single lower-case word (letters, digits, hyphens)`);
      }
    }
  }
};
export function oneOf(...options: string[]): FieldCheck {
  return (c, v, where) => {
    if (typeof v !== 'string' || !options.includes(v)) c.error(where, 'type', `Expected one of: ${options.join(', ')}`);
  };
}
export function ref(kind: RefKind): FieldCheck {
  return (c, v, where) => {
    if (typeof v !== 'string') c.error(where, 'type', 'Expected an id');
    else c.ref(kind, v, where);
  };
}
export function refOrRefs(kind: RefKind): FieldCheck {
  return (c, v, where) => {
    if (typeof v === 'string') c.ref(kind, v, where);
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) v.forEach((x, i) => c.ref(kind, x, `${where}[${i}]`));
    else c.error(where, 'type', 'Expected an id or a list of ids');
  };
}
export function refList(kind: RefKind): FieldCheck {
  return (c, v, where) => {
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) v.forEach((x, i) => c.ref(kind, x, `${where}[${i}]`));
    else c.error(where, 'type', 'Expected a list of ids');
  };
}
export function record(check: FieldCheck): FieldCheck {
  return (c, v, where) => {
    if (!isPlainObject(v)) c.error(where, 'type', 'Expected an object');
    else for (const k of liveKeys(v)) check(c, v[k], `${where}.${k}`);
  };
}
export function list(check: FieldCheck): FieldCheck {
  return (c, v, where) => {
    if (!Array.isArray(v)) c.error(where, 'type', 'Expected a list');
    else v.forEach((x, i) => check(c, x, `${where}[${i}]`));
  };
}

// ---------------------------------------------------------------------------
// Text

const THING_TAGS = ['the', 'The', 'a', 'A', 'name', 'it', 'It', 'that', 'That', 'is', 'has', 's', 'es'];
const BARE_TAGS = ['score', 'max', 'turns', 'turnCount'];
const MESSAGE_PARAMS = ['list', 'word', 'verb', 'n', 'title', 'reason', 'directions'];

export function checkTemplates(c: Checker, s: string, where: string, allowParams = false): void {
  for (const t of templateTokens(s)) {
    if (THING_TAGS.includes(t.tag)) {
      if (t.ref === null) c.error(where, 'bad-template', `${t.raw} needs a target, for example {${t.tag}:noun}`);
      else if (t.ref !== 'noun' && t.ref !== 'second') c.ref('thing', t.ref, where);
    } else if (t.tag === 'var') {
      if (t.ref === null) c.error(where, 'bad-template', '{var} needs a variable name, for example {var:gold}');
      else c.ref('var', t.ref, where);
    } else if (BARE_TAGS.includes(t.tag) || (allowParams && MESSAGE_PARAMS.includes(t.tag))) {
      // fine
    } else {
      c.warn(where, 'bad-template', `Unknown template ${t.raw}; it will be printed as it is`);
    }
  }
}

function checkTextString(c: Checker, s: string, where: string): void {
  const key = passageRef(s);
  if (key !== null) {
    c.ref('passage', key, where);
    c.passagesUsed.add(key);
  } else {
    checkTemplates(c, s, where);
  }
}

export const text: FieldCheck = (c, v, where) => {
  if (typeof v === 'string') return checkTextString(c, v, where);
  if (!Array.isArray(v)) return c.error(where, 'type', 'Expected text: a string, "@passage", or a list of text parts');
  v.forEach((part, i) => {
    const w = `${where}[${i}]`;
    if (typeof part === 'string') checkTextString(c, part, w);
    else if (checkObject(c, part, w, { fields: { if: condition, text: textString, else: textString }, required: ['text'] })) {
      // checked
    }
  });
};

const textString: FieldCheck = (c, v, where) => {
  if (typeof v !== 'string') c.error(where, 'type', 'Expected a string');
  else checkTextString(c, v, where);
};

// ---------------------------------------------------------------------------
// Conditions

const COMPARATORS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'];

export const CONDITION_FORMS: Record<string, Spec> = {
  all: { fields: { all: list((c, v, w) => condition(c, v, w)) } },
  any: { fields: { any: list((c, v, w) => condition(c, v, w)) } },
  not: { fields: { not: (c, v, w) => condition(c, v, w) } },
  var: {
    fields: {
      var: ref('var'),
      eq: value,
      ne: value,
      gt: num,
      gte: num,
      lt: num,
      lte: num,
    },
  },
  has: { fields: { has: ref('thing') } },
  wearing: { fields: { wearing: ref('thing') } },
  at: { fields: { at: refOrRefs('room') } },
  region: { fields: { region: ref('region') } },
  here: { fields: { here: ref('thing') } },
  obj: { fields: { obj: ref('thing'), in: locationOrNowhere }, required: ['in'] },
  visited: { fields: { visited: ref('room') } },
  act: { fields: { act: ref('act') } },
  actAtLeast: { fields: { actAtLeast: ref('act') } },
  light: { fields: { light: bool } },
  chance: {
    fields: {
      chance: (c, v, w) => {
        if (typeof v !== 'number' || v < 0 || v > 1) c.error(w, 'type', 'Expected a probability between 0 and 1');
      },
    },
  },
  said: {
    fields: {
      said: (c, v, w) => {
        if (typeof v !== 'string' || !v.includes('.')) c.error(w, 'type', 'Expected "character.option", such as "guard.ask-name"');
        else c.ref('saidOption', v, w);
      },
    },
  },
  script: { fields: { script: ref('scriptCondition'), args: () => {} } },
};

function locationOrNowhere(c: Checker, v: unknown, where: string): void {
  if (typeof v !== 'string') return c.error(where, 'type', 'Expected an id');
  if (v === 'nowhere' || v === 'player') return;
  c.ref('location', v, where);
}

export function condition(c: Checker, v: unknown, where: string): void {
  checkForm(c, v, where, CONDITION_FORMS, 'condition');
  if (isPlainObject(v) && 'var' in v) {
    const comps = COMPARATORS.filter((k) => k in v);
    if (comps.length > 1) c.error(where, 'bad-condition', 'Use at most one comparison (eq, ne, gt, gte, lt, lte)');
  }
}

function checkForm(c: Checker, v: unknown, where: string, forms: Record<string, Spec>, what: string): string | null {
  if (!isPlainObject(v)) {
    c.error(where, 'type', `Expected a ${what} object`);
    return null;
  }
  const keys = liveKeys(v);
  const heads = keys.filter((k) => k in forms);
  if (heads.length === 0) {
    const s = keys.length > 0 ? suggest(keys[0], Object.keys(forms)) : null;
    c.error(
      where,
      `bad-${what}`,
      `Not a recognised ${what}: ${JSON.stringify(v)}${s ? ` (did you mean "${s}"?)` : ''}`,
    );
    return null;
  }
  const head = heads[0];
  if (heads.length > 1) {
    c.error(where, `bad-${what}`, `A ${what} must have one form, found: ${heads.join(', ')}`);
    return null;
  }
  const spec = forms[head];
  checkObject(c, v, where, spec);
  return head;
}

// ---------------------------------------------------------------------------
// Effects

export const EFFECT_FORMS: Record<string, Spec> = {
  say: { fields: { say: text } },
  sayRandom: { fields: { sayRandom: list(text) } },
  set: { fields: { set: ref('varWrite'), to: value }, required: ['to'] },
  inc: { fields: { inc: ref('varWrite'), by: num } },
  dec: { fields: { dec: ref('varWrite'), by: num } },
  move: { fields: { move: ref('thing'), to: () => {} }, required: ['to'] },
  movePlayer: { fields: { movePlayer: ref('room') } },
  award: { fields: { award: ref('score') } },
  end: { fields: { end: ref('ending') } },
  act: { fields: { act: ref('act') } },
  schedule: {
    fields: {
      schedule: ref('event'),
      in: (c, v, w) => {
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) c.error(w, 'type', 'Expected a whole number of turns, 1 or more');
      },
    },
    required: ['in'],
  },
  cancel: { fields: { cancel: ref('event') } },
  if: {
    fields: { if: condition, then: (c, v, w) => effects(c, v, w), else: (c, v, w) => effects(c, v, w) },
  },
  look: {
    fields: {
      look: (c, v, w) => {
        if (v !== true) c.error(w, 'type', 'Expected true');
      },
    },
  },
  converse: { fields: { converse: ref('dialogue'), node: str } },
  script: { fields: { script: ref('scriptEffect'), args: () => {} } },
};

export function effect(c: Checker, v: unknown, where: string): void {
  const head = checkForm(c, v, where, EFFECT_FORMS, 'effect');
  if (!head || !isPlainObject(v)) return;
  if (head === 'move' && typeof v.move === 'string') {
    const to = v.to;
    if (typeof to !== 'string') c.error(`${where}.to`, 'type', 'Expected an id, "player", "here" or "nowhere"');
    else {
      if (!['player', 'here', 'nowhere'].includes(to)) c.ref('location', to, `${where}.to`);
      c.moves.push({ thing: v.move, to, where });
    }
  }
  if (head === 'movePlayer' && typeof v.movePlayer === 'string') c.playerMoves.push({ room: v.movePlayer, where });
  if (head === 'converse' && typeof v.converse === 'string' && typeof v.node === 'string') {
    c.ref('dialogueNode', `${v.converse}:${v.node}`, `${where}.node`);
    c.conversesTo.push({ character: v.converse, node: v.node });
  }
  if ((head === 'act' || head === 'end' || head === 'award' || head === 'schedule') && typeof v[head] === 'string') {
    c.targets.push({ kind: head, id: v[head] as string });
  }
}

export function effects(c: Checker, v: unknown, where: string): void {
  if (!Array.isArray(v)) return c.error(where, 'type', 'Expected a list of effects');
  v.forEach((e, i) => effect(c, e, `${where}[${i}]`));
}

// ---------------------------------------------------------------------------
// Pack sections

const exit: FieldCheck = (c, v, where) => {
  if (typeof v === 'string') return c.ref('room', v, where);
  checkObject(c, v, where, {
    fields: {
      to: ref('room'),
      door: ref('door'),
      if: condition,
      else: text,
      say: text,
      do: effects,
    },
  });
};

export const ROOM_SPEC: Spec = {
  required: ['name'],
  fields: {
    name: str,
    description: text,
    firstVisit: text,
    dark: bool,
    region: (c, v, w) => {
      if (typeof v !== 'string' || !ID_PATTERN.test(v)) c.error(w, 'bad-id', 'Region names follow the id rules');
    },
    exits: (c, v, where) => {
      if (!isPlainObject(v)) return c.error(where, 'type', 'Expected an object of direction: exit');
      for (const d of liveKeys(v)) {
        c.ref('direction', d, `${where}.${d}`);
        exit(c, v[d], `${where}.${d}`);
      }
    },
    noExit: text,
    tags: words,
    props: record(value),
  },
};

const OBJECT_FIELDS: Record<string, FieldCheck> = {
  name: str,
  nouns: words,
  adjectives: words,
  article: str,
  proper: bool,
  plural: bool,
  description: text,
  initial: text,
  read: text,
  location: (c, v, where) => {
    if (typeof v !== 'string') return c.error(where, 'type', 'Expected an id');
    if (v !== 'player') c.ref('location', v, where);
  },
  foundIn: refList('room'),
  fixed: (c, v, where) => {
    if (typeof v === 'boolean') return;
    if (typeof v === 'string') return text(c, v, where);
    c.error(where, 'type', 'Expected true/false or a refusal message');
  },
  scenery: bool,
  container: bool,
  surface: bool,
  openable: bool,
  open: bool,
  lockable: bool,
  locked: bool,
  key: refOrRefs('thing'),
  transparent: bool,
  capacity: num,
  wearable: bool,
  worn: bool,
  switchable: bool,
  on: bool,
  light: bool,
  edible: bool,
  drinkable: bool,
  door: bool,
  tags: words,
  props: record(value),
};

export const OBJECT_SPEC: Spec = { required: ['name'], fields: OBJECT_FIELDS };

const topic: FieldCheck = (c, v, where) => {
  checkObject(c, v, where, {
    required: ['keys', 'text'],
    fields: { id: str, keys: strings, if: condition, text, do: effects, once: bool },
  });
};

export const CHARACTER_SPEC: Spec = {
  required: ['name'],
  fields: {
    ...OBJECT_FIELDS,
    pronoun: oneOf('him', 'her', 'them', 'it'),
    topics: list(topic),
    talk: text,
    noTopic: text,
    wander: (c, v, where) =>
      checkObject(c, v, where, { required: ['rooms', 'chance'], fields: { rooms: refList('room'), chance: num } }),
    following: bool,
    arrive: text,
    depart: text,
  },
};

export const REGION_SPEC: Spec = { fields: { name: str, if: condition, else: text } };

export const ACT_SPEC: Spec = { required: ['id'], fields: { id: str, title: str, intro: text, do: effects } };

const thingMatcher: FieldCheck = (c, v, where) => {
  const one = (x: unknown, w: string) => {
    if (typeof x !== 'string') return c.error(w, 'type', 'Expected an id, "#tag" or "*"');
    if (x === '*' || x.startsWith('#')) return;
    c.ref('thing', x, w);
  };
  if (Array.isArray(v)) v.forEach((x, i) => one(x, `${where}[${i}]`));
  else one(v, where);
};

export const RULE_SPEC: Spec = {
  required: ['on'],
  fields: {
    id: str,
    on: refOrRefs('action'),
    when: oneOf('before', 'after'),
    object: thingMatcher,
    with: thingMatcher,
    dir: refOrRefs('direction'),
    topic: (c, v, where) => {
      if (!(typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string')))) {
        c.error(where, 'type', 'Expected a word or a list of words');
      }
    },
    in: refOrRefs('roomOrRegion'),
    if: condition,
    say: text,
    do: effects,
    continue: bool,
    once: bool,
    priority: num,
  },
};

export const EVENT_SPEC: Spec = { fields: { if: condition, say: text, do: effects } };

export const ENDING_SPEC: Spec = { required: ['title'], fields: { title: str, text, win: bool } };

export const SCORE_CHECK: FieldCheck = (c, v, where) => {
  if (typeof v === 'number') return;
  checkObject(c, v, where, { required: ['points'], fields: { points: num, note: str } });
};

export const VERB_SPEC: Spec = {
  fields: {
    patterns: strings,
    default: text,
    multi: bool,
    meta: bool,
  },
};

export const DIRECTION_SPEC: Spec = {
  required: ['words'],
  fields: { words: words, opposite: ref('direction') },
};

export const MESSAGE_CHECK: FieldCheck = (c, v, where) => {
  const key = where.slice(where.lastIndexOf('.') + 1);
  if (!(key in STANDARD_MESSAGES)) {
    const s = suggest(key, Object.keys(STANDARD_MESSAGES));
    c.warn(where, 'unknown-message', `"${key}" is not a standard message${s ? ` (did you mean "${s}"?)` : ''}`);
  }
  if (typeof v !== 'string') return c.error(where, 'type', 'Expected a string');
  const p = passageRef(v);
  if (p !== null) {
    c.ref('passage', p, where);
    c.passagesUsed.add(p);
  } else checkTemplates(c, v, where, true);
};

export const MANIFEST_SPEC: Spec = {
  required: ['format', 'id', 'title', 'version', 'author', 'licence', 'start'],
  fields: {
    format: (c, v, where) => {
      if (v !== 1) c.error(where, 'bad-format', 'This engine reads pack format 1');
    },
    id: (c, v, where) => {
      if (typeof v !== 'string' || !ID_PATTERN.test(v)) c.error(where, 'bad-id', 'Pack id must be lower-case letters, digits, - or _');
    },
    title: str,
    version: str,
    author: str,
    licence: str,
    start: ref('room'),
    description: str,
    source: (c, v, where) =>
      checkObject(c, v, where, {
        required: ['title'],
        fields: {
          title: str,
          author: str,
          year: (cc, vv, w) => {
            if (typeof vv !== 'string' && typeof vv !== 'number') cc.error(w, 'type', 'Expected a year');
          },
          url: str,
          licence: str,
          note: str,
        },
      }),
    credits: strings,
    intro: text,
    player: (c, v, where) =>
      checkObject(c, v, where, { fields: { description: text, capacity: num } }),
  },
};

const dialogueOption: FieldCheck = (c, v, where) => {
  checkObject(c, v, where, DIALOGUE_OPTION_SPEC);
};

export const DIALOGUE_OPTION_SPEC: Spec = {
  required: ['id', 'text'],
  fields: {
    id: (c, v, w) => {
      if (typeof v !== 'string' || !ID_PATTERN.test(v)) c.error(w, 'bad-id', 'Option ids follow the id rules (a-z first, then a-z, 0-9, - and _)');
    },
    text,
    if: condition,
    locked: text,
    once: bool,
    keys: strings,
    line: text,
    reply: text,
    do: effects,
    then: str,
  },
};

export const DIALOGUE_NODE_SPEC: Spec = {
  fields: { say: text, do: effects, options: list(dialogueOption), noLeave: bool, resumeText: text },
};

export const DIALOGUE_SPEC: Spec = {
  required: ['nodes'],
  fields: {
    entry: list((c, v, w) => checkObject(c, v, w, { required: ['node'], fields: { if: condition, node: str } })),
    leave: text,
    resume: bool,
    resumeText: text,
    nodes: record((c, v, w) => checkObject(c, v, w, DIALOGUE_NODE_SPEC)),
  },
};

export const SECTIONS = [
  'rooms',
  'objects',
  'characters',
  'regions',
  'acts',
  'rules',
  'events',
  'endings',
  'scores',
  'vars',
  'verbs',
  'directions',
  'messages',
  'dialogues',
  'validator',
];
