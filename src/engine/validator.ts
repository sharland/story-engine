// The pack validator: everything compilePack checks (shape, references),
// plus whole-pack analyses: unreachable rooms, objects that can never be
// obtained, vocabulary clashes, unused content, and playing the walkthroughs.

import { compilePack, type CompileResult } from './pack.ts';
import { compilePattern, matchPattern, type Pattern } from './parser.ts';
import type { Issue, PackSource, World } from './types.ts';
import { playWalkthrough, type WalkthroughResult } from './walkthrough.ts';

export interface ValidationReport {
  issues: Issue[];
  errors: number;
  warnings: number;
  walkthroughs: WalkthroughResult[];
  world: World | null;
}

export interface ValidateOptions {
  /** Play the pack's walkthroughs (default true). */
  play?: boolean;
}

export function validate(src: PackSource, options: ValidateOptions = {}): ValidationReport {
  const compiled = compilePack(src);
  const issues = [...compiled.issues];
  const walkthroughs: WalkthroughResult[] = [];
  const world = compiled.world;
  const hasErrors = () => issues.some((i) => i.level === 'error');

  if (world) {
    // Static analyses run even when there are errors, so every problem is
    // reported at once. They must tolerate dangling references.
    try {
      const reachable = reachableRooms(world, compiled, issues);
      unobtainable(world, compiled, reachable, issues);
      vocabularyClashes(world, issues);
      unused(world, compiled, issues);
    } catch (e) {
      if (!hasErrors()) throw e;
    }
    if (src.walkthroughs.length === 0) {
      issues.push({
        level: 'warning',
        code: 'no-walkthrough',
        message: 'The pack has no walkthroughs/*.txt, so nothing proves it can be finished',
      });
    }
    if (options.play !== false && !hasErrors()) {
      for (const w of src.walkthroughs) {
        const first = playWalkthrough(world, w.content, w.file);
        walkthroughs.push(first);
        for (const p of first.problems) issues.push({ level: 'error', code: 'walkthrough', message: p, where: w.file });
        const second = playWalkthrough(world, w.content, w.file);
        if (second.transcript !== first.transcript) {
          issues.push({
            level: 'error',
            code: 'nondeterministic',
            message:
              'Playing the same walkthrough twice gave different output. A script is probably using Math.random, ' +
              'the clock, or module-level variables instead of ctx.random() and ctx.set()',
            where: w.file,
          });
        }
      }
    }
  }
  return {
    issues,
    errors: issues.filter((i) => i.level === 'error').length,
    warnings: issues.filter((i) => i.level === 'warning').length,
    walkthroughs,
    world,
  };
}

function reachableRooms(w: World, c: CompileResult, issues: Issue[]): Set<string> {
  const seen = new Set<string>([w.manifest.start]);
  for (const id of w.validator.assumeReachable) if (w.rooms.has(id)) seen.add(id);
  for (const m of c.playerMoves) seen.add(m.room);
  const queue = [...seen];
  while (queue.length > 0) {
    const room = w.rooms.get(queue.shift()!);
    if (!room) continue;
    for (const exit of room.exits.values()) {
      if (exit.to && !seen.has(exit.to)) {
        seen.add(exit.to);
        queue.push(exit.to);
      }
    }
  }
  for (const id of w.rooms.keys()) {
    if (!seen.has(id)) {
      issues.push({
        level: 'error',
        code: 'unreachable-room',
        message: `Room "${id}" can't be reached from the start room by any exit or movePlayer effect`,
        where: c.definedIn.get(id),
      });
    }
  }
  return seen;
}

function unobtainable(w: World, c: CompileResult, reachable: Set<string>, issues: Issue[]): void {
  // A place is open to the player if it is a reachable room, the player, or
  // a container or surface that is itself open to the player.
  const obtainable = new Set<string>();
  const openPlace = (place: string | null): boolean => {
    if (place === null) return false;
    if (place === 'player' || place === 'here') return true;
    if (w.rooms.has(place)) return reachable.has(place);
    const t = w.things.get(place);
    if (!t || t.kind === 'character') return false;
    if (t.fixed) return t.location !== null ? openPlace(t.location) : t.foundIn.some((r) => reachable.has(r));
    return obtainable.has(place);
  };
  const portable = [...w.things.values()].filter((t) => t.kind === 'object' && !t.fixed);
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of portable) {
      if (obtainable.has(t.id)) continue;
      const ok =
        w.validator.assumeObtainable.includes(t.id) ||
        openPlace(t.location) ||
        c.moves.some((m) => m.thing === t.id && openPlace(m.to));
      if (ok) {
        obtainable.add(t.id);
        changed = true;
      }
    }
  }
  for (const t of portable) {
    if (!obtainable.has(t.id)) {
      issues.push({
        level: 'error',
        code: 'unobtainable',
        message:
          `Object "${t.id}" can never be obtained: it starts ${t.location ? `in "${t.location}"` : 'nowhere'} ` +
          'and no effect moves it anywhere the player can reach. Make it fixed or scenery if it is not meant to be taken',
        where: c.definedIn.get(t.id),
      });
    }
  }
}

