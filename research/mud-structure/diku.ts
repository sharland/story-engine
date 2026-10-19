// Reader for the original DikuMUD world files (Gamma and Alfa, 1991):
// <name>.wld rooms, .zon zones and resets, .mob creatures, .obj objects.
// Written from the format described in the release's doc/database.doc.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyWorld, fingerprint, skip, wordCount, type MudExit, type MudWorld } from './model.ts';

const DIRS = ['north', 'east', 'south', 'west', 'up', 'down'];
const SECTORS = ['inside', 'city', 'field', 'forest', 'hills', 'mountain', 'water-swim', 'water-noswim'];
const ITEM_TYPES = [
  '', 'light', 'scroll', 'wand', 'staff', 'weapon', 'fireweapon', 'missile', 'treasure', 'armor', 'potion', 'worn',
  'other', 'trash', 'trap', 'container', 'note', 'drinkcon', 'key', 'food', 'money', 'pen', 'boat',
];
// Room flags.
const DARK = 1;
const DEATH = 2;
const INDOORS = 8;
// Creature action flags.
const ACT_SPEC = 1;
const ACT_SENTINEL = 2;
const ACT_AGGRESSIVE = 32;
// Object wear flags.
const ITEM_TAKE = 1;

/** Reads a Diku file: "~"-terminated strings and whitespace-separated numbers. */
class Reader {
  private lines: string[];
  private i = 0;
  constructor(text: string) {
    this.lines = text.replace(/\r\n?/g, '\n').split('\n');
  }
  get done(): boolean {
    this.skipBlank();
    return this.i >= this.lines.length;
  }
  private skipBlank(): void {
    while (this.i < this.lines.length && this.lines[this.i].trim() === '') this.i++;
  }
  /** The next non-blank line, trimmed. */
  line(): string {
    this.skipBlank();
    if (this.i >= this.lines.length) throw new Error('unexpected end of file');
    return this.lines[this.i++].trim();
  }
  peek(): string {
    this.skipBlank();
    return this.i < this.lines.length ? this.lines[this.i].trim() : '';
  }
  /** Text up to the next "~", across lines. */
  str(): string {
    const parts: string[] = [];
    const start = this.i + 1;
    while (this.i < this.lines.length) {
      const l = this.lines[this.i++];
      const t = l.indexOf('~');
      if (t >= 0) {
        parts.push(l.slice(0, t));
        return parts.join('\n');
      }
      parts.push(l);
    }
    throw new Error(`unterminated string from line ${start}`);
  }
  /** The next n numbers, across lines as needed. */
  nums(n: number): number[] {
    const out: number[] = [];
    while (out.length < n) {
      for (const tok of this.line().split(/\s+/)) {
        if (out.length < n && tok !== '') out.push(Number(tok));
      }
    }
    return out;
  }
  /** Skip to the next line that starts a record ("#") or ends the file ("$"). */
  toNextRecord(): void {
    while (this.i < this.lines.length && !/^\s*[#$]/.test(this.lines[this.i])) this.i++;
  }
}

/** Read a Diku lib directory (the folder holding tinyworld.wld and friends). */
export function readDiku(dir: string, corpus: string, base = 'tinyworld'): MudWorld {
  const w = emptyWorld(corpus);
  const file = (ext: string) => readFileSync(join(dir, `${base}.${ext}`), 'latin1');
  readRooms(w, file('wld'));
  readMobs(w, file('mob'));
  readObjs(w, file('obj'));
  readZones(w, file('zon'));
  return w;
}

export function readRooms(w: MudWorld, text: string): void {
  const r = new Reader(text);
  while (!r.done) {
    const head = r.line();
    if (head.startsWith('$') || r.peek().startsWith('$')) break;
    const vnum = head.slice(1);
    r.str(); // name
    const desc = r.str();
    const [zone, flags, sector] = r.nums(3);
    const exits: MudExit[] = [];
    let extras = 0;
    for (;;) {
      const l = r.line();
      if (l === 'S') break;
      if (l.startsWith('D')) {
        const dir = DIRS[Number(l.slice(1))] ?? `dir${l.slice(1)}`;
        r.str(); // what you see looking that way
        r.str(); // door keywords
        const [doorFlag, key, to] = r.nums(3);
        exits.push({
          dir,
          to: to >= 0 ? String(to) : null,
          door: doorFlag > 0,
          closed: false,
          locked: false,
          pickproof: doorFlag === 2,
          key: key > 0 ? String(key) : null,
        });
      } else if (l === 'E') {
        r.str();
        r.str();
        extras++;
      } else if (l.includes('~') && /^(E|S|D\d)$/.test(r.peek())) {
        skip(w, 'stray "~" line'); // slips in the data itself
      } else if (l.includes('~')) {
        // Keywords with no "E" before them. Read the description that follows.
        r.str();
        extras++;
        skip(w, 'extra description without its E marker');
      } else throw new Error(`room ${vnum}: unexpected line`);
    }
    const zoneId = String(zone);
    w.rooms.set(vnum, {
      id: vnum,
      zone: zoneId,
      dark: (flags & DARK) !== 0,
      death: (flags & DEATH) !== 0,
      indoors: (flags & INDOORS) !== 0,
      sector: SECTORS[sector] ?? null,
      descWords: wordCount(desc),
      descPrint: fingerprint(desc),
      extras,
      scripted: false,
      exits,
    });
    if (!w.zones.has(zoneId)) w.zones.set(zoneId, { id: zoneId, rooms: [], lifespan: null });
    w.zones.get(zoneId)!.rooms.push(vnum);
  }
  // Exits to rooms that don't exist lead nowhere.
  for (const room of w.rooms.values()) {
    for (const e of room.exits) {
      if (e.to !== null && !w.rooms.has(e.to)) {
        e.to = null;
        skip(w, 'exit to a missing room');
      }
    }
  }
}

export function readMobs(w: MudWorld, text: string): void {
  const r = new Reader(text);
  while (!r.done) {
    const head = r.line();
    if (head.startsWith('$') || r.peek().startsWith('$')) break;
    const vnum = head.slice(1);
    r.str();
    r.str();
    r.str();
    r.str();
    const flags = r.line().split(/\s+/);
    const act = Number(flags[0]);
    const simple = flags[flags.length - 1].toUpperCase() === 'S';
    let level: number | null = null;
    if (simple) level = r.nums(1)[0];
    else {
      r.nums(5);
      r.nums(7);
      level = r.nums(5)[4];
    }
    r.toNextRecord();
    w.mobs.set(vnum, {
      id: vnum,
      level,
      aggressive: (act & ACT_AGGRESSIVE) !== 0,
      sentinel: (act & ACT_SENTINEL) !== 0,
      special: (act & ACT_SPEC) !== 0,
    });
  }
}

export function readObjs(w: MudWorld, text: string): void {
  const r = new Reader(text);
  while (!r.done) {
    const head = r.line();
    if (head.startsWith('$') || r.peek().startsWith('$')) break;
    const vnum = head.slice(1);
    r.str();
    r.str();
    r.str();
    r.str();
    const [type, , wear] = r.nums(3);
    r.nums(4);
    r.nums(3);
    let extras = 0;
    while (!r.done && !/^[#$]/.test(r.peek())) {
      const l = r.line();
      if (l === 'E') {
        r.str();
        r.str();
        extras++;
      } else if (l === 'A') r.nums(2);
      else skip(w, 'unknown object line');
    }
    w.objs.set(vnum, { id: vnum, type: ITEM_TYPES[type] ?? `type${type}`, extras, takeable: (wear & ITEM_TAKE) !== 0 });
  }
}

/** Zones: lifespan, and the reset commands that place creatures and objects and set doors. */
export function readZones(w: MudWorld, text: string): void {
  const r = new Reader(text);
  let index = 0;
  while (!r.done) {
    const head = r.line();
    if (head.startsWith('$') || r.peek().startsWith('$')) break;
    r.str(); // name
    const [, lifespan] = r.nums(3);
    const zone = w.zones.get(String(index));
    if (zone) zone.lifespan = lifespan;
    index++;
    let lastMobRoom: string | null = null;
    const objRoom = new Map<string, string>();
    for (;;) {
      const l = r.line();
      if (l === 'S') break;
      if (l.startsWith('*')) continue;
      const [cmd, ...rest] = l.split(/\s+/);
      const a = rest.map(Number);
      switch (cmd) {
        case 'M': // if-flag, mob, max, room
          lastMobRoom = String(a[3]);
          w.placements.push({ kind: 'mob', what: String(a[1]), room: lastMobRoom, via: 'room' });
          break;
        case 'O': // if-flag, obj, max, room
          objRoom.set(String(a[1]), String(a[3]));
          w.placements.push({ kind: 'obj', what: String(a[1]), room: String(a[3]), via: 'room' });
          break;
        case 'G': // given to the last creature
        case 'E': // worn by the last creature
          if (lastMobRoom) w.placements.push({ kind: 'obj', what: String(a[1]), room: lastMobRoom, via: 'mob' });
          else skip(w, 'object given to no creature');
          break;
        case 'P': { // if-flag, obj, max, container obj
          const room = objRoom.get(String(a[3]));
          if (room) w.placements.push({ kind: 'obj', what: String(a[1]), room, via: 'container' });
          else skip(w, 'object put in a container not placed in a room');
          break;
        }
        case 'D': { // if-flag, room, exit, state
          const exit = w.rooms.get(String(a[1]))?.exits.find((e) => e.dir === DIRS[a[2]]);
          if (exit) {
            exit.closed = a[3] >= 1;
            exit.locked = a[3] >= 2;
          } else skip(w, 'door state for a missing exit');
          break;
        }
        case 'R':
          break;
        default:
          skip(w, `unknown reset command`);
      }
    }
  }
  for (const p of w.placements) {
    if (!w.rooms.has(p.room)) skip(w, 'placement in a missing room');
  }
  w.placements = w.placements.filter((p) => w.rooms.has(p.room));
}
