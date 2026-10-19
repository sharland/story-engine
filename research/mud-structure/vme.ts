// Reader for DikuMUD III (VME) zone source files (*.zon): rooms, exits,
// doors and keys, objects, creatures and the reset section. Inline script
// code (dilbegin ... dilend) is skipped; preprocessor lines are skipped by the
// tokenizer, so exits written through macros are not seen (the report counts
// rooms with no exits so that gap stays visible).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyWorld, skip, type MudExit, type MudWorld } from './model.ts';
import { tokenize, type Tok } from './vme-tokens.ts';

const DIRS = ['north', 'east', 'south', 'west', 'up', 'down', 'northeast', 'northwest', 'southeast', 'southwest'];
const SECTIONS = ['%zone', '%rooms', '%objects', '%mobiles', '%reset', '%dil', '%end'];

interface ZoneSrc {
  zone: string;
  toks: Tok[];
}

/** Read every *.zon file in a directory. */
export function readVme(dir: string, corpus: string): MudWorld {
  const files = readdirSync(dir).filter((f) => f.endsWith('.zon')).sort();
  return readVmeSources(files.map((f) => ({ file: f, text: readFileSync(join(dir, f), 'latin1') })), corpus);
}

export function readVmeSources(files: Array<{ file: string; text: string }>, corpus: string): MudWorld {
  const w = emptyWorld(corpus);
  const zones: ZoneSrc[] = files.map(({ file, text }) => {
    const toks = tokenize(text);
    const at = toks.findIndex((t) => t.k === 'word' && t.v === '%zone');
    const named = at >= 0 ? toks[at + 1] : undefined;
    const zone = named && named.k === 'word' && !named.v.startsWith('%') ? named.v : file.replace(/\.zon$/, '');
    return { zone, toks };
  });
  // Pass 1: units, so that references across zones can be resolved.
  const pendingExits: Array<{ exit: MudExit; target: string; zone: string }> = [];
  for (const z of zones) {
    w.zones.set(z.zone, { id: z.zone, rooms: [], lifespan: null });
    for (const [name, start, end] of sections(z.toks)) {
      if (name === '%zone') readZoneHeader(w, z, start, end);
      if (name === '%rooms') readRooms(w, z, start, end, pendingExits);
      if (name === '%objects') readObjects(w, z, start, end);
      if (name === '%mobiles') readMobiles(w, z, start, end);
    }
  }
  for (const p of pendingExits) {
    p.exit.to = resolve(w.rooms, p.target, p.zone);
    if (p.exit.to === null) skip(w, 'exit to a room not found');
  }
  for (const room of w.rooms.values()) {
    for (const e of room.exits) {
      if (e.key !== null) {
        const key = resolve(w.objs, e.key, room.zone);
        if (key === null) skip(w, 'key not found among objects');
        e.key = key;
      }
    }
  }
  // Pass 2: resets.
  for (const z of zones) {
    for (const [name, start, end] of sections(z.toks)) if (name === '%reset') readResets(w, z, start, end);
  }
  return w;
}

/** [section name, first token, end token] for each "%section". */
function sections(toks: Tok[]): Array<[string, number, number]> {
  const marks: Array<[string, number]> = [];
  toks.forEach((t, i) => {
    if (t.k === 'word' && SECTIONS.includes(t.v)) marks.push([t.v, i]);
  });
  return marks.map(([name, i], j) => [name, i + 1, j + 1 < marks.length ? marks[j + 1][1] : toks.length]);
}

/** "name", "name@zone" or "zone/name" (or "name/zone") to a known id "zone/name". */
function resolve(known: Map<string, unknown>, ref: string, zone: string): string | null {
  const tries: string[] = [];
  if (ref.includes('@')) {
    const [name, z] = ref.split('@');
    tries.push(`${z}/${name}`);
  } else if (ref.includes('/')) {
    const [a, b] = ref.split('/');
    tries.push(`${a}/${b}`, `${b}/${a}`);
  } else tries.push(`${zone}/${ref}`);
  return tries.find((t) => known.has(t)) ?? null;
}

const isWord = (t: Tok | undefined, v?: string): t is { k: 'word'; v: string; line: number } =>
  t !== undefined && t.k === 'word' && (v === undefined || t.v === v);
const isPunct = (t: Tok | undefined, v: string) => t !== undefined && t.k === 'punct' && t.v === v;
const text = (t: Tok | undefined): string => (t !== undefined && t.k === 'word' ? t.v : '');

/** Words inside a { ... } list starting at i; returns them and the index after "}". */
function braceList(toks: Tok[], i: number): [string[], number] {
  const words: string[] = [];
  if (!isPunct(toks[i], '{')) return [words, i];
  let j = i + 1;
  while (j < toks.length && !isPunct(toks[j], '}')) {
    const t = toks[j];
    if (t.k === 'word') words.push(t.v);
    j++;
  }
  return [words, j + 1];
}

