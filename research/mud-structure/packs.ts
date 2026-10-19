// Our own packs in the same neutral model, so they can be measured with the
// same yardstick as the MUD corpora.

import type { TextDef, World } from '../../src/engine/types.ts';
import { emptyWorld, fingerprint, wordCount, type MudExit, type MudWorld } from './model.ts';

/** Flatten text to plain words for counting (passages resolved, variants joined). */
function plain(world: World, def: TextDef | null | undefined): string {
  if (def === null || def === undefined) return '';
  if (typeof def === 'string') return def.startsWith('@') && !def.startsWith('@@') ? (world.texts.get(def.slice(1)) ?? '') : def;
  if (Array.isArray(def)) return def.map((d) => plain(world, d as TextDef)).join(' ');
  const v = def as { text?: TextDef; else?: TextDef };
  return `${plain(world, v.text)} ${plain(world, v.else)}`;
}

export function packWorld(world: World, corpus: string): MudWorld {
  const w = emptyWorld(corpus);
  const zoneOf = (roomId: string) => world.rooms.get(roomId)?.region ?? 'main';
  for (const room of world.rooms.values()) {
    const exits: MudExit[] = [];
    for (const e of room.exits.values()) {
      if (!e.to || !world.rooms.has(e.to)) continue;
      const door = e.door ? world.things.get(e.door) : undefined;
      const locked = door ? door.initialProps.locked === true : false;
      exits.push({
        dir: e.dir,
        to: e.to,
        door: !!door,
        closed: door ? door.initialProps.open !== true : false,
        // A conditional exit is a gate too, though it needs no key.
        locked: locked || e.if !== null,
        pickproof: false,
        key: door?.keys[0] ?? null,
      });
    }
    // Things the player can examine that are part of the room: scenery and fixtures.
    const details = [...world.things.values()].filter(
      (t) => t.kind === 'object' && (t.scenery || t.fixed) && (t.location === room.id || t.foundIn.includes(room.id)),
    ).length;
    const zone = zoneOf(room.id);
    w.rooms.set(room.id, {
      id: room.id,
      zone,
      dark: room.initialProps.dark === true,
      death: null,
      indoors: null,
      sector: null,
      descWords: wordCount(plain(world, room.description)),
      descPrint: fingerprint(plain(world, room.description)),
      extras: details,
      scripted: world.rules.some((r) => r.in?.includes(room.id) ?? false),
      exits,
    });
    if (!w.zones.has(zone)) w.zones.set(zone, { id: zone, rooms: [], lifespan: null });
    w.zones.get(zone)!.rooms.push(room.id);
  }
  // Where each thing starts: in a room, carried by a character, or in a container.
  const roomOf = (id: string | null, depth = 0): { room: string; via: 'room' | 'mob' | 'container' } | null => {
    if (!id || depth > 10) return null;
    if (world.rooms.has(id)) return { room: id, via: 'room' };
    const holder = world.things.get(id);
    if (!holder) return null;
    const up = roomOf(holder.location, depth + 1);
    return up ? { room: up.room, via: holder.kind === 'character' ? 'mob' : 'container' } : null;
  };
  for (const t of world.things.values()) {
    if (t.scenery || t.door) continue;
    const at = roomOf(t.location);
    if (t.kind === 'character') {
      w.mobs.set(t.id, { id: t.id, level: null, aggressive: false, sentinel: !t.wander, special: t.topics.length > 0 });
      if (at) w.placements.push({ kind: 'mob', what: t.id, room: at.room, via: at.via });
    } else {
      w.objs.set(t.id, { id: t.id, type: null, extras: 0, takeable: !t.fixed });
      if (at) w.placements.push({ kind: 'obj', what: t.id, room: at.room, via: at.via });
    }
  }
  return w;
}
