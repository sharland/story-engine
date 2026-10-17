// A running game: a compiled World plus a GameState, the turn loop, and the
// machinery that rules, actions and scripts share (text, conditions,
// effects, movement, scoring, endings).

import { ACTIONS } from './actions.ts';
import { initialProps } from './pack.ts';
import { answer, compileGrammar, knownWords, parse, splitInput, type ParsedCommand, type ParseOutcome, type ParserEnv, type Pattern, type Pending } from './parser.ts';
import { nextRandom, seedState } from './rng.ts';
import type { ScriptContext } from './script-api.ts';
import { PSEUDO_ACTIONS } from './stdlib.ts';
import { capitalise, fillTemplate, joinList, matchTopic, normaliseWords, passageRef, toBlocks, unescapeAt } from './text.ts';
import type { Condition, DialogueDef, DialogueOptionDef, Effect, GameState, Matcher, Rule, TextDef, Thing, Value, World } from './types.ts';
import {
  PLAYER,
  blockedBy,
  canSeeInto,
  childrenOf,
  flag,
  givesLight,
  inventoryTree,
  isHeld,
  isLit,
  isPresent,
  potentialScope,
  prop,
  scope,
  truthy,
} from './world.ts';

export interface Host {
  /** Store a saved game. Return false if it could not be stored. */
  save?(slot: string, data: string): boolean;
  /** Fetch a saved game, or null. */
  load?(slot: string): string | null;
}

export type BlockStyle = 'title' | 'heading' | 'text' | 'parser' | 'option';

export interface Block {
  style: BlockStyle;
  text: string;
  /** For style "option": the number to type, or null for a locked line. */
  option?: number | null;
}

export interface GameOptions {
  seed?: number;
  host?: Host;
  /** How many turns undo can step back. Default 10. */
  undoDepth?: number;
}

export interface ActionCtx {
  action: string | null;
  noun: string | null;
  second: string | null;
  topic: string | null;
  dir: string | null;
}

type Params = Record<string, string | number>;

/** Template tags that take a thing: {the:noun}, {is:second}, {s:some-id} ... */
export const THING_TAGS = ['the', 'The', 'a', 'A', 'name', 'it', 'It', 'that', 'That', 'is', 'has', 's', 'es'];

/** Words that end a conversation while a menu is open. */
const LEAVE_WORDS = ['leave', 'bye', 'goodbye', 'farewell'];

const ALLOWED_AFTER_END = ['restart', 'restore', 'undo', 'quit', 'about', 'help', 'score'];

export function renderBlocks(blocks: Block[]): string {
  return blocks.map((b) => b.text).join('\n');
}

export function initialState(world: World, seed: number): GameState {
  const parent: Record<string, string | null> = {};
  for (const t of world.things.values()) parent[t.id] = t.location;
  return {
    format: 1,
    pack: { id: world.manifest.id, version: world.manifest.version },
    seed,
    rng: seedState(seed),
    turns: 0,
    score: 0,
    awarded: [],
    location: world.manifest.start,
    parent,
    props: initialProps(world),
    vars: { ...world.vars },
    act: null,
    events: [],
    fired: [],
    it: null,
    him: null,
    her: null,
    verbose: true,
    ended: null,
    conversation: null,
    said: [],
    paused: {},
    lastSpeaker: null,
  };
}

export class Game {
  readonly world: World;
  state: GameState;
  private readonly host: Host;
  private readonly undoDepth: number;
  private readonly grammar: Pattern[];
  private readonly known: Set<string>;
  private out: Block[] = [];
  private undoStack: string[] = [];
  private pending: Pending | null = null;
  private last: ParsedCommand | null = null;
  private ctxStack: ActionCtx[] = [];
  private started = false;
  /** The open conversation's menu needs printing at the end of this input. */
  private menuDue = false;
  quitRequested = false;

  constructor(world: World, options: GameOptions = {}) {
    this.world = world;
    this.host = options.host ?? {};
    this.undoDepth = options.undoDepth ?? 10;
    this.state = initialState(world, options.seed ?? 1);
    this.grammar = compileGrammar(world);
    this.known = knownWords(world, this.grammar);
  }

  // -------------------------------------------------------------------------
  // Public interface

  /** Print the opening: intro, first act, first room. Call once. */
  start(): Block[] {
    this.out = [];
    if (!this.started) {
      this.started = true;
      this.begin();
    }
    this.flushMenu();
    return this.flush();
  }

  /** Process one line of player input. */
  input(line: string): Block[] {
    this.out = [];
    if (!this.started) {
      this.started = true;
      this.begin();
    }
    const commands = splitInput(line);
    if (commands.length === 0) this.msg('emptyCommand', {}, 'parser');
    for (const tokens of commands) {
      const stop = this.handleTokens(tokens) || this.quitRequested;
      this.flushMenu();
      if (stop) break;
    }
    return this.flush();
  }

  get ended(): boolean {
    return this.state.ended !== null;
  }

  /** The current state as a JSON string: a save file. */
  saveState(): string {
    return JSON.stringify(this.state);
  }

  /** Replace the current state with a saved one. Throws if it doesn't fit this pack. */
  restoreState(json: string): void {
    const s = JSON.parse(json) as GameState;
    if (!s || s.format !== 1 || typeof s.location !== 'string' || typeof s.parent !== 'object') {
      throw new Error('not a saved game');
    }
    if (s.pack?.id !== this.world.manifest.id) throw new Error(`saved from a different story (${s.pack?.id})`);
    if (s.pack.version !== this.world.manifest.version) {
      throw new Error(`saved with version ${s.pack.version} of this story, this is ${this.world.manifest.version}`);
    }
    s.conversation ??= null;
    s.said ??= [];
    s.paused ??= {};
    s.lastSpeaker ??= null;
    this.state = s;
    this.undoStack = [];
    this.pending = null;
    this.started = true;
    this.menuDue = s.conversation !== null;
  }

  // -------------------------------------------------------------------------
  // Output and text

  private flush(): Block[] {
    const out = this.out;
    this.out = [];
    return out;
  }

