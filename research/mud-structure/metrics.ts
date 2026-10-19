// Structural measures of a world, per zone and overall. Every definition
// here is quoted in the report, so the numbers can be checked and argued with.
//
//   neighbours   distinct rooms joined to a room by an exit either way
//   dead end     1 neighbour
//   corridor     2 neighbours and nothing in it: no creature, no object, no
//                extra description, no script. Pure pass-through.
//   junction     3 or more neighbours; hub: 5 or more
//   content room a room with a creature or object placed in it at reset, an
//                extra description, or a script
//   loops        independent cycles in the zone's room graph (edges - rooms +
//                components): how many ways round there are, not just there and back
//   gate         a locked door (or, in our packs, a conditional exit)
//   duplicate    a room whose description is word for word the same as
//                another room's somewhere in the world (compared by fingerprint)
//   hub zone     the zone joined to the most other zones; hops are counted
//                from it over the graph of zones

import type { MudWorld } from './model.ts';

export interface ZoneMeasures {
  label: string;
  rooms: number;
  exitsPerRoom: number;
  deadEnds: number;
  corridors: number;
  junctions: number;
  hubs: number;
  loops: number;
  diameter: number;
  meanPath: number;
  longestCorridorRun: number;
  contentRooms: number;
  meanStepsToContent: number;
  roomsWithExtras: number;
  extrasPerRoom: number;
  descWordsMedian: number;
  mobsPlaced: number;
  objsPlaced: number;
  doors: number;
  gates: number;
  gateDepth: number;
  oneWayExits: number;
  exits: number;
  entries: number;
  neighbourZones: number;
  dark: number | null;
  deathTraps: number | null;
  duplicateDescs: number;
  hopsFromHub: number | null;
  levelMedian: number | null;
  levelRange: [number, number] | null;
  shape: string;
}

export interface WorldMeasures {
  corpus: string;
  zonesMeasured: number;
  zonesSkipped: number;
  rooms: number;
  zones: ZoneMeasures[];
  keyLock: { locks: number; keyFound: number; keyUnreachable: number; distances: number[]; keyBehindOwnDoor: number };
  mobs: { placements: number; aggressive: number | null; stationary: number | null; special: number | null };
  zoneGraph: { zones: number; links: number; loops: number; hubDegree: number; leaves: number; maxHops: number };
  sectors: Record<string, number>;
  skipped: Record<string, number>;
}

/** Zones with fewer rooms than this are left out (storage rooms, test zones, system zones). */
export const MIN_ROOMS = 5;

