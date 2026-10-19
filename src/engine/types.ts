// The content pack format (what authors write) and the compiled world
// (what the engine runs). Field-by-field documentation for authors is in
// docs/WRITING-A-PACK.md; keep the two in step.

export type Value = string | number | boolean | null;

// ---------------------------------------------------------------------------
// Text

/** A text field: a literal, an "@key" passage reference, or variants. */
export type TextDef = string | TextPart[];
export type TextPart = string | { if?: Condition; text: string; else?: string };

// ---------------------------------------------------------------------------
// Conditions and effects

export type Comparison = {
  eq?: Value;
  ne?: Value;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
};

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | ({ var: string } & Comparison)
  | { has: string }
  | { wearing: string }
  | { at: string | string[] }
  | { region: string }
  | { here: string }
  | { obj: string; in: string }
  | { visited: string }
  | { act: string }
  | { actAtLeast: string }
  | { light: boolean }
  | { chance: number }
  | { said: string }
  | { script: string; args?: unknown };

export type Effect =
  | { say: TextDef }
  | { sayRandom: TextDef[] }
  | { set: string; to: Value }
  | { inc: string; by?: number }
  | { dec: string; by?: number }
  | { move: string; to: string }
  | { movePlayer: string }
  | { award: string }
  | { end: string }
  | { act: string }
  | { schedule: string; in: number }
  | { cancel: string }
  | { if: Condition; then?: Effect[]; else?: Effect[] }
  | { look: true }
  | { converse: string; node?: string }
  | { script: string; args?: unknown };

// ---------------------------------------------------------------------------
// Pack source (as authored)

export interface SourceInfo {
  title: string;
  author?: string;
  year?: string | number;
  url?: string;
  licence?: string;
  note?: string;
}

export interface Manifest {
  format: 1;
  id: string;
  title: string;
  version: string;
  author: string;
  licence: string;
  start: string;
  description?: string;
  source?: SourceInfo;
  credits?: string[];
  intro?: TextDef;
  player?: { description?: TextDef; capacity?: number };
}

export type ExitDef =
  | string
  | {
      to?: string;
      door?: string;
      if?: Condition;
      else?: TextDef;
      say?: TextDef;
      do?: Effect[];
    };

export interface RoomDef {
  name: string;
  description?: TextDef;
  firstVisit?: TextDef;
  dark?: boolean;
  region?: string;
  exits?: Record<string, ExitDef>;
  noExit?: TextDef;
  tags?: string[];
  props?: Record<string, Value>;
}

export interface ObjectDef {
  name: string;
  nouns?: string[];
  adjectives?: string[];
  article?: string;
  proper?: boolean;
  plural?: boolean;
  description?: TextDef;
  initial?: TextDef;
  read?: TextDef;
  location?: string;
  foundIn?: string[];
  fixed?: boolean | string;
  scenery?: boolean;
  container?: boolean;
  surface?: boolean;
  openable?: boolean;
  open?: boolean;
  lockable?: boolean;
  locked?: boolean;
  key?: string | string[];
  transparent?: boolean;
  capacity?: number;
  wearable?: boolean;
  worn?: boolean;
  switchable?: boolean;
  on?: boolean;
  light?: boolean;
  edible?: boolean;
  drinkable?: boolean;
  door?: boolean;
  tags?: string[];
  props?: Record<string, Value>;
}

export interface TopicDef {
  id?: string;
  keys: string[];
  if?: Condition;
  text: TextDef;
  do?: Effect[];
  once?: boolean;
}

export interface CharacterDef extends ObjectDef {
  pronoun?: 'him' | 'her' | 'them' | 'it';
  topics?: TopicDef[];
  talk?: TextDef;
  noTopic?: TextDef;
  wander?: { rooms: string[]; chance: number };
  following?: boolean;
  arrive?: TextDef;
  depart?: TextDef;
}

export interface RegionDef {
  name?: string;
  if?: Condition;
  else?: TextDef;
}

export interface ActDef {
  id: string;
  title?: string;
  intro?: TextDef;
  do?: Effect[];
}

export type Matcher = string | string[];

export interface RuleDef {
  id?: string;
  on: string | string[];
  when?: 'before' | 'after';
  object?: Matcher;
  with?: Matcher;
  dir?: Matcher;
  topic?: Matcher;
  in?: Matcher;
  if?: Condition;
  say?: TextDef;
  do?: Effect[];
  continue?: boolean;
  once?: boolean;
  priority?: number;
}

export interface EventDef {
  if?: Condition;
  say?: TextDef;
  do?: Effect[];
}

export interface EndingDef {
  title: string;
  text?: TextDef;
  win?: boolean;
}

export interface ScoreDef {
  points: number;
  note?: string;
}

export interface VerbDef {
  patterns?: string[];
  default?: TextDef;
  multi?: boolean;
  meta?: boolean;
}

export interface DirectionDef {
  words: string[];
  opposite?: string;
}

export interface DialogueOptionDef {
  id: string;
  text: TextDef;
  if?: Condition;
  locked?: TextDef;
  once?: boolean;
  keys?: string[];
  line?: TextDef;
  reply?: TextDef;
  do?: Effect[];
  then?: string;
}

export interface DialogueNodeDef {
  say?: TextDef;
  do?: Effect[];
  options?: DialogueOptionDef[];
  noLeave?: boolean;
  resumeText?: TextDef;
}

export interface DialogueDef {
  entry?: Array<{ if?: Condition; node: string }>;
  leave?: TextDef;
  resume?: boolean;
  resumeText?: TextDef;
  nodes: Record<string, DialogueNodeDef>;
}

