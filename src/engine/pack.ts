// Turn a PackSource (manifest, data files, text files, script modules) into a
// compiled, read-only World. Every problem found on the way is reported as an
// issue; a pack with errors does not run.

import { emptyScriptTable, type ScriptTable } from './script-api.ts';
import {
  ACT_SPEC,
  CHARACTER_SPEC,
  Checker,
  DIALOGUE_SPEC,
  DIRECTION_SPEC,
  ENDING_SPEC,
  EVENT_SPEC,
  ID_PATTERN,
  isPlainObject,
  liveKeys,
  MANIFEST_SPEC,
  MESSAGE_CHECK,
  OBJECT_SPEC,
  REGION_SPEC,
  RESERVED_IDS,
  ROOM_SPEC,
  RULE_SPEC,
  SCORE_CHECK,
  SECTIONS,
  VERB_SPEC,
  checkObject,
  checkTemplates,
  value as valueCheck,
  type MoveRecord,
  type Ref,
} from './schema.ts';
import {
  BUILTIN_VARS,
  PSEUDO_ACTIONS,
  RESERVED_WORDS,
  STANDARD_DIRECTIONS,
  STANDARD_MESSAGES,
  STANDARD_PROPS,
  STANDARD_VERBS,
} from './stdlib.ts';
import { nameWords, parsePassages, suggest } from './text.ts';
import type {
  ActDef,
  CharacterDef,
  DialogueDef,
  DirectionDef,
  EndingDef,
  EventDef,
  Exit,
  ExitDef,
  Issue,
  Manifest,
  ObjectDef,
  PackSource,
  RegionDef,
  Room,
  RoomDef,
  Rule,
  RuleDef,
  ScoreDef,
  Thing,
  Value,
  Verb,
  VerbDef,
  World,
} from './types.ts';

export interface CompileResult {
  world: World | null;
  issues: Issue[];
  refs: Ref[];
  moves: MoveRecord[];
  playerMoves: Array<{ room: string; where: string }>;
  passagesUsed: Set<string>;
  targets: Checker['targets'];
  /** Conversations opened by a converse effect at a named node. */
  conversesTo: Checker['conversesTo'];
  /** Where each id was defined, for messages. */
  definedIn: Map<string, string>;
}

export class PackError extends Error {
  issues: Issue[];
  constructor(origin: string, issues: Issue[]) {
    const errors = issues.filter((i) => i.level === 'error');
    super(
      `Pack ${origin} has ${errors.length} error(s):\n` +
        errors.map((i) => `  ${i.where ? i.where + ': ' : ''}${i.message}`).join('\n'),
    );
    this.issues = issues;
  }
}

/** Compile, and throw a PackError if there are any errors. */
export function loadWorld(src: PackSource): World {
  const result = compilePack(src);
  if (!result.world || result.issues.some((i) => i.level === 'error')) throw new PackError(src.origin, result.issues);
  return result.world;
}

interface Located<T> {
  def: T;
  file: string;
}