  print(text: string, style: BlockStyle = 'text'): void {
    for (const b of toBlocks(text)) this.out.push({ style, text: b });
  }

  /** Print a text field: variants, passage references and templates resolved. */
  say(def: TextDef | null | undefined, params: Params = {}, style: BlockStyle = 'text'): void {
    const s = this.render(def, params);
    if (s) this.print(s, style);
  }

  /** Print a standard (or pack-overridden) message. An empty message prints nothing. */
  msg(key: string, params: Params = {}, style: BlockStyle = 'text'): void {
    this.say(this.world.messages[key] ?? key, params, style);
  }

  messageText(key: string, params: Params = {}): string {
    return this.render(this.world.messages[key] ?? key, params);
  }

  render(def: TextDef | null | undefined, params: Params = {}): string {
    return this.fill(this.evalText(def), params);
  }

  evalText(def: TextDef | null | undefined): string {
    if (def === null || def === undefined) return '';
    if (typeof def === 'string') return this.resolveString(def);
    const parts: string[] = [];
    for (const part of def) {
      if (typeof part === 'string') parts.push(this.resolveString(part));
      else if (part.if === undefined || this.test(part.if)) parts.push(this.resolveString(part.text));
      else if (part.else !== undefined) parts.push(this.resolveString(part.else));
    }
    return parts.filter((p) => p.length > 0).join(' ');
  }

  private resolveString(s: string): string {
    const key = passageRef(s);
    if (key !== null) return this.world.texts.get(key) ?? `[missing passage ${key}]`;
    return unescapeAt(s);
  }

  private fill(s: string, params: Params): string {
    const ctx = this.ctx();
    return fillTemplate(s, (tag, ref) => {
      if (THING_TAGS.includes(tag)) {
        let id: string | null = ref;
        if (ref === 'noun') id = params.noun !== undefined ? String(params.noun) : ctx.noun;
        else if (ref === 'second') id = params.second !== undefined ? String(params.second) : ctx.second;
        if (!id) return '';
        return this.nameForm(tag, id);
      }
      if (tag === 'var' && ref) return String(this.get(ref) ?? '');
      if (tag === 'score') return String(this.state.score);
      if (tag === 'max') return String(this.world.maxScore);
      if (tag === 'turns') return String(this.state.turns);
      if (tag === 'turnCount') return `${this.state.turns} ${this.state.turns === 1 ? 'turn' : 'turns'}`;
      if (params[tag] !== undefined) return String(params[tag]);
      return null;
    });
  }

  private nameForm(tag: string, id: string): string {
    const t = this.world.things.get(id);
    if (!t) {
      const room = this.world.rooms.get(id);
      return room ? room.name : id;
    }
    switch (tag) {
      case 'the':
        return this.theName(id);
      case 'The':
        return capitalise(this.theName(id));
      case 'a':
        return this.aName(id);
      case 'A':
        return capitalise(this.aName(id));
      case 'name':
        return t.name;
      case 'it':
        return t.plural ? 'them' : t.pronoun;
      case 'It':
        return t.plural ? 'They' : ({ him: 'He', her: 'She', them: 'They', it: 'It' } as const)[t.pronoun];
      case 'that':
        return this.thatWord(t);
      case 'That':
        return capitalise(this.thatWord(t));
      case 'is':
        return t.plural ? 'are' : 'is';
      case 'has':
        return t.plural ? 'have' : 'has';
      case 's':
        return t.plural ? '' : 's';
      case 'es':
        return t.plural ? '' : 'es';
    }
    return t.name;
  }

  private thatWord(t: Thing): string {
    if (t.plural) return 'those';
    if (t.kind === 'character') return t.pronoun === 'it' ? 'that' : t.pronoun;
    return 'that';
  }

  theName(id: string): string {
    const t = this.world.things.get(id);
    if (!t) return this.world.rooms.get(id)?.name ?? id;
    return t.proper || t.article === '' ? t.name : `the ${t.name}`;
  }

  aName(id: string): string {
    const t = this.world.things.get(id);
    if (!t) return id;
    return t.proper || t.article === '' ? t.name : `${t.article} ${t.name}`;
  }

  listOf(ids: string[]): string {
    return joinList(ids.map((id) => this.aName(id)));
  }

  // -------------------------------------------------------------------------
  // State access

  ctx(): ActionCtx {
    return this.ctxStack[this.ctxStack.length - 1] ?? { action: null, noun: null, second: null, topic: null, dir: null };
  }

  get(ref: string): Value {
    const dot = ref.indexOf('.');
    if (dot >= 0) return prop(this.world, this.state, ref.slice(0, dot), ref.slice(dot + 1));
    switch (ref) {
      case 'turns':
        return this.state.turns;
      case 'score':
        return this.state.score;
      case 'maxScore':
        return this.world.maxScore;
      case 'room':
        return this.state.location;
      case 'act':
        return this.state.act;
    }
    return this.state.vars[ref] ?? null;
  }

  set(ref: string, value: Value): void {
    const dot = ref.indexOf('.');
    if (dot >= 0) {
      this.setProp(ref.slice(0, dot), ref.slice(dot + 1), value);
      return;
    }
    if (!(ref in this.world.vars)) throw new Error(`Variable "${ref}" is not declared`);
    this.state.vars[ref] = value;
  }

  prop(id: string, name: string): Value {
    return prop(this.world, this.state, id, name);
  }

  flag(id: string, name: string): boolean {
    return flag(this.world, this.state, id, name);
  }

  setProp(id: string, name: string, value: Value): void {
    if (!this.world.rooms.has(id) && !this.world.things.has(id)) throw new Error(`No entity "${id}"`);
    (this.state.props[id] ??= {})[name] = value;
  }

  random(): number {
    const [v, next] = nextRandom(this.state.rng);
    this.state.rng = next;
    return v;
  }

  randomInt(n: number): number {
    return Math.floor(this.random() * n);
  }

  // -------------------------------------------------------------------------
  // World queries

  thing(id: string): Thing {
    const t = this.world.things.get(id);
    if (!t) throw new Error(`No object "${id}"`);
    return t;
  }

