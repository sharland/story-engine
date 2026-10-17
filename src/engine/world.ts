// Read-only questions about where things are, what the player can see and
// touch, and whether there is light. All answers come from the compiled
// world plus the current game state.

import type { GameState, Thing, Value, World } from './types.ts';

export const PLAYER = 'player';

export function prop(w: World, s: GameState, id: string, name: string): Value {
  const own = s.props[id];
  if (own && name in own) return own[name];
  const room = w.rooms.get(id);
  if (room) return room.initialProps[name] ?? null;
  const thing = w.things.get(id);
  if (thing) return thing.initialProps[name] ?? null;
  return null;
}

export function truthy(v: Value): boolean {
  return v !== null && v !== false && v !== 0 && v !== '';
}

export function flag(w: World, s: GameState, id: string, name: string): boolean {
  return truthy(prop(w, s, id, name));
}

export function parentOf(s: GameState, id: string): string | null {
  return s.parent[id] ?? null;
}

/** Direct contents of a room, thing or "player", in definition order. */
export function childrenOf(w: World, s: GameState, holder: string): Thing[] {
  const out: Thing[] = [];
  for (const t of w.things.values()) if (s.parent[t.id] === holder) out.push(t);
  return out;
}

/** The room something is in, at any depth. */
export function roomOf(w: World, s: GameState, id: string): string | null {
  let cur: string | null = id;
  for (let guard = 0; cur !== null && guard < 1000; guard++) {
    if (cur === PLAYER) return s.location;
    if (w.rooms.has(cur)) return cur;
    cur = s.parent[cur] ?? null;
  }
  return null;
}

/** True if the player carries it, directly or inside something carried. */
export function isHeld(w: World, s: GameState, id: string): boolean {
  let cur: string | null = s.parent[id] ?? null;
  for (let guard = 0; cur !== null && guard < 1000; guard++) {
    if (cur === PLAYER) return true;
    if (w.rooms.has(cur)) return false;
    cur = s.parent[cur] ?? null;
  }
  return false;
}

/** True if a is inside b at any depth. */
export function isInside(s: GameState, a: string, b: string): boolean {
  let cur: string | null = s.parent[a] ?? null;
  for (let guard = 0; cur !== null && guard < 1000; guard++) {
    if (cur === b) return true;
    cur = s.parent[cur] ?? null;
  }
  return false;
}

/** Can the player see what is inside or on this thing? */
export function canSeeInto(w: World, s: GameState, t: Thing): boolean {
  if (t.surface || t.kind === 'character') return true;
  if (t.container) return flag(w, s, t.id, 'open') || t.transparent;
  return false;
}

function collectVisible(w: World, s: GameState, holder: string, out: Thing[]): void {
  for (const t of childrenOf(w, s, holder)) {
    out.push(t);
    if (canSeeInto(w, s, t)) collectVisible(w, s, t.id, out);
  }
}

/** Everything the player carries, at any visible depth. */
export function inventoryTree(w: World, s: GameState): Thing[] {
  const out: Thing[] = [];
  collectVisible(w, s, PLAYER, out);
  return out;
}

/** Fixed things that appear in several rooms (doors, backdrops). */
export function foundHere(w: World, room: string): Thing[] {
  const out: Thing[] = [];
  for (const t of w.things.values()) if (t.foundIn.includes(room)) out.push(t);
  return out;
}

/** What would be visible in the player's room if it were lit. */
export function potentialScope(w: World, s: GameState): Thing[] {
  const out: Thing[] = [];
  collectVisible(w, s, s.location, out);
  for (const t of foundHere(w, s.location)) if (!out.includes(t)) out.push(t);
  for (const t of inventoryTree(w, s)) if (!out.includes(t)) out.push(t);
  return out;
}

export function givesLight(w: World, s: GameState, t: Thing): boolean {
  if (!t.light) return false;
  return t.switchable ? flag(w, s, t.id, 'on') : true;
}

export function isLit(w: World, s: GameState): boolean {
  if (!flag(w, s, s.location, 'dark')) return true;
  return potentialScope(w, s).some((t) => givesLight(w, s, t));
}

/** Things the player can refer to now. In darkness, only what they carry. */
export function scope(w: World, s: GameState): Thing[] {
  return isLit(w, s) ? potentialScope(w, s) : inventoryTree(w, s);
}

/** Present in the player's room (at any depth, or found there), lit or not. */
export function isPresent(w: World, s: GameState, id: string): boolean {
  const t = w.things.get(id);
  if (t && t.foundIn.includes(s.location)) return true;
  return roomOf(w, s, id) === s.location && s.parent[id] !== undefined && s.parent[id] !== null;
}

/**
 * Can the player touch it? Returns null if so, otherwise the id of what is in
 * the way: a closed container, or the character holding it.
 */
export function blockedBy(w: World, s: GameState, id: string): string | null {
  let cur: string | null = s.parent[id] ?? null;
  for (let guard = 0; cur !== null && guard < 1000; guard++) {
    if (cur === PLAYER || w.rooms.has(cur)) return null;
    const t = w.things.get(cur);
    if (!t) return null;
    if (t.kind === 'character') return t.id;
    if (t.container && !flag(w, s, t.id, 'open')) return t.id;
    cur = s.parent[cur] ?? null;
  }
  return null;
}