export function compilePack(src: PackSource): CompileResult {
  const c = new Checker();
  c.issues.push(...(src.issues ?? []));
  const definedIn = new Map<string, string>();
  const result = (world: World | null): CompileResult => ({
    world,
    issues: c.issues,
    refs: c.refs,
    moves: c.moves,
    playerMoves: c.playerMoves,
    passagesUsed: c.passagesUsed,
    targets: c.targets,
    conversesTo: c.conversesTo,
    definedIn,
  });

  // Manifest
  if (!checkObject(c, src.manifest, 'pack.json', MANIFEST_SPEC)) return result(null);
  const manifest = src.manifest as unknown as Manifest;

  // Text passages
  const texts = new Map<string, string>();
  for (const t of src.texts) {
    for (const key of parsePassages(t.content, t.file, texts, c.issues)) {
      checkTemplates(c, texts.get(key)!, `${t.file}: ${key}`);
    }
  }

  // Merge data files
  const maps: Record<string, Map<string, Located<unknown>>> = {};
  for (const s of ['rooms', 'objects', 'characters', 'regions', 'events', 'endings', 'scores', 'vars', 'verbs', 'directions', 'messages', 'dialogues']) {
    maps[s] = new Map();
  }
  const acts: Array<Located<unknown>> = [];
  const rules: Array<Located<unknown> & { index: number }> = [];
  const assumeReachable: string[] = [];
  const assumeObtainable: string[] = [];
  const assumeUsed: string[] = [];
  const ignoreWords: string[] = [];

  for (const { file, content } of src.data) {
    if (!isPlainObject(content)) {
      c.error(file, 'type', 'A data file must contain a JSON object');
      continue;
    }
    for (const section of liveKeys(content)) {
      const v = content[section];
      const where = `${file}: ${section}`;
      if (!SECTIONS.includes(section)) {
        const s = suggest(section, SECTIONS);
        c.error(where, 'unknown-section', `Unknown section "${section}"${s ? ` (did you mean "${s}"?)` : ''}`);
        continue;
      }
      if (section === 'acts' || section === 'rules') {
        if (!Array.isArray(v)) {
          c.error(where, 'type', 'Expected a list');
          continue;
        }
        v.forEach((def, i) => {
          if (section === 'acts') acts.push({ def, file: `${file}: acts[${i}]` });
          else rules.push({ def, file: `${file}: rules[${i}]`, index: i });
        });
        continue;
      }
      if (section === 'validator') {
        checkObject(c, v, where, {
          fields: {
            assumeReachable: (cc, vv, w) => collectIds(cc, vv, w, assumeReachable),
            assumeObtainable: (cc, vv, w) => collectIds(cc, vv, w, assumeObtainable),
            assumeUsed: (cc, vv, w) => {
              if (!Array.isArray(vv) || vv.some((x) => typeof x !== 'string')) cc.error(w, 'type', 'Expected a list of ids');
              else assumeUsed.push(...(vv as string[]));
            },
            ignoreWords: (cc, vv, w) => {
              if (!Array.isArray(vv) || vv.some((x) => typeof x !== 'string')) cc.error(w, 'type', 'Expected a list of words');
              else ignoreWords.push(...(vv as string[]));
            },
          },
        });
        continue;
      }
      if (!isPlainObject(v)) {
        c.error(where, 'type', 'Expected an object keyed by id');
        continue;
      }
      for (const id of liveKeys(v)) {
        const target = maps[section];
        const prev = target.get(id);
        if (prev) {
          c.error(`${file}: ${section}.${id}`, 'duplicate-id', `"${id}" is already defined in ${prev.file}`);
          continue;
        }
        target.set(id, { def: v[id], file: `${file}: ${section}.${id}` });
      }
    }
  }

  // One namespace for rooms, objects and characters.
  for (const section of ['rooms', 'objects', 'characters']) {
    for (const [id, { file }] of maps[section]) {
      const prev = definedIn.get(id);
      if (prev) c.error(file, 'duplicate-id', `"${id}" is already used by ${prev}`);
      else definedIn.set(id, file);
      if (!ID_PATTERN.test(id)) c.error(file, 'bad-id', `Id "${id}" must start with a-z and use only a-z, 0-9, - and _`);
      if (RESERVED_IDS.includes(id)) c.error(file, 'reserved-id', `"${id}" is reserved by the engine`);
    }
  }
  for (const section of ['regions', 'events', 'endings', 'scores', 'vars', 'verbs', 'directions']) {
    for (const [id, { file }] of maps[section]) {
      if (!ID_PATTERN.test(id) && section !== 'verbs') {
        c.error(file, 'bad-id', `Id "${id}" must start with a-z and use only a-z, 0-9, - and _`);
      }
    }
  }
  for (const [id, { file }] of maps.vars) {
    if (BUILTIN_VARS.includes(id)) c.error(file, 'reserved-id', `"${id}" is a built-in variable`);
  }

  // Scripts
  const scripts: ScriptTable = emptyScriptTable();
  for (const s of src.scripts) registerScript(c, s.file, s.module, scripts);

  // Shape checks
  for (const [, l] of maps.rooms) checkObject(c, l.def, l.file, ROOM_SPEC);
  for (const [, l] of maps.objects) checkObject(c, l.def, l.file, OBJECT_SPEC);
  for (const [, l] of maps.characters) checkObject(c, l.def, l.file, CHARACTER_SPEC);
  for (const [, l] of maps.regions) checkObject(c, l.def, l.file, REGION_SPEC);
  for (const l of acts) checkObject(c, l.def, l.file, ACT_SPEC);
  for (const l of rules) checkObject(c, l.def, l.file, RULE_SPEC);
  for (const [, l] of maps.events) checkObject(c, l.def, l.file, EVENT_SPEC);
  for (const [, l] of maps.endings) checkObject(c, l.def, l.file, ENDING_SPEC);
  for (const [, l] of maps.scores) SCORE_CHECK(c, l.def, l.file);
  for (const [, l] of maps.vars) valueCheck(c, l.def, l.file);
  for (const [, l] of maps.verbs) checkObject(c, l.def, l.file, VERB_SPEC);
  for (const [, l] of maps.directions) checkObject(c, l.def, l.file, DIRECTION_SPEC);
  for (const [, l] of maps.messages) MESSAGE_CHECK(c, l.def, l.file);
  for (const [, l] of maps.dialogues) checkObject(c, l.def, l.file, DIALOGUE_SPEC);

  // Build
  const directions = new Map<string, { id: string; words: string[]; opposite: string | null }>();
  for (const [id, d] of Object.entries(STANDARD_DIRECTIONS)) {
    directions.set(id, { id, words: [...d.words], opposite: d.opposite });
  }
  for (const [id, { def }] of maps.directions) {
    const d = def as DirectionDef;
    if (!Array.isArray(d.words)) continue;
    const existing = directions.get(id);
    if (existing) existing.words.push(...d.words.filter((w) => !existing.words.includes(w)));
    else directions.set(id, { id, words: [...d.words], opposite: d.opposite ?? null });
  }
  const directionWords = new Map<string, string>();
  for (const d of directions.values()) {
    for (const w of d.words) {
      const prev = directionWords.get(w);
      if (prev && prev !== d.id) c.error('directions', 'vocabulary-clash', `The word "${w}" is used by directions "${prev}" and "${d.id}"`);
      directionWords.set(w, d.id);
    }
  }

  const rooms = new Map<string, Room>();
  for (const [id, { def, file }] of maps.rooms) {
    if (!isPlainObject(def)) continue;
    rooms.set(id, buildRoom(c, id, def as unknown as RoomDef, file, directionWords));
  }

  const things = new Map<string, Thing>();
  let order = 0;
  for (const section of ['objects', 'characters'] as const) {
    for (const [id, { def }] of maps[section]) {
      if (!isPlainObject(def)) continue;
      things.set(id, buildThing(id, def as unknown as CharacterDef, section === 'characters' ? 'character' : 'object', order++));
    }
  }

  const regions = new Map<string, RegionDef>();
  for (const [id, { def }] of maps.regions) if (isPlainObject(def)) regions.set(id, def as RegionDef);
  const usedRegions = new Set<string>();
  for (const r of rooms.values()) if (r.region) usedRegions.add(r.region);
  for (const r of usedRegions) if (!regions.has(r)) regions.set(r, {});
  for (const [id, { file }] of maps.regions) {
    if (!usedRegions.has(id)) c.warn(file, 'empty-region', `No room is in region "${id}"`);
    if (rooms.has(id)) c.error(file, 'duplicate-id', `Region "${id}" has the same id as a room`);
  }

  const actList: ActDef[] = [];
  const actIds = new Set<string>();
  for (const { def, file } of acts) {
    if (!isPlainObject(def) || typeof def.id !== 'string') continue;
    if (actIds.has(def.id)) c.error(file, 'duplicate-id', `Act "${def.id}" is defined twice`);
    actIds.add(def.id);
    actList.push(def as unknown as ActDef);
  }

  const verbs = new Map<string, Verb>();
  for (const [id, v] of Object.entries(STANDARD_VERBS)) {
    verbs.set(id, {
      id,
      patterns: [...v.patterns],
      default: null,
      multi: !!v.multi,
      meta: !!v.meta,
      builtin: true,
      standardCount: v.patterns.length,
    });
  }
  for (const [id, { def, file }] of maps.verbs) {
    if (!isPlainObject(def)) continue;
    const v = def as VerbDef;
    const existing = verbs.get(id);
    if (existing) {
      existing.patterns.push(...(v.patterns ?? []));
      if (v.default !== undefined) {
        c.warn(file, 'verb-default', `"${id}" is a standard verb, so its "default" is ignored; change its response with a rule or a message`);
      }
      if (v.multi !== undefined || v.meta !== undefined) {
        c.warn(file, 'verb-flags', `"${id}" is a standard verb; its multi and meta settings cannot be changed`);
      }
    } else {
      if (!v.patterns || v.patterns.length === 0) c.error(file, 'missing-field', `New verb "${id}" needs at least one pattern`);
      verbs.set(id, {
        id,
        patterns: [...(v.patterns ?? [])],
        default: v.default ?? null,
        multi: !!v.multi,
        meta: !!v.meta,
        builtin: false,
        standardCount: 0,
      });
    }
    for (const p of v.patterns ?? []) checkPattern(c, p, `${file}.patterns`, directionWords);
  }
  for (const id of scripts.actions.keys()) {
    const where = scripts.origins.get(`action:${id}`) ?? 'scripts';
    const verb = verbs.get(id);
    if (!verb) c.error(where, 'unknown-verb', `Script handles verb "${id}", which no pack verb defines`);
    else if (verb.builtin) {
      c.error(where, 'builtin-verb', `Scripts can't replace the standard verb "${id}"; use a rule with a script effect`);
    }
  }

  const ruleList: Rule[] = [];
  rules.forEach(({ def, file }, i) => {
    if (!isPlainObject(def)) return;
    const r = def as unknown as RuleDef;
    const actions = Array.isArray(r.on) ? r.on : typeof r.on === 'string' ? [r.on] : [];
    ruleList.push({
      ...r,
      id: r.id ?? file,
      actions,
      when: r.when ?? 'before',
      specificity: specificity(r),
      index: i,
    });
  });
  const ruleIds = new Map<string, string>();
  rules.forEach(({ def, file }) => {
    if (isPlainObject(def) && typeof def.id === 'string') {
      const prev = ruleIds.get(def.id);
      if (prev) c.error(file, 'duplicate-id', `Rule id "${def.id}" is already used in ${prev}`);
      ruleIds.set(def.id, file);
    }
  });
  // Rule order: priority, then specificity, then load order. Stable.
  const loadOrder = new Map(ruleList.map((r, i) => [r, i]));
  ruleList.sort(
    (a, b) =>
      (b.priority ?? 0) - (a.priority ?? 0) || b.specificity - a.specificity || loadOrder.get(a)! - loadOrder.get(b)!,
  );

  const events = new Map<string, EventDef>();
  for (const [id, { def }] of maps.events) if (isPlainObject(def)) events.set(id, def as EventDef);
  const endings = new Map<string, EndingDef>();
  for (const [id, { def }] of maps.endings) if (isPlainObject(def)) endings.set(id, def as unknown as EndingDef);
  const scores = new Map<string, ScoreDef>();
  let maxScore = 0;
  for (const [id, { def }] of maps.scores) {
    const s: ScoreDef = typeof def === 'number' ? { points: def } : (def as ScoreDef);
    if (typeof s?.points !== 'number') continue;
    scores.set(id, s);
    if (s.points > 0) maxScore += s.points;
  }
  const vars: Record<string, Value> = {};
  for (const [id, { def }] of maps.vars) vars[id] = def as Value;
  const dialogues = new Map<string, DialogueDef>();
  for (const [id, { def, file }] of maps.dialogues) {
    if (!isPlainObject(def) || !isPlainObject(def.nodes)) continue;
    const d = def as unknown as DialogueDef;
    dialogues.set(id, d);
    if (!maps.characters.has(id)) {
      c.error(file, maps.objects.has(id) ? 'not-a-character' : 'dangling-ref', `Dialogues belong to characters; "${id}" is not a character`);
    }
    checkDialogue(c, id, d, file);
  }
  const messages: Record<string, string> = { ...STANDARD_MESSAGES };
  for (const [id, { def }] of maps.messages) if (typeof def === 'string') messages[id] = def;

  // Object vocabulary must avoid parser keywords, and must exist.
  for (const t of things.values()) {
    if (t.words.size === 0) {
      c.error(definedIn.get(t.id) ?? t.id, 'no-words', `"${t.id}" has no words the player can use to name it; give it "nouns"`);
    }
    for (const w of t.words) {
      if (RESERVED_WORDS.includes(w)) {
        c.error(definedIn.get(t.id) ?? t.id, 'vocabulary-clash', `"${w}" is a parser keyword and can't name ${t.id}`);
      }
    }
  }

  const world: World = {
    manifest,
    rooms,
    things,
    regions,
    acts: actList,
    rules: ruleList,
    events,
    endings,
    scores,
    maxScore,
    vars,
    verbs,
    directions,
    directionWords,
    messages,
    dialogues,
    texts,
    scripts,
    validator: { assumeReachable, assumeObtainable, assumeUsed, ignoreWords },
    walkthroughs: src.walkthroughs,
    origin: src.origin,
  };

  resolveRefs(c, world, definedIn);
  return result(world);
}