  parentOf(id: string): string | null {
    return this.state.parent[id] ?? null;
  }

  children(holder: string): Thing[] {
    return childrenOf(this.world, this.state, holder);
  }

  isHeld(id: string): boolean {
    return isHeld(this.world, this.state, id);
  }

  isDirectlyHeld(id: string): boolean {
    return this.state.parent[id] === PLAYER;
  }

  isLit(): boolean {
    return isLit(this.world, this.state);
  }

  scope(): Thing[] {
    return scope(this.world, this.state);
  }

  inScope(id: string): boolean {
    return this.scope().some((t) => t.id === id);
  }

  blockedBy(id: string): string | null {
    return blockedBy(this.world, this.state, id);
  }

  canSeeInto(t: Thing): boolean {
    return canSeeInto(this.world, this.state, t);
  }

  givesLight(t: Thing): boolean {
    return givesLight(this.world, this.state, t);
  }

  /** Move an object or character. "to" is an id, "player", or null for nowhere. */
  moveThing(id: string, to: string | null): void {
    if (this.state.parent[id] === PLAYER && to !== PLAYER && this.flag(id, 'worn')) this.setProp(id, 'worn', false);
    if (to === PLAYER && this.world.things.get(id)?.kind === 'object') this.setProp(id, 'moved', true);
    this.state.parent[id] = to;
  }

  // -------------------------------------------------------------------------
  // Conditions

  test(c: Condition): boolean {
    const s = this.state;
    if ('all' in c) return c.all.every((x) => this.test(x));
    if ('any' in c) return c.any.some((x) => this.test(x));
    if ('not' in c) return !this.test(c.not);
    if ('var' in c) {
      const v = this.get(c.var);
      if (c.eq !== undefined) return v === c.eq;
      if (c.ne !== undefined) return v !== c.ne;
      const n = typeof v === 'number' ? v : Number(v);
      if (c.gt !== undefined) return n > c.gt;
      if (c.gte !== undefined) return n >= c.gte;
      if (c.lt !== undefined) return n < c.lt;
      if (c.lte !== undefined) return n <= c.lte;
      return truthy(v);
    }
    if ('has' in c) return this.isHeld(c.has);
    if ('wearing' in c) return this.isHeld(c.wearing) && this.flag(c.wearing, 'worn');
    if ('at' in c) return (Array.isArray(c.at) ? c.at : [c.at]).includes(s.location);
    if ('region' in c) return this.world.rooms.get(s.location)?.region === c.region;
    if ('here' in c) return isPresent(this.world, s, c.here);
    if ('obj' in c) {
      const p = s.parent[c.obj] ?? null;
      if (c.in === 'nowhere') return p === null;
      return p === c.in;
    }
    if ('visited' in c) return this.flag(c.visited, 'visited');
    if ('actAtLeast' in c) return this.actIndex(s.act) >= this.actIndex(c.actAtLeast);
    if ('act' in c) return s.act === c.act;
    if ('light' in c) return this.isLit() === c.light;
    if ('chance' in c) return this.random() < c.chance;
    if ('said' in c) return this.state.said.includes(c.said);
    if ('script' in c) {
      const fn = this.world.scripts.conditions.get(c.script);
      if (!fn) throw new Error(`No script condition "${c.script}"`);
      return !!fn(this.scriptContext(this.ctx(), c.args));
    }
    throw new Error(`Unknown condition ${JSON.stringify(c)}`);
  }

  private actIndex(id: string | null): number {
    return id === null ? -1 : this.world.acts.findIndex((a) => a.id === id);
  }

  // -------------------------------------------------------------------------
  // Effects

  run(effects: Effect[] | undefined | null): void {
    for (const e of effects ?? []) {
      if (this.state.ended || this.quitRequested) return;
      this.runEffect(e);
    }
  }

  private runEffect(e: Effect): void {
    if ('say' in e) this.say(e.say);
    else if ('sayRandom' in e) {
      if (e.sayRandom.length > 0) this.say(e.sayRandom[this.randomInt(e.sayRandom.length)]);
    } else if ('set' in e) this.set(e.set, e.to);
    else if ('inc' in e) this.set(e.inc, Number(this.get(e.inc) ?? 0) + (e.by ?? 1));
    else if ('dec' in e) this.set(e.dec, Number(this.get(e.dec) ?? 0) - (e.by ?? 1));
    else if ('movePlayer' in e) this.movePlayer(e.movePlayer, false);
    else if ('move' in e) {
      const to = e.to === 'nowhere' ? null : e.to === 'here' ? this.state.location : e.to;
      this.moveThing(e.move, to);
    } else if ('award' in e) this.award(e.award);
    else if ('end' in e) this.end(e.end);
    else if ('act' in e) this.startAct(e.act);
    else if ('schedule' in e) this.schedule(e.schedule, e.in);
    else if ('cancel' in e) this.cancel(e.cancel);
    else if ('if' in e) this.run(this.test(e.if) ? e.then : e.else);
    else if ('look' in e) this.describeRoom(true);
    else if ('converse' in e) this.openConversation(e.converse, e.node ?? null, false);
    else if ('script' in e) {
      const fn = this.world.scripts.effects.get(e.script);
      if (!fn) throw new Error(`No script effect "${e.script}"`);
      fn(this.scriptContext(this.ctx(), e.args));
    } else throw new Error(`Unknown effect ${JSON.stringify(e)}`);
  }

  award(id: string): void {
    if (this.state.awarded.includes(id)) return;
    const s = this.world.scores.get(id);
    if (!s) throw new Error(`No score item "${id}"`);
    this.state.awarded.push(id);
    this.state.score += s.points;
    if (s.points > 0) this.msg('scoreUp', { n: s.points });
    else if (s.points < 0) this.msg('scoreDown', { n: -s.points });
  }

  end(id: string): void {
    const e = this.world.endings.get(id);
    if (!e) throw new Error(`No ending "${id}"`);
    this.state.ended = { ending: id, win: !!e.win };
    this.msg('endingTitle', { title: e.title }, 'heading');
    this.say(e.text);
    if (this.world.maxScore > 0) this.msg('finalScore');
    this.msg('gameOver');
  }

