// The escape hatch: what a pack's script module can see and do.
//
// A script module is an ES module in the pack's scripts/ directory:
//
//   export default function (api) {
//     api.condition('name', (ctx) => true);
//     api.effect('name', (ctx) => { ctx.say('...'); });
//     api.action('verb-id', (ctx) => { ...; return true; });
//   }
//
// Rules call them with {"script": "name", "args": ...}. Scripts must keep all
// state in variables or entity properties (ctx.set), and must take every
// random number from ctx.random(), or save, undo and replay break.

import type { Condition, Effect, Value } from './types.ts';

export interface ScriptContext {
  /** The action being performed, or a pseudo-action, or null. */
  readonly action: string | null;
  /** The first object of the command, as an id. */
  readonly noun: string | null;
  /** The second object of the command, as an id. */
  readonly second: string | null;
  /** The free text of the command (after "ask X about", "say"), lower-cased. */
  readonly topic: string | null;
  /** The direction of a "go" command. */
  readonly dir: string | null;
  /** The "args" value from the rule that called the script. */
  readonly args: unknown;
  readonly turns: number;
  readonly score: number;

  /** Print text. Passage references ("@key") and templates work. */
  say(text: string): void;
  /** The text of a passage. */
  passage(key: string): string;
  /** Read a variable ("name") or entity property ("id.prop"). */
  get(ref: string): Value;
  /** Set a variable or entity property. Variables must be declared in the pack. */
  set(ref: string, value: Value): void;
  /** Where something is: a room id, a container id, "player", a character id, or null. */
  locationOf(id: string): string | null;
  /** Move an object or character: a room or thing id, "player", "here", or "nowhere" (or null) to remove it. */
  move(id: string, to: string | null): void;
  /** Move the player to a room and describe it. */
  movePlayer(room: string): void;
  /** The room the player is in. */
  room(): string;
  /** Exits of a room as direction -> destination room (ignores conditions and doors). */
  exits(room: string): Record<string, string>;
  /** Direct contents of a room, object or character, or of "player". */
  contents(id: string): string[];
  /** True if the player is carrying it, at any depth. */
  isHeld(id: string): boolean;
  /** True if the player can see it now. */
  isVisible(id: string): boolean;
  /** True if the player's location is lit. */
  isLit(): boolean;
  /** Display name, and the same with "the" or "a". */
  name(id: string): string;
  the(id: string): string;
  a(id: string): string;
  /** Seeded random number in [0, 1). The only permitted source of chance. */
  random(): number;
  /** Seeded random integer in [0, n). */
  randomInt(n: number): number;
  /** Test a declarative condition. */
  test(condition: Condition): boolean;
  /** Run declarative effects. */
  run(effects: Effect[]): void;
  award(scoreId: string): void;
  end(endingId: string): void;
  schedule(eventId: string, turns: number): void;
  cancel(eventId: string): void;
}

export type ScriptCondition = (ctx: ScriptContext) => boolean;
export type ScriptEffect = (ctx: ScriptContext) => void;
/** Return false if the action failed (after-rules then do not run). */
export type ScriptAction = (ctx: ScriptContext) => boolean | void;

export interface ScriptRegistry {
  condition(name: string, fn: ScriptCondition): void;
  effect(name: string, fn: ScriptEffect): void;
  action(verb: string, fn: ScriptAction): void;
}

export interface ScriptTable {
  conditions: Map<string, ScriptCondition>;
  effects: Map<string, ScriptEffect>;
  actions: Map<string, ScriptAction>;
  /** Which file registered each name, for messages. */
  origins: Map<string, string>;
}

export function emptyScriptTable(): ScriptTable {
  return { conditions: new Map(), effects: new Map(), actions: new Map(), origins: new Map() };
}