function collectIds(ch: Checker, v: unknown, where: string, into: string[]): void {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) ch.error(where, 'type', 'Expected a list of ids');
  else {
    into.push(...(v as string[]));
    (v as string[]).forEach((x, i) => ch.ref('entity', x, `${where}[${i}]`));
  }
}

function registerScript(c: Checker, file: string, module: unknown, registry: ScriptTable): void {
  const fn = isPlainObject(module) || typeof module === 'object' ? (module as { default?: unknown }).default : undefined;
  if (typeof fn !== 'function') {
    c.error(file, 'bad-script', 'A script module must export a default function');
    return;
  }
  const add = <T>(kind: 'condition' | 'effect' | 'action', map: Map<string, T>, name: string, f: T) => {
    if (typeof name !== 'string' || typeof f !== 'function') {
      c.error(file, 'bad-script', `api.${kind}() needs a name and a function`);
      return;
    }
    const key = `${kind}:${name}`;
    const prev = registry.origins.get(key);
    if (prev) c.error(file, 'duplicate-id', `Script ${kind} "${name}" is already registered by ${prev}`);
    registry.origins.set(key, file);
    map.set(name, f);
  };
  try {
    fn({
      condition: (name: string, f: unknown) => add('condition', registry.conditions, name, f as never),
      effect: (name: string, f: unknown) => add('effect', registry.effects, name, f as never),
      action: (name: string, f: unknown) => add('action', registry.actions, name, f as never),
    });
  } catch (e) {
    c.error(file, 'bad-script', `Script registration failed: ${(e as Error).message}`);
  }
}