  startAct(id: string): void {
    const act = this.world.acts.find((a) => a.id === id);
    if (!act) throw new Error(`No act "${id}"`);
    this.state.act = id;
    if (act.title) this.print(act.title, 'heading');
    this.say(act.intro);
    this.run(act.do);
  }

  schedule(id: string, turns: number): void {
    this.cancel(id);
    this.state.events.push({ id, at: this.state.turns + Math.max(1, Math.trunc(turns)) });
  }

  cancel(id: string): void {
    this.state.events = this.state.events.filter((e) => e.id !== id);
  }

  // -------------------------------------------------------------------------
  // Rules

  /** Run before- or after-rules. Returns true if a rule stopped the action. */
  runRules(phase: 'before' | 'after', c: ActionCtx): boolean {
    if (c.action === null) return false;
    const pseudo = (PSEUDO_ACTIONS as readonly string[]).includes(c.action);
    for (const rule of this.world.rules) {
      if (!rule.actions.includes(c.action)) continue;
      if (!pseudo && rule.when !== phase) continue;
      if (!this.ruleMatches(rule, c)) continue;
      if (rule.if && !this.test(rule.if)) continue;
      if (rule.once) this.state.fired.push(rule.id);
      this.say(rule.say);
      this.run(rule.do);
      if (this.state.ended || this.quitRequested) return true;
      if (!pseudo && !rule.continue) return true;
    }
    return false;
  }

  private ruleMatches(rule: Rule, c: ActionCtx): boolean {
    if (rule.once && this.state.fired.includes(rule.id)) return false;
    if (rule.object !== undefined && !this.matchThing(rule.object, c.noun)) return false;
    if (rule.with !== undefined && !this.matchThing(rule.with, c.second)) return false;
    if (rule.dir !== undefined) {
      const dirs = asList(rule.dir).map((d) => this.world.directionWords.get(d) ?? d);
      if (!c.dir || !dirs.includes(c.dir)) return false;
    }
    if (rule.topic !== undefined && !matchTopic(asList(rule.topic), c.topic)) return false;
    if (rule.in !== undefined) {
      const here = this.state.location;
      const region = this.world.rooms.get(here)?.region ?? null;
      if (!asList(rule.in).some((x) => x === here || x === region)) return false;
    }
    return true;
  }

  private matchThing(m: Matcher, id: string | null): boolean {
    if (id === null) return false;
    const t = this.world.things.get(id);
    return asList(m).some((x) => x === '*' || x === id || (x.startsWith('#') && !!t && t.tags.includes(x.slice(1))));
  }

  /** Run a pseudo-action's rules: every matching rule runs. */
  private hook(action: 'start' | 'arrive' | 'everyTurn'): void {
    const c: ActionCtx = { action, noun: null, second: null, topic: null, dir: null };
    this.ctxStack.push(c);
    try {
      this.runRules('before', c);
    } finally {
      this.ctxStack.pop();
    }
  }

  // -------------------------------------------------------------------------
  // Actions

  /** Run one action through before-rules, its handler and after-rules. */
  perform(c: ActionCtx): boolean {
    this.ctxStack.push(c);
    try {
      if (this.runRules('before', c)) return false;
      if (this.state.ended) return false;
      let ok: boolean;
      const handler = c.action ? ACTIONS[c.action] : undefined;
      const script = c.action ? this.world.scripts.actions.get(c.action) : undefined;
      if (handler) ok = handler(this, c);
      else if (script) ok = script(this.scriptContext(c, undefined)) !== false;
      else {
        const verb = c.action ? this.world.verbs.get(c.action) : undefined;
        if (verb?.default) this.say(verb.default);
        else this.msg('nothingHappens');
        ok = false;
      }
      if (ok && !this.state.ended && !this.quitRequested) this.runRules('after', c);
      return ok;
    } finally {
      this.ctxStack.pop();
    }
  }

  /** "(first taking the X)": take something before using it. */
  implicitTake(id: string): boolean {
    if (this.isDirectlyHeld(id)) return true;
    this.msg('firstTaking', { noun: id });
    this.perform({ action: 'take', noun: id, second: null, topic: null, dir: null });
    return this.isDirectlyHeld(id);
  }

  // -------------------------------------------------------------------------
  // Movement and description

  /** Put the player in a room, describe it and run arrival rules. */
  movePlayer(room: string, walking: boolean): void {
    const from = this.state.location;
    this.state.location = room;
    if (walking) {
      for (const t of this.world.things.values()) {
        if (t.kind === 'character' && this.state.parent[t.id] === from && this.flag(t.id, 'following')) {
          this.state.parent[t.id] = room;
        }
      }
    }
    this.describeRoom(false);
    this.hook('arrive');
  }

  describeRoom(full: boolean): void {
    const room = this.world.rooms.get(this.state.location)!;
    if (!this.isLit()) {
      this.msg('darkTitle', {}, 'title');
      this.msg('dark');
      return;
    }
    this.print(room.name, 'title');
    const visited = this.flag(room.id, 'visited');
    if (full || this.state.verbose || !visited) this.say(room.description);
    if (!visited) this.say(room.firstVisit);
    this.setProp(room.id, 'visited', true);
    this.listRoomContents(room.id);
  }

  private listRoomContents(roomId: string): void {
    const plain: string[] = [];
    const characters: Thing[] = [];
    for (const t of this.children(roomId)) {
      if (t.kind === 'character') {
        characters.push(t);
        continue;
      }
      if (t.scenery) continue;
      if (t.initial && !this.flag(t.id, 'moved')) this.sayAbout(t.id, t.initial);
      else plain.push(t.id);
    }
    for (const t of this.world.things.values()) {
      if (t.foundIn.includes(roomId) && t.initial) this.sayAbout(t.id, t.initial);
    }
    if (plain.length > 0) this.msg('youSee', { list: this.listOf(plain) });
    this.listNested(roomId);
    for (const c of characters) {
      if (c.initial) this.sayAbout(c.id, c.initial);
      else this.msg('characterHere', { noun: c.id });
    }
  }