function vocabularyClashes(w: World, issues: Issue[]): void {
  // Things the player can never tell apart.
  const things = [...w.things.values()];
  for (let i = 0; i < things.length; i++) {
    for (let j = i + 1; j < things.length; j++) {
      const a = things[i];
      const b = things[j];
      if (a.name === b.name) continue;
      if (a.words.size !== b.words.size || ![...a.words].every((x) => b.words.has(x))) continue;
      if (!couldMeet(w, a.id, b.id)) continue;
      issues.push({
        level: 'warning',
        code: 'vocabulary-clash',
        message: `"${a.id}" and "${b.id}" answer to exactly the same words (${[...a.words].join(', ')}); the player can't name one without the other`,
      });
    }
  }

  // Pack patterns that overlap patterns of a different verb.
  const all: Pattern[] = [];
  const isPack = new Map<Pattern, boolean>();
  for (const verb of w.verbs.values()) {
    verb.patterns.forEach((src, i) => {
      const p = compilePattern(verb.id, src, all.length);
      all.push(p);
      isPack.set(p, !verb.builtin || i >= verb.standardCount);
    });
  }
  for (const p of all) {
    if (!isPack.get(p)) continue;
    const sample = samplePhrase(p);
    for (const q of all) {
      if (q === p || q.action === p.action) continue;
      if (q.literals !== p.literals) continue;
      if (matchPattern(q, sample, w.directionWords).length > 0) {
        issues.push({
          level: 'warning',
          code: 'pattern-clash',
          message: `Pattern "${p.source}" (${p.action}) also matches "${q.source}" (${q.action}); "${sample.join(' ')}" will go to ${p.action}`,
        });
      }
    }
  }
}

/** A concrete input for a pattern: first word of each alternative, a placeholder per slot. */
function samplePhrase(p: Pattern): string[] {
  return p.tokens.map((t) => (t.kind === 'word' ? t.words[0] : t.slot === 'DIR' ? 'north' : 'thing'));
}

function couldMeet(w: World, a: string, b: string): boolean {
  const ta = w.things.get(a)!;
  const tb = w.things.get(b)!;
  const portable = (t: typeof ta) => t.kind === 'object' && !t.fixed;
  if (portable(ta) || portable(tb)) return true;
  if (ta.kind === 'character' || tb.kind === 'character') return true;
  const places = (t: typeof ta) => new Set([...(t.location ? [t.location] : []), ...t.foundIn]);
  const pa = places(ta);
  return [...places(tb)].some((p) => pa.has(p));
}

function unused(w: World, c: CompileResult, issues: Issue[]): void {
  for (const key of w.texts.keys()) {
    if (!c.passagesUsed.has(key)) {
      issues.push({ level: 'warning', code: 'unused-passage', message: `Passage "${key}" is never used` });
    }
  }
  const targeted = (kind: string, id: string) => c.targets.some((t) => t.kind === kind && t.id === id);
  const scripted = w.scripts.effects.size > 0 || w.scripts.actions.size > 0;
  const maybe = scripted ? ' (unless a script does it)' : '';
  for (const id of w.endings.keys()) {
    if (!targeted('end', id)) {
      issues.push({ level: 'warning', code: 'unused-ending', message: `No effect ends the game with "${id}"${maybe}` });
    }
  }
  for (const id of w.scores.keys()) {
    if (!targeted('award', id)) {
      issues.push({
        level: 'warning',
        code: 'unused-score',
        message: `Score item "${id}" is never awarded${maybe}, so the maximum score can't be reached`,
      });
    }
  }
  for (const id of w.events.keys()) {
    if (!targeted('schedule', id)) {
      issues.push({ level: 'warning', code: 'unused-event', message: `Event "${id}" is never scheduled${maybe}` });
    }
  }
  w.acts.slice(1).forEach((a) => {
    if (!targeted('act', a.id)) {
      issues.push({ level: 'warning', code: 'unused-act', message: `No effect starts act "${a.id}"${maybe}` });
    }
  });
  if (w.endings.size > 0 && ![...w.endings.values()].some((e) => e.win)) {
    issues.push({ level: 'warning', code: 'no-win', message: 'No ending has "win": true' });
  }
}