export function measure(w: MudWorld, labelPrefix: string, minRooms = MIN_ROOMS): WorldMeasures {
  // Undirected neighbour sets over the whole world.
  const nbr = new Map<string, Set<string>>();
  for (const id of w.rooms.keys()) nbr.set(id, new Set());
  for (const r of w.rooms.values()) {
    for (const e of r.exits) {
      if (!e.to || e.to === r.id || !nbr.has(e.to)) continue;
      nbr.get(r.id)!.add(e.to);
      nbr.get(e.to)!.add(r.id);
    }
  }
  const placedIn = new Map<string, { mobs: number; objs: number }>();
  for (const p of w.placements) {
    const c = placedIn.get(p.room) ?? { mobs: 0, objs: 0 };
    if (p.kind === 'mob') c.mobs++;
    else c.objs++;
    placedIn.set(p.room, c);
  }
  const isContent = (id: string) => {
    const r = w.rooms.get(id)!;
    const c = placedIn.get(id);
    return r.extras > 0 || r.scripted || (c !== undefined && c.mobs + c.objs > 0);
  };
  const isCorridor = (id: string) => nbr.get(id)!.size === 2 && !isContent(id);

  // Zones worth measuring: big enough, and not mostly unconnected rooms.
  const zones = [...w.zones.values()].filter((z) => {
    const connected = z.rooms.filter((id) => nbr.get(id)!.size > 0).length;
    return z.rooms.length >= minRooms && connected >= z.rooms.length / 2;
  });
  zones.sort((a, b) => b.rooms.length - a.rooms.length);

  const zoneOf = new Map<string, string>();
  for (const r of w.rooms.values()) zoneOf.set(r.id, r.zone);

  // Rooms that share their description with another room.
  const prints = new Map<string, number>();
  for (const r of w.rooms.values()) if (r.descWords > 0) prints.set(r.descPrint, (prints.get(r.descPrint) ?? 0) + 1);
  const duplicate = (id: string) => {
    const r = w.rooms.get(id)!;
    return r.descWords > 0 && (prints.get(r.descPrint) ?? 0) > 1;
  };

  // The graph of zones, and each zone's distance from the best-connected one.
  const zoneLinks = new Map<string, Set<string>>();
  for (const z of w.zones.keys()) zoneLinks.set(z, new Set());
  for (const r of w.rooms.values()) {
    for (const e of r.exits) {
      const other = e.to ? zoneOf.get(e.to) : undefined;
      if (!other || other === r.zone) continue;
      zoneLinks.get(r.zone)!.add(other);
      zoneLinks.get(other)!.add(r.zone);
    }
  }
  const linked = [...zoneLinks.keys()].filter((z) => zoneLinks.get(z)!.size > 0);
  const hub = linked.sort((a, b) => zoneLinks.get(b)!.size - zoneLinks.get(a)!.size)[0];
  const hops = hub ? bfs([hub], (z) => [...zoneLinks.get(z)!]) : new Map<string, number>();
  const linkCount = sum([...zoneLinks.values()].map((s) => s.size)) / 2;
  const zoneGraph = {
    zones: linked.length,
    links: linkCount,
    loops: linkCount - linked.length + components(new Set(linked), (z) => [...zoneLinks.get(z)!]),
    hubDegree: hub ? zoneLinks.get(hub)!.size : 0,
    leaves: linked.filter((z) => zoneLinks.get(z)!.size === 1).length,
    maxHops: hops.size ? Math.max(...hops.values()) : 0,
  };
  const levelsIn = (rooms: Set<string>) =>
    w.placements
      .filter((p) => p.kind === 'mob' && rooms.has(p.room))
      .map((p) => w.mobs.get(p.what)?.level)
      .filter((l): l is number => typeof l === 'number');

  const out: ZoneMeasures[] = zones.map((z, index) => {
    const rooms = new Set(z.rooms);
    const inZone = (id: string) => [...nbr.get(id)!].filter((n) => rooms.has(n));
    // Graph within the zone.
    let edges = 0;
    for (const id of rooms) edges += inZone(id).length;
    edges /= 2;
    const comps = components(rooms, inZone);
    const loops = edges - rooms.size + comps;
    // Paths.
    let diameter = 0;
    let pathSum = 0;
    let pathCount = 0;
    for (const id of rooms) {
      const d = bfs([id], inZone);
      for (const [other, dist] of d) {
        if (other === id) continue;
        diameter = Math.max(diameter, dist);
        pathSum += dist;
        pathCount++;
      }
    }
    // Corridor runs: connected groups of corridor rooms.
    const corridorRooms = new Set([...rooms].filter(isCorridor));
    let longestRun = 0;
    for (const c of componentSizes(corridorRooms, (id) => inZone(id).filter((n) => corridorRooms.has(n)))) {
      longestRun = Math.max(longestRun, c);
    }
    // Distance from each room to the nearest content room.
    const contents = [...rooms].filter(isContent);
    const toContent = contents.length > 0 ? bfs(contents, inZone) : new Map<string, number>();
    const reached = [...rooms].filter((id) => toContent.has(id));
    const meanStepsToContent = reached.length ? sum(reached.map((id) => toContent.get(id)!)) / reached.length : NaN;
    // Exits.
    let exits = 0;
    let doors = 0;
    let gates = 0;
    let oneWay = 0;
    const entryRooms = new Set<string>();
    const neighbourZones = new Set<string>();
    for (const id of rooms) {
      const r = w.rooms.get(id)!;
      for (const e of r.exits) {
        if (!e.to) continue;
        exits++;
        if (e.door) doors++;
        if (e.locked) gates++;
        const back = w.rooms.get(e.to)!.exits.some((x) => x.to === id);
        if (!back) oneWay++;
        if (!rooms.has(e.to)) neighbourZones.add(zoneOf.get(e.to)!);
      }
    }
    for (const r of w.rooms.values()) {
      if (rooms.has(r.id)) continue;
      for (const e of r.exits) if (e.to && rooms.has(e.to)) entryRooms.add(e.to);
    }
    // Gate depth: the most locked doors between an entry and any room of the zone.
    const starts = entryRooms.size > 0 ? [...entryRooms] : [z.rooms[0]];
    const gateDepth = maxGates(w, rooms, starts);
    const ids = [...rooms];
    const deg = (id: string) => nbr.get(id)!.size;
    const m: ZoneMeasures = {
      label: `${labelPrefix}${String(index + 1).padStart(2, '0')}`,
      rooms: rooms.size,
      exitsPerRoom: exits / rooms.size,
      deadEnds: ids.filter((id) => deg(id) === 1).length,
      corridors: corridorRooms.size,
      junctions: ids.filter((id) => deg(id) >= 3).length,
      hubs: ids.filter((id) => deg(id) >= 5).length,
      loops,
      diameter,
      meanPath: pathCount ? pathSum / pathCount : 0,
      longestCorridorRun: longestRun,
      contentRooms: contents.length,
      meanStepsToContent,
      roomsWithExtras: ids.filter((id) => w.rooms.get(id)!.extras > 0).length,
      extrasPerRoom: sum(ids.map((id) => w.rooms.get(id)!.extras)) / rooms.size,
      descWordsMedian: median(ids.map((id) => w.rooms.get(id)!.descWords)),
      mobsPlaced: sum(ids.map((id) => placedIn.get(id)?.mobs ?? 0)),
      objsPlaced: sum(ids.map((id) => placedIn.get(id)?.objs ?? 0)),
      doors,
      gates,
      gateDepth,
      oneWayExits: oneWay,
      exits,
      entries: entryRooms.size,
      neighbourZones: neighbourZones.size,
      dark: ids.some((id) => w.rooms.get(id)!.dark === null) ? null : ids.filter((id) => w.rooms.get(id)!.dark).length,
      deathTraps: ids.some((id) => w.rooms.get(id)!.death === null) ? null : ids.filter((id) => w.rooms.get(id)!.death).length,
      duplicateDescs: ids.filter(duplicate).length,
      hopsFromHub: hops.get(z.id) ?? null,
      levelMedian: null,
      levelRange: null,
      shape: '',
    };
    const levels = levelsIn(rooms);
    if (levels.length > 0) {
      m.levelMedian = median(levels);
      m.levelRange = [Math.min(...levels), Math.max(...levels)];
    }
    m.shape = shapeOf(m);
    return m;
  });

  // Keys and locks across the whole world.
  const keyRooms = new Map<string, string[]>();
  for (const p of w.placements) {
    if (p.kind !== 'obj') continue;
    const list = keyRooms.get(p.what) ?? [];
    list.push(p.room);
    keyRooms.set(p.what, list);
  }
  const all = (id: string) => [...nbr.get(id)!];
  // Entries to each zone: rooms reached by an exit from another zone.
  const entriesOf = new Map<string, string[]>();
  for (const r of w.rooms.values()) {
    for (const e of r.exits) {
      if (!e.to || zoneOf.get(e.to) === r.zone) continue;
      const z = zoneOf.get(e.to)!;
      entriesOf.set(z, [...(entriesOf.get(z) ?? []), e.to]);
    }
  }
  const distances: number[] = [];
  let locks = 0;
  let keyFound = 0;
  let unreachable = 0;
  let behind = 0;
  const seenDoors = new Set<string>();
  for (const r of w.rooms.values()) {
    for (const e of r.exits) {
      if (!e.locked || !e.key || !e.to) continue;
      // A door is two exits, one each side: count it once.
      const door = [r.id, e.to].sort().join(' ');
      if (seenDoors.has(door)) continue;
      seenDoors.add(door);
      locks++;
      const homes = keyRooms.get(e.key);
      if (!homes) continue;
      keyFound++;
      const d = bfs([r.id, e.to], all);
      const best = Math.min(...homes.map((h) => d.get(h) ?? Infinity));
      // A key loaded somewhere no exit leads (a storage room) can't be walked to at all.
      if (!Number.isFinite(best)) {
        unreachable++;
        continue;
      }
      distances.push(best);
      // Can the key be reached from the zone's entrances without going through this door?
      const through = (a: string, b: string) => (a === r.id && b === e.to) || (a === e.to && b === r.id);
      const blocked = (id: string) => all(id).filter((n) => !through(id, n));
      const starts = entriesOf.get(r.zone) ?? [r.id];
      const near = bfs(starts, blocked);
      if (!homes.some((h) => near.has(h))) behind++;
    }
  }

  const mobPlacements = w.placements.filter((p) => p.kind === 'mob');
  const known = (f: (m: { aggressive: boolean | null; sentinel: boolean | null; special: boolean | null }) => boolean | null) => {
    const vals = mobPlacements.map((p) => w.mobs.get(p.what)).filter((m) => m !== undefined).map((m) => f(m!));
    return vals.some((v) => v === null) ? null : vals.filter((v) => v).length;
  };
  const sectors: Record<string, number> = {};
  for (const z of zones) {
    for (const id of z.rooms) {
      const s = w.rooms.get(id)!.sector ?? 'unknown';
      sectors[s] = (sectors[s] ?? 0) + 1;
    }
  }
  return {
    corpus: w.corpus,
    zonesMeasured: zones.length,
    zonesSkipped: w.zones.size - zones.length,
    rooms: sum(zones.map((z) => z.rooms.length)),
    zones: out,
    keyLock: { locks, keyFound, keyUnreachable: unreachable, distances: distances.sort((a, b) => a - b), keyBehindOwnDoor: behind },
    mobs: {
      placements: mobPlacements.length,
      aggressive: known((m) => m.aggressive),
      stationary: known((m) => m.sentinel),
      special: known((m) => m.special),
    },
    zoneGraph,
    sectors,
    skipped: w.skipped,
  };
}