  /** "On the X you can see a Y." for everything visible in a room. */
  private listNested(holder: string): void {
    const holders = this.children(holder);
    if (this.world.rooms.has(holder)) {
      for (const t of this.world.things.values()) if (t.foundIn.includes(holder) && !holders.includes(t)) holders.push(t);
    }
    for (const t of holders) {
      if (t.kind === 'character' || !(t.container || t.surface) || !this.canSeeInto(t)) continue;
      const plain: string[] = [];
      for (const inner of this.children(t.id)) {
        if (inner.scenery) continue;
        if (inner.initial && !this.flag(inner.id, 'moved')) this.sayAbout(inner.id, inner.initial);
        else plain.push(inner.id);
      }
      if (plain.length > 0) this.msg(t.surface ? 'onSurface' : 'inContainer', { noun: t.id, list: this.listOf(plain) });
      this.listNested(t.id);
    }
  }

  /** Print a thing's own text with {the:noun} meaning that thing. */
  sayAbout(id: string, def: TextDef): void {
    this.ctxStack.push({ action: null, noun: id, second: null, topic: null, dir: null });
    try {
      this.say(def);
    } finally {
      this.ctxStack.pop();
    }
  }

  inventoryLines(holder: string, depth: number): string[] {
    const lines: string[] = [];
    for (const t of this.children(holder)) {
      let line = `${'  '.repeat(depth)}${this.aName(t.id)}`;
      if (this.flag(t.id, 'worn')) line += ` ${this.messageText('beingWorn')}`;
      if (this.givesLight(t)) line += ` ${this.messageText('providingLight')}`;
      lines.push(line.trimEnd());
      if ((t.container || t.surface) && this.canSeeInto(t)) lines.push(...this.inventoryLines(t.id, depth + 1));
    }
    return lines;
  }

  // -------------------------------------------------------------------------
  // The turn loop

  private begin(): void {
    this.say(this.world.manifest.intro);
    if (this.world.acts.length > 0) this.startAct(this.world.acts[0].id);
    if (this.state.ended) return;
    this.hook('start');
    if (this.state.ended) return;
    this.describeRoom(false);
    this.hook('arrive');
  }