function buildRoom(c: Checker, id: string, def: RoomDef, file: string, directionWords: Map<string, string>): Room {
  const exits = new Map<string, Exit>();
  for (const [key, raw] of Object.entries(def.exits ?? {})) {
    if (key.startsWith('_')) continue;
    const dir = directionWords.get(key) ?? key;
    if (exits.has(dir)) c.error(`${file}.exits.${key}`, 'duplicate-exit', `Two exits lead ${dir}`);
    const e: Exclude<ExitDef, string> = typeof raw === 'string' ? { to: raw } : (raw ?? {});
    exits.set(dir, {
      dir,
      to: e.to ?? null,
      door: e.door ?? null,
      if: e.if ?? null,
      else: e.else ?? null,
      say: e.say ?? null,
      do: e.do ?? [],
    });
  }
  return {
    kind: 'room',
    id,
    name: def.name,
    description: def.description ?? null,
    firstVisit: def.firstVisit ?? null,
    region: def.region ?? null,
    exits,
    noExit: def.noExit ?? null,
    tags: def.tags ?? [],
    initialProps: { dark: !!def.dark, visited: false, ...(def.props ?? {}) },
  };
}

function buildThing(id: string, def: CharacterDef, kind: 'object' | 'character', order: number): Thing {
  const derived = nameWords(def.name ?? id).filter((w) => !RESERVED_WORDS.includes(w));
  const nouns = def.nouns ?? (derived.length > 0 ? [derived[derived.length - 1]] : []);
  const adjectives = def.adjectives ?? [];
  const words = new Set([...nouns, ...adjectives, ...derived]);
  const plural = !!def.plural;
  const proper = def.proper ?? (kind === 'character' && /^[A-Z]/.test(def.name ?? ''));
  const article = def.article ?? (proper ? '' : plural ? 'some' : /^[aeiou]/i.test(def.name ?? '') ? 'an' : 'a');
  const keys = def.key === undefined ? [] : Array.isArray(def.key) ? def.key : [def.key];
  const openable = !!def.openable || !!def.door;
  const scenery = !!def.scenery;
  return {
    kind,
    id,
    order,
    name: def.name,
    nouns,
    adjectives,
    words,
    article,
    proper,
    plural,
    description: def.description ?? null,
    initial: def.initial ?? null,
    read: def.read ?? null,
    location: def.location ?? (def.worn ? 'player' : null),
    foundIn: def.foundIn ?? [],
    fixed: !!def.fixed || scenery || !!def.door || kind === 'character',
    fixedMessage: typeof def.fixed === 'string' ? def.fixed : null,
    scenery,
    container: !!def.container,
    surface: !!def.surface,
    openable,
    lockable: def.lockable ?? (keys.length > 0 || !!def.locked),
    keys,
    transparent: !!def.transparent,
    capacity: def.capacity ?? null,
    wearable: !!def.wearable,
    switchable: !!def.switchable,
    light: !!def.light,
    edible: !!def.edible,
    drinkable: !!def.drinkable,
    door: !!def.door,
    tags: def.tags ?? [],
    initialProps: {
      open: openable ? !!def.open : true,
      locked: !!def.locked,
      on: !!def.on,
      worn: !!def.worn,
      moved: false,
      following: !!def.following,
      ...(def.props ?? {}),
    },
    pronoun: def.pronoun ?? (plural ? 'them' : kind === 'character' ? 'them' : 'it'),
    // Topic ids are scoped to their character, so "once" never collides.
    topics: (def.topics ?? []).map((t, i) => ({ ...t, id: `topic:${id}:${t.id ?? i}` })),
    talk: def.talk ?? null,
    noTopic: def.noTopic ?? null,
    wander: def.wander ?? null,
    arrive: def.arrive ?? null,
    depart: def.depart ?? null,
  };
}