/**
 * A rough name for a zone's shape, from its measures:
 *   open      many loops and junctions: a town, a grid, open country
 *   spokes    hubs with many dead ends and few loops: a hub-and-spoke "theme park"
 *   chain     long and thin: few loops, and paths nearly as long as the zone
 *   tree      branching with few loops
 *   mixed     anything else
 */
export function shapeOf(m: ZoneMeasures): string {
  const loopsPer10 = (m.loops / m.rooms) * 10;
  if (loopsPer10 >= 2 && m.junctions / m.rooms >= 0.4) return 'open';
  if (m.hubs >= 1 && m.deadEnds / m.rooms >= 0.3 && loopsPer10 < 1) return 'spokes';
  if (loopsPer10 < 0.5 && m.diameter >= 0.5 * m.rooms) return 'chain';
  if (loopsPer10 < 1) return 'tree';
  return 'mixed';
}

function bfs(starts: string[], next: (id: string) => string[]): Map<string, number> {
  const dist = new Map<string, number>();
  const queue = [...starts];
  for (const s of starts) dist.set(s, 0);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const n of next(id)) {
      if (!dist.has(n)) {
        dist.set(n, dist.get(id)! + 1);
        queue.push(n);
      }
    }
  }
  return dist;
}

function components(nodes: Set<string>, next: (id: string) => string[]): number {
  return componentSizes(nodes, next).length;
}