export interface DataFile {
  rooms?: Record<string, RoomDef>;
  objects?: Record<string, ObjectDef>;
  characters?: Record<string, CharacterDef>;
  regions?: Record<string, RegionDef>;
  acts?: ActDef[];
  rules?: RuleDef[];
  events?: Record<string, EventDef>;
  endings?: Record<string, EndingDef>;
  scores?: Record<string, number | ScoreDef>;
  vars?: Record<string, Value>;
  verbs?: Record<string, VerbDef>;
  directions?: Record<string, DirectionDef>;
  messages?: Record<string, string>;
  dialogues?: Record<string, DialogueDef>;
  validator?: { assumeReachable?: string[]; assumeObtainable?: string[]; assumeUsed?: string[]; ignoreWords?: string[] };
}

/** A script module after import: its default export registers handlers. */
export interface ScriptModule {
  default: (api: import('./script-api.ts').ScriptRegistry) => void;
}

/** Everything a pack contains, independent of where it was loaded from. */
export interface PackSource {
  /** Where it came from, for messages only. */
  origin: string;
  manifest: unknown;
  data: Array<{ file: string; content: unknown }>;
  texts: Array<{ file: string; content: string }>;
  scripts: Array<{ file: string; module: ScriptModule }>;
  walkthroughs: Array<{ file: string; content: string }>;
  /** The web page's skin: theme/theme.css with its fonts and images inlined. */
  theme?: { css: string } | null;
  /** Problems met while reading files (bad JSON, scripts that fail to load). */
  issues?: Issue[];
}

// ---------------------------------------------------------------------------
// Compiled world (normalised, read-only at run time)

export type EntityKind = 'room' | 'object' | 'character';

export interface Exit {
  dir: string;
  to: string | null;
  door: string | null;
  if: Condition | null;
  else: TextDef | null;
  say: TextDef | null;
  do: Effect[];
}

export interface Room {
  kind: 'room';
  id: string;
  name: string;
  description: TextDef | null;
  firstVisit: TextDef | null;
  region: string | null;
  exits: Map<string, Exit>;
  noExit: TextDef | null;
  tags: string[];
  initialProps: Record<string, Value>;
}

export interface Thing {
  kind: 'object' | 'character';
  id: string;
  order: number;
  name: string;
  nouns: string[];
  adjectives: string[];
  /** Every word that can refer to this thing. */
  words: Set<string>;
  article: string;
  proper: boolean;
  plural: boolean;
  description: TextDef | null;
  initial: TextDef | null;
  read: TextDef | null;
  location: string | null;
  foundIn: string[];
  fixed: boolean;
  fixedMessage: string | null;
  scenery: boolean;
  container: boolean;
  surface: boolean;
  openable: boolean;
  lockable: boolean;
  keys: string[];
  transparent: boolean;
  capacity: number | null;
  wearable: boolean;
  switchable: boolean;
  light: boolean;
  edible: boolean;
  drinkable: boolean;
  door: boolean;
  tags: string[];
  initialProps: Record<string, Value>;
  // characters only
  pronoun: 'him' | 'her' | 'them' | 'it';
  topics: Array<TopicDef & { id: string }>;
  talk: TextDef | null;
  noTopic: TextDef | null;
  wander: { rooms: string[]; chance: number } | null;
  arrive: TextDef | null;
  depart: TextDef | null;
}

export interface Rule extends RuleDef {
  id: string;
  on: string | string[];
  actions: string[];
  when: 'before' | 'after';
  specificity: number;
  index: number;
}

export interface Verb {
  id: string;
  patterns: string[];
  default: TextDef | null;
  multi: boolean;
  meta: boolean;
  builtin: boolean;
  /** For standard verbs, how many of the patterns are the standard ones. */
  standardCount: number;
}

export interface Direction {
  id: string;
  words: string[];
  opposite: string | null;
}

export interface World {
  manifest: Manifest;
  rooms: Map<string, Room>;
  things: Map<string, Thing>;
  regions: Map<string, RegionDef>;
  acts: ActDef[];
  rules: Rule[];
  events: Map<string, EventDef>;
  endings: Map<string, EndingDef>;
  scores: Map<string, ScoreDef>;
  maxScore: number;
  vars: Record<string, Value>;
  verbs: Map<string, Verb>;
  directions: Map<string, Direction>;
  /** direction word -> direction id */
  directionWords: Map<string, string>;
  messages: Record<string, string>;
  /** Conversation menus, by character id. */
  dialogues: Map<string, DialogueDef>;
  texts: Map<string, string>;
  scripts: import('./script-api.ts').ScriptTable;
  validator: { assumeReachable: string[]; assumeObtainable: string[]; assumeUsed: string[]; ignoreWords: string[] };
  walkthroughs: Array<{ file: string; content: string }>;
  origin: string;
}

// ---------------------------------------------------------------------------
// Game state (plain JSON; this is what save files contain)

export interface GameState {
  format: 1;
  pack: { id: string; version: string };
  seed: number;
  rng: number;
  turns: number;
  score: number;
  awarded: string[];
  location: string;
  parent: Record<string, string | null>;
  props: Record<string, Record<string, Value>>;
  vars: Record<string, Value>;
  act: string | null;
  events: Array<{ id: string; at: number }>;
  fired: string[];
  it: string | null;
  him: string | null;
  her: string | null;
  verbose: boolean;
  ended: { ending: string; win: boolean } | null;
  /** The conversation menu open now, if any. */
  conversation: { with: string; node: string; shown: string[] } | null;
  /** Every dialogue option chosen, as "character.option". */
  said: string[];
  /** Interrupted conversations: character id -> node to resume at. */
  paused: Record<string, string>;
  /** The character who last spoke to the player, for bare "yes" and "no". */
  lastSpeaker: string | null;
}

export interface Issue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  where?: string;
}