function specificity(r: RuleDef): number {
  const m = (v: unknown, exact: number) => {
    if (v === undefined) return 0;
    const list = Array.isArray(v) ? v : [v];
    if (list.includes('*')) return 1;
    if (list.some((x) => typeof x === 'string' && x.startsWith('#'))) return exact - 2;
    return exact;
  };
  return m(r.object, 8) + m(r.with, 8) + (r.dir ? 4 : 0) + (r.topic ? 4 : 0) + (r.in ? 2 : 0) + (r.if ? 1 : 0);
}

const SLOTS = ['OBJ', 'OBJ2', 'TEXT', 'DIR'];

export function checkPattern(c: Checker, p: string, where: string, directionWords: Map<string, string>): void {
  if (typeof p !== 'string' || p.trim() === '') return c.error(where, 'bad-pattern', 'Empty pattern');
  const tokens = p.trim().split(/\s+/);
  const seen = new Set<string>();
  for (const t of tokens) {
    if (/^[A-Z0-9]+$/.test(t)) {
      if (!SLOTS.includes(t)) c.error(where, 'bad-pattern', `"${t}" in "${p}" is not a slot (use OBJ, OBJ2, TEXT or DIR)`);
      if (seen.has(t)) c.error(where, 'bad-pattern', `"${t}" appears twice in "${p}"`);
      seen.add(t);
    } else {
      for (const w of t.split('/')) {
        if (!/^[a-z0-9-]+$/.test(w)) c.error(where, 'bad-pattern', `"${w}" in "${p}" must be a lower-case word`);
        else if (RESERVED_WORDS.includes(w)) c.error(where, 'bad-pattern', `"${w}" in "${p}" is a parser keyword`);
      }
    }
  }
  if (seen.has('OBJ2') && !seen.has('OBJ')) c.error(where, 'bad-pattern', `"${p}" uses OBJ2 without OBJ`);
  void directionWords;
}