function componentSizes(nodes: Set<string>, next: (id: string) => string[]): number[] {
  const seen = new Set<string>();
  const sizes: number[] = [];
  for (const n of nodes) {
    if (seen.has(n)) continue;
    const d = bfs([n], next);
    for (const k of d.keys()) seen.add(k);
    sizes.push(d.size);
  }
  return sizes;
}

/** 0-1 search: the most locked exits needed to reach any room of the zone from its entries. */
function maxGates(w: MudWorld, rooms: Set<string>, starts: string[]): number {
  const cost = new Map<string, number>();
  const deque: string[] = [];
  for (const s of starts) {
    if (!rooms.has(s)) continue;
    cost.set(s, 0);
    deque.push(s);
  }
  while (deque.length > 0) {
    const id = deque.shift()!;
    const c = cost.get(id)!;
    for (const e of w.rooms.get(id)!.exits) {
      if (!e.to || !rooms.has(e.to)) continue;
      const nc = c + (e.locked ? 1 : 0);
      if (nc < (cost.get(e.to) ?? Infinity)) {
        cost.set(e.to, nc);
        if (e.locked) deque.push(e.to);
        else deque.unshift(e.to);
      }
    }
  }
  return cost.size ? Math.max(...cost.values()) : 0;
}

export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}