/** Skip a balanced (...) or {...} group starting at i. */
function skipGroup(toks: Tok[], i: number): number {
  const open = toks[i].k === 'punct' ? (toks[i] as { v: string }).v : '';
  const close = open === '(' ? ')' : open === '{' ? '}' : '';
  if (!close) return i + 1;
  let depth = 0;
  for (let j = i; j < toks.length; j++) {
    if (isPunct(toks[j], open)) depth++;
    else if (isPunct(toks[j], close)) {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  return toks.length;
}

/** Skip the rest of a source line, and any groups that start on it. */
function skipLine(toks: Tok[], i: number): number {
  const line = toks[i].line;
  let j = i + 1;
  while (j < toks.length && toks[j].line === line) {
    if (isPunct(toks[j], '(') || isPunct(toks[j], '{')) j = skipGroup(toks, j);
    else j++;
  }
  return j;
}

function skipDil(toks: Tok[], i: number, end: number): number {
  let j = i;
  while (j < end && !isWord(toks[j], 'dilend')) j++;
  return j + 1;
}

function readZoneHeader(w: MudWorld, z: ZoneSrc, start: number, end: number): void {
  for (let i = start; i < end; i++) {
    if (isWord(z.toks[i], 'lifespan') && isWord(z.toks[i + 1])) w.zones.get(z.zone)!.lifespan = Number(text(z.toks[i + 1]));
  }
}

function readRooms(
  w: MudWorld,
  z: ZoneSrc,
  start: number,
  end: number,
  pending: Array<{ exit: MudExit; target: string; zone: string }>,
): void {
  const t = z.toks;
  let i = start;
  while (i < end) {
    if (!isWord(t[i])) {
      i++;
      continue;
    }
    const id = `${z.zone}/${text(t[i])}`;
    i++;
    let descWords = 0;
    let descPrint = '';
    let extras = 0;
    let scripted = false;
    let indoors: boolean | null = false;
    let sector: string | null = null;
    const exits: MudExit[] = [];
    while (i < end && !isWord(t[i], 'end')) {
      const tok = t[i];
      if (tok.k !== 'word') {
        i++;
        continue;
      }
      const v = tok.v;
      if (v === 'descr' && t[i + 1]?.k === 'str') {
        descWords += (t[i + 1] as { words: number }).words;
        descPrint += (t[i + 1] as { print: string }).print;
        i += 2;
      } else if (v === 'extra') {
        const [, after] = braceList(t, i + 1);
        extras++;
        i = t[after]?.k === 'str' ? after + 1 : after;
      } else if (v === 'flags') {
        const [flags, after] = braceList(t, i + 1);
        if (flags.some((f) => f.includes('INDOORS'))) indoors = true;
        i = after;
      } else if (v === 'movement' && isWord(t[i + 1])) {
        sector = text(t[i + 1]).replace(/^SECT_/, '').toLowerCase();
        i += 2;
      } else if (v === 'dilbegin') {
        scripted = true;
        i = skipDil(t, i, end);
      } else if (v === 'dilcopy') {
        scripted = true;
        while (i < end && !isPunct(t[i], ';')) i = isPunct(t[i], '(') ? skipGroup(t, i) : i + 1;
        i++;
      } else if (DIRS.includes(v) && isWord(t[i + 1], 'to') && isWord(t[i + 2])) {
        const exit: MudExit = { dir: v, to: null, door: false, closed: false, locked: false, pickproof: false, key: null };
        pending.push({ exit, target: text(t[i + 2]), zone: z.zone });
        i += 3;
        while (i < end && !isPunct(t[i], ';') && !isWord(t[i], 'end') && !(isWord(t[i]) && DIRS.includes(text(t[i])) && isWord(t[i + 1], 'to'))) {
          if (isWord(t[i], 'open')) {
            const [flags, after] = braceList(t, i + 1);
            exit.door = flags.some((f) => f.includes('OPEN_CLOSE'));
            exit.closed = flags.some((f) => f.includes('CLOSED'));
            exit.locked = flags.some((f) => f.includes('LOCKED'));
            exit.pickproof = flags.some((f) => f.includes('PICKPROOF'));
            i = after;
          } else if (isWord(t[i], 'key') && isWord(t[i + 1])) {
            exit.key = text(t[i + 1]);
            i += 2;
          } else i = isPunct(t[i], '{') || isPunct(t[i], '(') ? skipGroup(t, i) : i + 1;
        }
        if (isPunct(t[i], ';')) i++;
        exits.push(exit);
      } else if (['title', 'names', 'outside_descr', 'help'].includes(v)) {
        i++;
        if (isPunct(t[i], '{')) i = skipGroup(t, i);
        else if (t[i]?.k === 'str') i++;
      } else i = skipLine(t, i);
    }
    i++; // "end"
    if (w.rooms.has(id)) {
      skip(w, 'room defined twice');
      continue;
    }
    w.rooms.set(id, { id, zone: z.zone, dark: null, death: null, indoors, sector, descWords, descPrint, extras, scripted, exits });
    w.zones.get(z.zone)!.rooms.push(id);
  }
}

function readObjects(w: MudWorld, z: ZoneSrc, start: number, end: number): void {
  const t = z.toks;
  let i = start;
  while (i < end) {
    if (!isWord(t[i])) {
      i++;
      continue;
    }
    const id = `${z.zone}/${text(t[i])}`;
    i++;
    let type: string | null = null;
    let extras = 0;
    let takeable: boolean | null = false;
    while (i < end && !isWord(t[i], 'end')) {
      const v = t[i].k === 'word' ? (t[i] as { v: string }).v : '';
      if (v === 'type' && isWord(t[i + 1])) {
        type = text(t[i + 1]).replace(/^ITEM_/, '').toLowerCase();
        i += 2;
      } else if (v === 'extra') {
        const [, after] = braceList(t, i + 1);
        extras++;
        i = t[after]?.k === 'str' ? after + 1 : after;
      } else if (v === 'manipulate') {
        const [flags, after] = braceList(t, i + 1);
        if (flags.some((f) => f.includes('TAKE'))) takeable = true;
        i = after;
      } else if (v === 'dilbegin') i = skipDil(t, i, end);
      else if (isPunct(t[i], '{') || isPunct(t[i], '(')) i = skipGroup(t, i);
      else i++;
    }
    i++;
    w.objs.set(id, { id, type, extras, takeable });
  }
}

function readMobiles(w: MudWorld, z: ZoneSrc, start: number, end: number): void {
  const t = z.toks;
  let i = start;
  while (i < end) {
    if (!isWord(t[i])) {
      i++;
      continue;
    }
    const id = `${z.zone}/${text(t[i])}`;
    i++;
    let special = false;
    let aggressive = false;
    let wanders = false;
    while (i < end && !isWord(t[i], 'end')) {
      const v = t[i].k === 'word' ? (t[i] as { v: string }).v : '';
      if (v === 'dilbegin') {
        special = true;
        i = skipDil(t, i, end);
      } else if (v === 'dilcopy' && isWord(t[i + 1])) {
        special = true;
        const fn = text(t[i + 1]).toLowerCase();
        if (fn.includes('aggres')) aggressive = true;
        if (fn.includes('wander') || fn.includes('walk') || fn.includes('roam')) wanders = true;
        i += 2;
      } else if (isPunct(t[i], '{') || isPunct(t[i], '(')) i = skipGroup(t, i);
      else i++;
    }
    i++;
    // Level and stationary/wandering are set through macros and scripts the
    // parser doesn't expand, so they are left unknown except where a
    // wandering script is attached.
    w.mobs.set(id, { id, level: null, aggressive, sentinel: wanders ? false : null, special });
  }
}

function readResets(w: MudWorld, z: ZoneSrc, start: number, end: number): void {
  const t = z.toks;
  // Context stack: the unit each { ... } belongs to, and the room it is in.
  const stack: Array<{ kind: 'mob' | 'obj'; room: string } | null> = [];
  let last: { kind: 'mob' | 'obj'; room: string } | null = null;
  for (let i = start; i < end; i++) {
    const tok = t[i];
    if (isPunct(tok, '{')) {
      stack.push(last);
      continue;
    }
    if (isPunct(tok, '}')) {
      stack.pop();
      continue;
    }
    if (isWord(tok, 'dilbegin')) {
      i = skipDil(t, i, end) - 1;
      continue;
    }
    if (!isWord(tok, 'load') && !isWord(tok, 'equip')) continue;
    const ref = t[i + 1];
    if (!isWord(ref)) continue;
    const mob = resolve(w.mobs, text(ref), z.zone);
    const obj = mob ? null : resolve(w.objs, text(ref), z.zone);
    let room: string | null = null;
    let via: 'room' | 'mob' | 'container' = 'room';
    if (isWord(t[i + 2], 'into') && isWord(t[i + 3])) {
      room = resolve(w.rooms, text(t[i + 3]), z.zone);
    } else {
      const ctx = stack[stack.length - 1] ?? null;
      if (ctx) {
        room = ctx.room;
        via = ctx.kind === 'mob' ? 'mob' : 'container';
      }
    }
    if (!room || (!mob && !obj)) {
      last = null;
      skip(w, 'reset not placed');
      continue;
    }
    if (mob) w.placements.push({ kind: 'mob', what: mob, room, via });
    else w.placements.push({ kind: 'obj', what: obj!, room, via });
    last = { kind: mob ? 'mob' : 'obj', room };
  }
  // Door states set at reset are written on the exits already (open {...}).
}