function resolveRefs(c: Checker, w: World, definedIn: Map<string, string>): void {
  const declaredProps = (id: string): Set<string> | null => {
    const room = w.rooms.get(id);
    if (room) return new Set([...STANDARD_PROPS, ...Object.keys(room.initialProps)]);
    const thing = w.things.get(id);
    if (thing) return new Set([...STANDARD_PROPS, ...Object.keys(thing.initialProps)]);
    return null;
  };
  const checkVar = (r: Ref, write: boolean) => {
    const dot = r.id.indexOf('.');
    if (dot < 0) {
      if (BUILTIN_VARS.includes(r.id)) {
        if (write) c.error(r.where, 'read-only', `"${r.id}" is a built-in variable and can't be changed`);
        return;
      }
      if (!(r.id in w.vars)) {
        const s = suggest(r.id, Object.keys(w.vars));
        c.error(r.where, 'undeclared-var', `Variable "${r.id}" is not declared in "vars"${s ? ` (did you mean "${s}"?)` : ''}`);
      }
      return;
    }
    const id = r.id.slice(0, dot);
    const prop = r.id.slice(dot + 1);
    const props = declaredProps(id);
    if (!props) return dangling(r, 'thing or room');
    if (!props.has(prop)) {
      c.error(r.where, 'undeclared-prop', `"${id}" has no property "${prop}"; declare it in ${id}'s "props"`);
    }
  };
  const dangling = (r: Ref, what: string, options?: Iterable<string>) => {
    const s = options ? suggest(r.id, options) : null;
    c.error(r.where, 'dangling-ref', `Unknown ${what} "${r.id}"${s ? ` (did you mean "${s}"?)` : ''}`);
  };
  const entityIds = () => [...w.rooms.keys(), ...w.things.keys()];
  const noDialogue = (where: string, who: string) =>
    c.error(where, 'dangling-ref', `No dialogue for "${who}" in "dialogues"${suggestText(who, [...w.dialogues.keys()])}`);

  for (const r of c.refs) {
    switch (r.kind) {
      case 'room':
        if (!w.rooms.has(r.id)) dangling(r, 'room', w.rooms.keys());
        break;
      case 'thing':
        if (!w.things.has(r.id)) dangling(r, 'object or character', w.things.keys());
        break;
      case 'entity':
        if (!w.rooms.has(r.id) && !w.things.has(r.id)) dangling(r, 'id', entityIds());
        break;
      case 'location': {
        if (w.rooms.has(r.id)) break;
        const t = w.things.get(r.id);
        if (!t) dangling(r, 'room, object or character', entityIds());
        else if (!t.container && !t.surface && t.kind !== 'character') {
          c.error(r.where, 'not-a-container', `"${r.id}" is not a container, surface or character, so nothing can be put there`);
        }
        break;
      }
      case 'door': {
        const t = w.things.get(r.id);
        if (!t) dangling(r, 'door', w.things.keys());
        else if (!t.door) c.error(r.where, 'not-a-door', `"${r.id}" is used as a door but does not have "door": true`);
        break;
      }
      case 'region':
        if (!w.regions.has(r.id)) dangling(r, 'region', w.regions.keys());
        break;
      case 'roomOrRegion':
        if (!w.rooms.has(r.id) && !w.regions.has(r.id)) dangling(r, 'room or region', [...w.rooms.keys(), ...w.regions.keys()]);
        break;
      case 'act':
        if (!w.acts.some((a) => a.id === r.id)) dangling(r, 'act', w.acts.map((a) => a.id));
        break;
      case 'event':
        if (!w.events.has(r.id)) dangling(r, 'event', w.events.keys());
        break;
      case 'ending':
        if (!w.endings.has(r.id)) dangling(r, 'ending', w.endings.keys());
        break;
      case 'score':
        if (!w.scores.has(r.id)) dangling(r, 'score item', w.scores.keys());
        break;
      case 'passage':
        if (!w.texts.has(r.id)) dangling(r, 'passage', w.texts.keys());
        break;
      case 'var':
        checkVar(r, false);
        break;
      case 'varWrite':
        checkVar(r, true);
        break;
      case 'action':
        if (!w.verbs.has(r.id) && !(PSEUDO_ACTIONS as readonly string[]).includes(r.id)) {
          dangling(r, 'verb', [...w.verbs.keys(), ...PSEUDO_ACTIONS]);
        }
        break;
      case 'direction':
        if (!w.directions.has(r.id) && !w.directionWords.has(r.id)) dangling(r, 'direction', w.directions.keys());
        break;
      case 'scriptCondition':
        if (!w.scripts.conditions.has(r.id)) dangling(r, 'script condition', w.scripts.conditions.keys());
        break;
      case 'dialogue':
        if (!w.dialogues.has(r.id)) noDialogue(r.where, r.id);
        break;
      case 'dialogueNode': {
        const [who, node] = r.id.split(':');
        const d = w.dialogues.get(who);
        if (d && !(node in d.nodes)) {
          c.error(r.where, 'dangling-ref', `Unknown node "${node}" in ${who}'s dialogue${suggestText(node, Object.keys(d.nodes))}`);
        }
        break;
      }
      case 'saidOption': {
        const dot = r.id.indexOf('.');
        const who = r.id.slice(0, dot);
        const option = r.id.slice(dot + 1);
        const d = w.dialogues.get(who);
        if (!d) noDialogue(r.where, who);
        else if (!dialogueOptionIds(d).includes(option)) {
          c.error(r.where, 'dangling-ref', `Unknown option "${option}" in ${who}'s dialogue${suggestText(option, dialogueOptionIds(d))}`);
        }
        break;
      }
      case 'scriptEffect':
        if (!w.scripts.effects.has(r.id)) dangling(r, 'script effect', w.scripts.effects.keys());
        break;
    }
  }
  void definedIn;
}