  /** Returns true if the rest of the input line should be dropped. */
  private handleTokens(tokens: string[]): boolean {
    const fresh = () => parse(this.parserEnv(), this.grammar, tokens, this.known);
    if (this.state.conversation && !this.pending) return this.handleConversationInput(tokens, fresh);
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      const r = answer(this.parserEnv(), p, tokens, this.known);
      if (r && r.kind !== 'error') return this.handleOutcome(r);
      // Not a usable answer: treat it as a new command, unless it isn't one
      // either, in which case the answer's own problem is the better message.
      const f = fresh();
      if (r && f.kind === 'error' && f.key === 'notUnderstood') return this.handleOutcome(r);
      return this.handleOutcome(f);
    }
    return this.handleOutcome(fresh());
  }

  private handleOutcome(o: ParseOutcome): boolean {
    if (o.kind === 'error') {
      this.msg(o.key, o.params, 'parser');
      return true;
    }
    if (o.kind === 'question') {
      this.pending = o.pending;
      this.msg(o.key, o.params, 'parser');
      return true;
    }
    this.execute(o.command);
    return this.state.ended !== null;
  }

  private execute(cmd: ParsedCommand): void {
    if (cmd.action === 'again') {
      if (!this.last) return this.msg('noAgain', {}, 'parser');
      const again = this.last;
      const missing = [...again.nouns, ...(again.second ? [again.second] : [])].find((id) => !this.inScope(id));
      if (missing) return this.msg('pronounGone', { noun: missing }, 'parser');
      return this.execute(again);
    }
    const verb = this.world.verbs.get(cmd.action)!;
    if (this.state.ended && !ALLOWED_AFTER_END.includes(cmd.action)) return this.msg('gameOver');
    if (cmd.action === 'answer' && cmd.nouns.length === 0) {
      const who = this.answerTarget();
      if (!who) {
        const anyone = this.scope().some((t) => t.kind === 'character');
        return this.msg(anyone ? 'answerWho' : 'nobodyToAnswer', {}, 'parser');
      }
      cmd = { ...cmd, nouns: [who] };
    }
    this.last = cmd;
    if (verb.meta) {
      this.meta(cmd);
      return;
    }
    this.pushUndo();
    this.state.turns += 1;
    const wasLit = this.isLit();
    const wasAt = this.state.location;
    for (const note of cmd.notes) this.msg(note.key, note.params);
    const nouns: Array<string | null> = cmd.nouns.length > 0 ? cmd.nouns : [null];
    const multi = cmd.all || cmd.nouns.length > 1;
    for (const noun of nouns) {
      const before = this.out.length;
      this.perform({ action: cmd.action, noun, second: cmd.second, topic: cmd.topic, dir: cmd.dir });
      if (multi && noun && this.out.length > before) {
        this.out[before] = { ...this.out[before], text: `${this.thing(noun).name}: ${this.out[before].text}` };
      }
      if (this.state.ended || this.quitRequested) break;
    }
    // "it"/"them" mean the last thing named, "him"/"her" the last person
    // (not the results of "all").
    if (!cmd.all) for (const noun of cmd.nouns) this.setPronoun(noun);
    if (cmd.second && this.world.things.get(cmd.second)?.kind === 'character') this.setPronoun(cmd.second);
    if (!this.state.ended && !this.quitRequested) this.endTurn(wasLit, wasAt);
  }

  private setPronoun(id: string): void {
    const t = this.world.things.get(id);
    if (!t) return;
    if (t.pronoun === 'him') this.state.him = id;
    else if (t.pronoun === 'her') this.state.her = id;
    else this.state.it = id;
  }

  private endTurn(wasLit: boolean, wasAt: string): void {
    // Timed events that are due.
    const due = this.state.events.filter((e) => e.at <= this.state.turns).sort((a, b) => a.at - b.at);
    this.state.events = this.state.events.filter((e) => e.at > this.state.turns);
    for (const e of due) {
      const def = this.world.events.get(e.id);
      if (!def) continue;
      this.ctxStack.push({ action: null, noun: null, second: null, topic: null, dir: null });
      try {
        if (!def.if || this.test(def.if)) {
          this.say(def.say);
          this.run(def.do);
        }
      } finally {
        this.ctxStack.pop();
      }
      if (this.state.ended) return;
    }
    // Background processes.
    this.hook('everyTurn');
    if (this.state.ended) return;
    this.wander();
    // Light coming or going where the player stands.
    if (this.state.location === wasAt) {
      const lit = this.isLit();
      if (lit && !wasLit) this.describeRoom(true);
      else if (!lit && wasLit) this.msg('nowDark');
    }
  }

  private wander(): void {
    for (const t of this.world.things.values()) {
      if (t.kind !== 'character' || !t.wander || this.flag(t.id, 'following')) continue;
      const from = this.state.parent[t.id];
      if (!from || !this.world.rooms.has(from)) continue;
      if (this.random() >= t.wander.chance) continue;
      const options: string[] = [];
      for (const exit of this.world.rooms.get(from)!.exits.values()) {
        if (!exit.to || !t.wander.rooms.includes(exit.to)) continue;
        if (exit.door && !this.flag(exit.door, 'open')) continue;
        if (!options.includes(exit.to)) options.push(exit.to);
      }
      if (options.length === 0) continue;
      const to = options[this.randomInt(options.length)];
      const seen = this.isLit();
      if (from === this.state.location && seen) {
        if (t.depart) this.sayAbout(t.id, t.depart);
        else this.msg('characterDeparts', { noun: t.id });
      }
      this.state.parent[t.id] = to;
      if (to === this.state.location && this.isLit()) {
        if (t.arrive) this.sayAbout(t.id, t.arrive);
        else this.msg('characterArrives', { noun: t.id });
      }
    }
  }

  private pushUndo(): void {
    this.undoStack.push(JSON.stringify(this.state));
    if (this.undoStack.length > this.undoDepth) this.undoStack.shift();
  }

  // -------------------------------------------------------------------------
  // Meta commands

  private meta(cmd: ParsedCommand): void {
    switch (cmd.action) {
      case 'score':
        if (this.world.maxScore > 0) this.msg('scoreReport');
        else this.msg('noScore');
        return;
      case 'save': {
        const slot = cmd.topic ?? 'default';
        const ok = this.host.save ? this.host.save(slot, this.saveState()) : false;
        this.msg(ok ? 'saved' : 'saveFailed');
        return;
      }
      case 'restore': {
        const slot = cmd.topic ?? 'default';
        const data = this.host.load ? this.host.load(slot) : null;
        if (data === null) return this.msg('restoreFailed', { reason: 'no saved game' });
        try {
          this.restoreState(data);
        } catch (e) {
          return this.msg('restoreFailed', { reason: (e as Error).message });
        }
        this.msg('restored');
        this.describeRoom(true);
        return;
      }
      case 'restart':
        this.state = initialState(this.world, this.state.seed);
        this.undoStack = [];
        this.pending = null;
        this.last = null;
        this.msg('restarting');
        this.begin();
        return;
      case 'quit':
        this.quitRequested = true;
        this.msg('goodbye');
        return;
      case 'undo': {
        const prev = this.undoStack.pop();
        if (!prev) return this.msg('cantUndo');
        this.state = JSON.parse(prev) as GameState;
        this.msg('undone');
        this.menuDue = this.state.conversation !== null;
        return;
      }
      case 'help':
        this.msg('help');
        return;
      case 'about':
        this.about();
        return;
      case 'verbose':
        this.state.verbose = true;
        this.msg('verboseOn');
        return;
      case 'brief':
        this.state.verbose = false;
        this.msg('briefOn');
        return;
    }
    // A pack's own meta verb: rules and handlers run, but no time passes.
    this.perform({ action: cmd.action, noun: cmd.nouns[0] ?? null, second: cmd.second, topic: cmd.topic, dir: cmd.dir });
  }

  private about(): void {
    const m = this.world.manifest;
    this.print(`${m.title} (version ${m.version})`, 'heading');
    if (m.description) this.print(m.description);
    this.print(m.source ? `Adapted by ${m.author}.` : `By ${m.author}.`);
    if (m.source) {
      const s = m.source;
      let line = `Based on ${s.title}`;
      if (s.author) line += ` by ${s.author}`;
      if (s.year !== undefined) line += ` (${s.year})`;
      line += '.';
      if (s.licence) line += ` Source licence: ${s.licence}.`;
      if (s.url) line += ` ${s.url}`;
      this.print(line);
      if (s.note) this.print(s.note);
    }
    this.print(`Licence: ${m.licence}.`);
    for (const c of m.credits ?? []) this.print(c);
  }

  // -------------------------------------------------------------------------
  // Conversation menus

  /**
   * Open a character's dialogue: at a given node, or where an interrupted
   * conversation left off (for "talk to"), or at its entry node. Returns
   * false if the character has no dialogue, is not here, or has no entry
   * node that applies.
   */
  openConversation(who: string, node: string | null, resumable: boolean): boolean {
    const d = this.world.dialogues.get(who);
    if (!d || !isPresent(this.world, this.state, who)) return false;
    if (this.state.conversation?.with === who && !node) {
      this.menuDue = true;
      return true;
    }
    const paused = this.state.paused[who];
    let target = node;
    let resumed = false;
    if (!target && resumable && d.resume !== false && paused && d.nodes[paused]) {
      target = paused;
      resumed = true;
    }
    target ??= this.entryNode(d);
    if (!target) return false;
    this.closeConversation(true);
    delete this.state.paused[who];
    this.state.conversation = { with: who, node: target, shown: [] };
    this.state.lastSpeaker = who;
    this.setPronoun(who);
    if (resumed) {
      if (d.resumeText) this.sayAbout(who, d.resumeText);
      else this.msg('resumeConversation', { noun: who });
    } else this.enterNode(who, target);
    this.menuDue = this.state.conversation !== null;
    return true;
  }

  private entryNode(d: DialogueDef): string | null {
    for (const e of d.entry ?? []) if (!e.if || this.test(e.if)) return e.node;
    return d.nodes.start ? 'start' : null;
  }

  /** Who a bare answer is for: the last to speak, or the only person here. */
  private answerTarget(): string | null {
    const last = this.state.lastSpeaker;
    if (last && isPresent(this.world, this.state, last)) return last;
    const people = this.scope().filter((t) => t.kind === 'character');
    return people.length === 1 ? people[0].id : null;
  }

  private enterNode(who: string, node: string): void {
    const n = this.world.dialogues.get(who)!.nodes[node];
    if (!n) return;
    if (n.say) this.sayAbout(who, n.say);
    this.ctxStack.push({ action: null, noun: who, second: null, topic: null, dir: null });
    try {
      this.run(n.do);
    } finally {
      this.ctxStack.pop();
    }
  }

  /** Close the open conversation; if interrupted, remember where it was. */
  private closeConversation(interrupted: boolean): void {
    const c = this.state.conversation;
    if (!c) return;
    if (interrupted) this.state.paused[c.with] = c.node;
    else delete this.state.paused[c.with];
    this.state.conversation = null;
    this.menuDue = false;
  }

  /** The options of the open node: numbered ones in order, and locked ones. */
  private visibleOptions(): Array<{ option: DialogueOptionDef; number: number | null }> {
    const c = this.state.conversation!;
    const node = this.world.dialogues.get(c.with)?.nodes[c.node];
    const out: Array<{ option: DialogueOptionDef; number: number | null }> = [];
    let n = 0;
    this.ctxStack.push({ action: null, noun: c.with, second: null, topic: null, dir: null });
    try {
      for (const option of node?.options ?? []) {
        if (option.once && this.state.said.includes(`${c.with}.${option.id}`)) continue;
        if (!option.if || this.test(option.if)) out.push({ option, number: ++n });
        else if (option.locked) out.push({ option, number: null });
      }
    } finally {
      this.ctxStack.pop();
    }
    return out;
  }

  private flushMenu(): void {
    if (this.menuDue) this.printMenu();
  }

  private printMenu(): void {
    this.menuDue = false;
    const c = this.state.conversation;
    if (!c) return;
    if (this.state.ended || this.quitRequested || !isPresent(this.world, this.state, c.with)) {
      this.closeConversation(!this.state.ended);
      return;
    }
    const node = this.world.dialogues.get(c.with)?.nodes[c.node];
    const options = this.visibleOptions();
    c.shown = options.filter((o) => o.number !== null).map((o) => o.option.id);
    if (c.shown.length === 0 && node?.noLeave) {
      // Nothing to choose and no way out: never trap the player.
      this.closeConversation(false);
      return;
    }
    this.ctxStack.push({ action: null, noun: c.with, second: null, topic: null, dir: null });
    try {
      for (const { option, number } of options) {
        const label = this.render(option.text);
        if (number === null) {
          this.out.push({ style: 'option', option: null, text: `     ${label} ${this.render(option.locked)}`.trimEnd() });
        } else this.out.push({ style: 'option', option: number, text: `  ${number}. ${label}` });
      }
      if (!node?.noLeave) this.out.push({ style: 'option', option: 0, text: `  0. ${this.messageText('leaveConversation')}` });
    } finally {
      this.ctxStack.pop();
    }
  }

  /** The number an option is shown under right now, or null. For walkthroughs and tests. */
  optionNumber(key: string): number | null {
    const c = this.state.conversation;
    const dot = key.indexOf('.');
    if (!c || key.slice(0, dot) !== c.with) return null;
    const i = c.shown.indexOf(key.slice(dot + 1));
    return i < 0 ? null : i + 1;
  }

  /** Input while a menu is open. Returns true if the rest of the line should be dropped. */
  private handleConversationInput(tokens: string[], fresh: () => ParseOutcome): boolean {
    const c = this.state.conversation!;
    const d = this.world.dialogues.get(c.with)!;
    const noLeave = !!d.nodes[c.node]?.noLeave;
    const words = tokens.filter((t) => t !== ',');
    if (words.length === 1 && /^\d+$/.test(words[0])) {
      const n = Number(words[0]);
      if (n === 0 && !noLeave) return this.leaveConversation();
      const id = n > 0 ? c.shown[n - 1] : undefined;
      if (!id) {
        this.msg('notAnOption', { n }, 'parser');
        return true;
      }
      this.choose(id);
      return this.state.ended !== null;
    }
    if (words.length === 1 && LEAVE_WORDS.includes(words[0])) {
      if (!noLeave) return this.leaveConversation();
      this.msg('chooseOption', {}, 'parser');
      return true;
    }
    const byKey = this.optionByKeys(words.join(' '));
    if (byKey) {
      this.choose(byKey);
      return this.state.ended !== null;
    }
    const o = fresh();
    if (o.kind === 'ok') {
      const cmd = o.command;
      // Saying or answering something to the person you're talking to.
      if ((cmd.action === 'answer' || cmd.action === 'say') && (cmd.nouns.length === 0 || cmd.nouns[0] === c.with)) {
        const id = cmd.topic ? this.optionByKeys(cmd.topic) : null;
        if (id) {
          this.choose(id);
          return this.state.ended !== null;
        }
        this.msg('chooseOption', {}, 'parser');
        return true;
      }
      // Meta commands leave the menu open ("again" repeats a normal command).
      if (this.world.verbs.get(cmd.action)?.meta && cmd.action !== 'again') {
        const r = this.handleOutcome(o);
        if (this.state.conversation) this.menuDue = true;
        return r;
      }
      if (cmd.action === 'talk' && cmd.nouns[0] === c.with) {
        this.menuDue = true;
        return true;
      }
      if (noLeave) {
        this.msg('chooseOption', {}, 'parser');
        return true;
      }
      this.closeConversation(true);
      return this.handleOutcome(o);
    }
    if (o.kind === 'question' && !noLeave) {
      this.closeConversation(true);
      return this.handleOutcome(o);
    }
    // A typing mistake keeps the menu open.
    return this.handleOutcome(o.kind === 'question' ? { kind: 'error', key: 'chooseOption', params: {} } : o);
  }

  private optionByKeys(typed: string): string | null {
    const c = this.state.conversation!;
    const node = this.world.dialogues.get(c.with)?.nodes[c.node];
    const wanted = normaliseWords(typed).filter((w) => !['a', 'an', 'the'].includes(w)).join(' ');
    for (const id of c.shown) {
      const option = node?.options?.find((o) => o.id === id);
      for (const k of option?.keys ?? []) {
        if (normaliseWords(k).filter((w) => !['a', 'an', 'the'].includes(w)).join(' ') === wanted) return id;
      }
    }
    return null;
  }

  private leaveConversation(): boolean {
    const c = this.state.conversation!;
    const d = this.world.dialogues.get(c.with)!;
    if (d.leave) this.sayAbout(c.with, d.leave);
    this.closeConversation(false);
    return true;
  }

  /** Choose an option: one game turn. */
  private choose(id: string): void {
    const c = this.state.conversation!;
    const who = c.with;
    const node = this.world.dialogues.get(who)!.nodes[c.node];
    const option = node.options!.find((o) => o.id === id)!;
    this.pushUndo();
    this.state.turns += 1;
    const wasLit = this.isLit();
    const wasAt = this.state.location;
    this.ctxStack.push({ action: null, noun: who, second: null, topic: null, dir: null });
    try {
      this.say(option.line ?? option.text);
      this.say(option.reply);
      const key = `${who}.${id}`;
      if (!this.state.said.includes(key)) this.state.said.push(key);
      this.state.lastSpeaker = who;
      this.run(option.do);
    } finally {
      this.ctxStack.pop();
    }
    if (this.state.ended || this.quitRequested) {
      this.closeConversation(false);
      return;
    }
    const still = this.state.conversation;
    if (still === c) {
      if (option.then === 'end') this.closeConversation(false);
      else if (option.then) {
        still.node = option.then;
        this.enterNode(who, option.then);
      }
    }
    this.menuDue = this.state.conversation !== null;
    if (!this.state.ended) this.endTurn(wasLit, wasAt);
  }

  // -------------------------------------------------------------------------
  // Parser and script plumbing

  private parserEnv(): ParserEnv {
    return {
      world: this.world,
      scope: () => this.scope(),
      isHeld: (id) => this.isHeld(id),
      isDirectlyHeld: (id) => this.isDirectlyHeld(id),
      isWorn: (id) => this.flag(id, 'worn'),
      pronoun: (word) => (word === 'him' ? this.state.him : word === 'her' ? this.state.her : this.state.it),
      allFor: (action, second) => this.allFor(action, second),
      implicitSecond: (_action, noun) => {
        const t = this.world.things.get(noun);
        return t?.keys.find((k) => this.isHeld(k)) ?? null;
      },
      keyNeeded: (action, noun) => {
        const t = this.world.things.get(noun);
        if (!t || !t.lockable || t.keys.length === 0) return false;
        const locked = this.flag(noun, 'locked');
        return action === 'unlock' ? locked : !locked && !(t.openable && this.flag(noun, 'open'));
      },
      theName: (id) => this.theName(id),
    };
  }

  private allFor(action: string, second: string | null): string[] {
    const visible = this.scope();
    const portable = (t: Thing) => t.kind === 'object' && !t.fixed && !t.scenery;
    switch (action) {
      case 'take':
        if (second) return visible.filter((t) => this.state.parent[t.id] === second && portable(t)).map((t) => t.id);
        return visible.filter((t) => this.state.parent[t.id] === this.state.location && portable(t)).map((t) => t.id);
      case 'drop':
      case 'putIn':
      case 'putOn':
        return this.children(PLAYER)
          .filter((t) => !this.flag(t.id, 'worn') && t.id !== second)
          .map((t) => t.id);
      default:
        return visible.filter((t) => !t.scenery && t.kind === 'object').map((t) => t.id);
    }
  }

  scriptContext(c: ActionCtx, args: unknown): ScriptContext {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const g = this;
    return {
      action: c.action,
      noun: c.noun,
      second: c.second,
      topic: c.topic,
      dir: c.dir,
      args,
      get turns() {
        return g.state.turns;
      },
      get score() {
        return g.state.score;
      },
      say: (text) => g.say(text),
      passage: (key) => g.world.texts.get(key) ?? '',
      get: (ref) => g.get(ref),
      set: (ref, value) => g.set(ref, value),
      locationOf: (id) => g.state.parent[id] ?? null,
      move: (id, to) => g.moveThing(id, to === 'nowhere' ? null : to === 'here' ? g.state.location : to),
      movePlayer: (room) => g.movePlayer(room, false),
      room: () => g.state.location,
      exits: (room) => {
        const out: Record<string, string> = {};
        for (const e of g.world.rooms.get(room)?.exits.values() ?? []) if (e.to) out[e.dir] = e.to;
        return out;
      },
      contents: (id) => g.children(id).map((t) => t.id),
      isHeld: (id) => g.isHeld(id),
      isVisible: (id) => g.inScope(id),
      isLit: () => g.isLit(),
      name: (id) => g.world.things.get(id)?.name ?? g.world.rooms.get(id)?.name ?? id,
      the: (id) => g.theName(id),
      a: (id) => g.aName(id),
      random: () => g.random(),
      randomInt: (n) => g.randomInt(n),
      test: (cond) => g.test(cond),
      run: (effects) => g.run(effects),
      award: (id) => g.award(id),
      end: (id) => g.end(id),
      schedule: (id, n) => g.schedule(id, n),
      cancel: (id) => g.cancel(id),
    };
  }

  /** For tests and tools: everything the player could see if lit. */
  potentialScope(): Thing[] {
    return potentialScope(this.world, this.state);
  }

  inventory(): Thing[] {
    return inventoryTree(this.world, this.state);
  }
}

function asList(m: Matcher): string[] {
  return Array.isArray(m) ? m : [m];
}