/** All option ids of a dialogue. */
export function dialogueOptionIds(d: DialogueDef): string[] {
  return Object.values(d.nodes).flatMap((n) => (n?.options ?? []).map((o) => o.id));
}

/** Node references inside a dialogue, and option id uniqueness. */
function checkDialogue(c: Checker, who: string, d: DialogueDef, file: string): void {
  const nodes = Object.keys(d.nodes);
  const seen = new Map<string, string>();
  for (const [i, e] of (d.entry ?? []).entries()) {
    if (typeof e?.node === 'string' && !nodes.includes(e.node)) {
      c.error(`${file}.entry[${i}]`, 'dangling-ref', `Unknown node "${e.node}" in ${who}'s dialogue${suggestText(e.node, nodes)}`);
    }
  }
  if (!d.entry && !nodes.includes('start')) {
    c.error(file, 'missing-field', `${who}'s dialogue has no "entry" list and no node called "start"`);
  }
  for (const [name, node] of Object.entries(d.nodes)) {
    for (const [i, o] of (node?.options ?? []).entries()) {
      const where = `${file}.nodes.${name}.options[${i}]`;
      if (typeof o?.id !== 'string') continue;
      const prev = seen.get(o.id);
      if (prev) c.error(where, 'duplicate-id', `Option id "${o.id}" is already used in ${prev}`);
      seen.set(o.id, where);
      if (typeof o.then === 'string' && o.then !== 'end' && !nodes.includes(o.then)) {
        c.error(`${where}.then`, 'dangling-ref', `Unknown node "${o.then}" in ${who}'s dialogue${suggestText(o.then, nodes)}`);
      }
    }
  }
}

function suggestText(word: string, options: string[]): string {
  const s = suggest(word, options);
  return s ? ` (did you mean "${s}"?)` : '';
}

/** Initial values of an entity's properties, used to build a fresh state. */
export function initialProps(w: World): Record<string, Record<string, Value>> {
  const out: Record<string, Record<string, Value>> = {};
  for (const r of w.rooms.values()) out[r.id] = { ...r.initialProps };
  for (const t of w.things.values()) out[t.id] = { ...t.initialProps };
  return out;
}

export type { ObjectDef };
