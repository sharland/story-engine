// Measure MUD corpora and our own packs, and write the numbers as JSON and as
// Markdown tables. The corpora stay outside this repository; only numbers and
// anonymous zone labels (A01, V07, ...) come out.
//
//   node research/mud-structure/report.ts \
//     --diku <label>=<lib dir> --vme <label>=<zone dir> --pack <label>=<pack dir> \
//     --json research/mud-structure/results.json --md research/mud-structure/tables.md
//
// With --check <file> instead of --json/--md, it lists every identifier from
// the corpora (zone, room, creature and object names) that appears in that
// file, for reviewing a hand-written document before it is committed.
//
// Clean-room guard: before anything is written, every word in the output must
// be a word from this program's own source, a label given on the command line,
// or an anonymous zone label. Anything else is a leak from a corpus, and the
// program stops without writing.

import { readFileSync, writeFileSync } from 'node:fs';
import { loadWorld } from '../../src/engine/index.ts';
import { loadPack } from '../../src/node/loader.ts';
import { readDiku } from './diku.ts';
import { measure, median, quantile, sum, type WorldMeasures, type ZoneMeasures } from './metrics.ts';
import type { MudWorld } from './model.ts';
import { packWorld } from './packs.ts';
import { readVme } from './vme.ts';

interface Source {
  kind: 'diku' | 'vme' | 'pack';
  label: string;
  path: string;
}

function parseArgs(argv: string[]): { sources: Source[]; json: string | null; md: string | null; check: string | null } {
  const sources: Source[] = [];
  let json: string | null = null;
  let md: string | null = null;
  let check: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === '--json') json = v;
    else if (a === '--md') md = v;
    else if (a === '--check') check = v;
    else if (a === '--diku' || a === '--vme' || a === '--pack') {
      const eq = v.indexOf('=');
      sources.push({ kind: a.slice(2) as Source['kind'], label: v.slice(0, eq), path: v.slice(eq + 1) });
    } else continue;
    i++;
  }
  return { sources, json, md, check };
}

/** Corpus identifiers (names of zones, rooms, creatures, objects) found in a text. */
export function corpusNamesIn(text: string, worlds: MudWorld[]): string[] {
  const names = new Set<string>();
  for (const w of worlds) {
    const ids = [...w.zones.keys(), ...w.rooms.keys(), ...w.mobs.keys(), ...w.objs.keys()];
    for (const id of ids) {
      for (const part of id.split(/[/@]/)) {
        for (const word of part.split('_')) if (word.length >= 4 && /[a-z]/i.test(word)) names.add(word.toLowerCase());
      }
    }
  }
  const found = new Set<string>();
  for (const word of text.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []) if (names.has(word.toLowerCase())) found.add(word.toLowerCase());
  return [...found].sort();
}

/** Corpus-wide figures, weighted by rooms where that is the fair weighting. */
export function summarise(m: WorldMeasures) {
  const z = m.zones;
  const rooms = sum(z.map((x) => x.rooms));
  const exits = sum(z.map((x) => x.exits));
  const share = (f: (x: ZoneMeasures) => number) => (rooms ? sum(z.map(f)) / rooms : NaN);
  const perExit = (f: (x: ZoneMeasures) => number) => (exits ? sum(z.map(f)) / exits : NaN);
  const shapes: Record<string, number> = {};
  for (const x of z) shapes[x.shape] = (shapes[x.shape] ?? 0) + 1;
  const known = (v: number | null) => (v === null || m.mobs.placements === 0 ? null : v / m.mobs.placements);
  // Median creature level of the zones at each distance from the hub zone.
  const byHops = new Map<number, number[]>();
  for (const x of z) {
    if (x.hopsFromHub === null || x.levelMedian === null) continue;
    byHops.set(x.hopsFromHub, [...(byHops.get(x.hopsFromHub) ?? []), x.levelMedian]);
  }
  const levelByHops = [...byHops.entries()].sort((a, b) => a[0] - b[0]).map(([hops, ls]) => ({ hops, zones: ls.length, level: median(ls) }));
  return {
    corpus: m.corpus,
    zones: z.length,
    rooms,
    zoneRoomsMedian: median(z.map((x) => x.rooms)),
    zoneRoomsQuartiles: [quantile(z.map((x) => x.rooms), 0.25), quantile(z.map((x) => x.rooms), 0.75)],
    exitsPerRoom: rooms ? exits / rooms : NaN,
    deadEndShare: share((x) => x.deadEnds),
    corridorShare: share((x) => x.corridors),
    junctionShare: share((x) => x.junctions),
    hubsPer100Rooms: share((x) => x.hubs) * 100,
    loopsPer10RoomsMedian: median(z.map((x) => (x.loops / x.rooms) * 10)),
    diameterMedian: median(z.map((x) => x.diameter)),
    longestCorridorRun: Math.max(0, ...z.map((x) => x.longestCorridorRun)),
    contentShare: share((x) => x.contentRooms),
    duplicateDescShare: share((x) => x.duplicateDescs),
    stepsToContentMedian: median(z.map((x) => x.meanStepsToContent).filter((v) => !Number.isNaN(v))),
    extrasShare: share((x) => x.roomsWithExtras),
    extrasPerRoom: share((x) => x.extrasPerRoom * x.rooms),
    descWordsMedian: median(z.map((x) => x.descWordsMedian)),
    creaturesPer10Rooms: share((x) => x.mobsPlaced) * 10,
    objectsPer10Rooms: share((x) => x.objsPlaced) * 10,
    doorsPer100Exits: perExit((x) => x.doors) * 100,
    gatesPer100Exits: perExit((x) => x.gates) * 100,
    maxGateDepth: Math.max(0, ...z.map((x) => x.gateDepth)),
    oneWayShare: perExit((x) => x.oneWayExits),
    singleEntryZones: z.filter((x) => x.entries === 1).length,
    neighbourZonesMedian: median(z.map((x) => x.neighbourZones)),
    shapes,
    zoneGraph: m.zoneGraph,
    levelByHops,
    keyLock: {
      locks: m.keyLock.locks,
      keysPlaced: m.keyLock.keyFound,
      keysNoOneCanReach: m.keyLock.keyUnreachable,
      keysBehindTheirDoor: m.keyLock.keyBehindOwnDoor,
      distanceMedian: median(m.keyLock.distances),
      distanceMax: m.keyLock.distances.length ? Math.max(...m.keyLock.distances) : NaN,
    },
    creatures: {
      placed: m.mobs.placements,
      aggressiveShare: known(m.mobs.aggressive),
      stationaryShare: known(m.mobs.stationary),
      scriptedShare: known(m.mobs.special),
    },
    darkShare: z.some((x) => x.dark === null) ? null : share((x) => x.dark ?? 0),
    deathTraps: z.some((x) => x.deathTraps === null) ? null : sum(z.map((x) => x.deathTraps ?? 0)),
    zonesLeftOut: m.zonesSkipped,
    parserSkipped: m.skipped,
  };
}

const f1 = (v: number | null) => (v === null || Number.isNaN(v) ? 'n/a' : Number.isInteger(v) ? String(v) : v.toFixed(1));
const pct = (v: number | null) => (v === null || Number.isNaN(v) ? 'n/a' : `${Math.round(v * 100)}%`);

export function markdown(summaries: ReturnType<typeof summarise>[], measures: WorldMeasures[]): string {
  const out: string[] = [];
  const row = (cells: string[]) => `| ${cells.join(' | ')} |`;
  const head = ['Measure', ...summaries.map((s) => s.corpus)];
  out.push(row(head), row(head.map(() => '---')));
  const line = (name: string, f: (s: ReturnType<typeof summarise>) => string) => out.push(row([name, ...summaries.map(f)]));
  line('Zones measured', (s) => String(s.zones));
  line('Rooms in them', (s) => String(s.rooms));
  line('Rooms per zone, median (quartiles)', (s) => `${f1(s.zoneRoomsMedian)} (${s.zoneRoomsQuartiles.map(f1).join('–')})`);
  line('Exits per room', (s) => f1(s.exitsPerRoom));
  line('Dead ends', (s) => pct(s.deadEndShare));
  line('Corridors (empty pass-through rooms)', (s) => pct(s.corridorShare));
  line('Junctions (3+ ways)', (s) => pct(s.junctionShare));
  line('Hubs (5+ ways) per 100 rooms', (s) => f1(s.hubsPer100Rooms));
  line('Loops per 10 rooms, median zone', (s) => f1(s.loopsPer10RoomsMedian));
  line('Zone diameter in steps, median', (s) => f1(s.diameterMedian));
  line('Longest run of corridor rooms', (s) => String(s.longestCorridorRun));
  line('Rooms with content', (s) => pct(s.contentShare));
  line('Rooms sharing their description with another room', (s) => pct(s.duplicateDescShare));
  line('Steps from a room to content, median zone', (s) => f1(s.stepsToContentMedian));
  line('Rooms with extra descriptions', (s) => pct(s.extrasShare));
  line('Extra descriptions per room', (s) => f1(s.extrasPerRoom));
  line('Words in a room description, median zone', (s) => f1(s.descWordsMedian));
  line('Creatures placed per 10 rooms', (s) => f1(s.creaturesPer10Rooms));
  line('Objects placed per 10 rooms', (s) => f1(s.objectsPer10Rooms));
  line('Doors per 100 exits', (s) => f1(s.doorsPer100Exits));
  line('Locked doors or gates per 100 exits', (s) => f1(s.gatesPer100Exits));
  line('Most gates between a zone entrance and a room', (s) => String(s.maxGateDepth));
  line('One-way exits', (s) => pct(s.oneWayShare));
  line('Zones with a single entrance', (s) => `${s.singleEntryZones} of ${s.zones}`);
  line('Neighbouring zones per zone, median', (s) => f1(s.neighbourZonesMedian));
  line('Zone shapes', (s) => Object.entries(s.shapes).sort().map(([k, v]) => `${k} ${v}`).join(', '));
  line('Zones joined to other zones / links between them', (s) => `${s.zoneGraph.zones} / ${s.zoneGraph.links}`);
  line('Loops in the graph of zones', (s) => String(s.zoneGraph.loops));
  line('Zones the hub zone joins directly', (s) => String(s.zoneGraph.hubDegree));
  line('Zones joined to only one other zone', (s) => String(s.zoneGraph.leaves));
  line('Most hops from the hub zone', (s) => String(s.zoneGraph.maxHops));
  line('Creature level by hops from the hub zone (median)', (s) =>
    s.levelByHops.length ? s.levelByHops.map((h) => `${h.hops}: ${f1(h.level)}`).join(', ') : 'n/a');
  line('Locked doors with keys / keys placed', (s) => `${s.keyLock.locks} / ${s.keyLock.keysPlaced}`);
  line('Keys in rooms no exit leads to', (s) => String(s.keyLock.keysNoOneCanReach));
  line('Reachable keys behind their own door', (s) => String(s.keyLock.keysBehindTheirDoor));
  line('Steps from door to key, median (max)', (s) => `${f1(s.keyLock.distanceMedian)} (${f1(s.keyLock.distanceMax)})`);
  line('Creatures placed', (s) => String(s.creatures.placed));
  line('Aggressive creatures', (s) => pct(s.creatures.aggressiveShare));
  line('Creatures that never move', (s) => pct(s.creatures.stationaryShare));
  line('Creatures with scripts', (s) => pct(s.creatures.scriptedShare));
  line('Dark rooms', (s) => pct(s.darkShare));
  line('Death traps', (s) => (s.deathTraps === null ? 'n/a' : String(s.deathTraps)));
  out.push('');
  for (const m of measures) {
    out.push(`Zones of ${m.corpus}:`, '');
    const cols = ['Zone', 'Rooms', 'Exits/room', 'Dead ends', 'Corridors', 'Junctions', 'Loops', 'Diameter', 'Content', 'Extras', 'Same text', 'Creatures', 'Level', 'Objects', 'Gates', 'Entrances', 'Hops', 'Shape'];
    out.push(row(cols), row(cols.map(() => '---')));
    for (const z of m.zones) {
      out.push(row([
        z.label, String(z.rooms), f1(z.exitsPerRoom), String(z.deadEnds), String(z.corridors), String(z.junctions), String(z.loops),
        String(z.diameter), String(z.contentRooms), String(z.roomsWithExtras), String(z.duplicateDescs), String(z.mobsPlaced),
        z.levelMedian === null ? 'n/a' : `${f1(z.levelMedian)} (${z.levelRange![0]}–${z.levelRange![1]})`, String(z.objsPlaced),
        String(z.gates), String(z.entries), z.hopsFromHub === null ? 'n/a' : String(z.hopsFromHub), z.shape,
      ]));
    }
    out.push('');
  }
  return out.join('\n');
}

/** Every word of the output must come from our own source, a given label, or an anonymous zone label. */
export function cleanRoomCheck(output: string, labels: string[]): string[] {
  const own = new Set<string>();
  for (const f of ['report.ts', 'metrics.ts', 'model.ts', 'diku.ts', 'vme.ts', 'vme-tokens.ts', 'packs.ts']) {
    for (const word of readFileSync(new URL(f, import.meta.url), 'utf8').match(/[A-Za-z][A-Za-z0-9_]*/g) ?? []) own.add(word.toLowerCase());
  }
  for (const l of labels) for (const word of l.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? []) own.add(word.toLowerCase());
  const strays = new Set<string>();
  for (const word of output.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? []) {
    if (/^[A-Z]{1,2}\d{2}$/.test(word)) continue;
    if (!own.has(word.toLowerCase())) strays.add(word);
  }
  return [...strays];
}

async function main(): Promise<void> {
  const { sources, json, md, check } = parseArgs(process.argv.slice(2));
  if (sources.length === 0) {
    console.error('Give at least one --diku, --vme or --pack <label>=<path>.');
    process.exit(2);
  }
  const measures: WorldMeasures[] = [];
  const worlds: MudWorld[] = [];
  const prefixes = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (const [i, s] of sources.entries()) {
    let w: MudWorld;
    let minRooms: number | undefined;
    if (s.kind === 'diku') w = readDiku(s.path, s.label);
    else if (s.kind === 'vme') w = readVme(s.path, s.label);
    else {
      w = packWorld(loadWorld(await loadPack(s.path)), s.label);
      minRooms = 1; // a pack is small; measure all of it
    }
    if (s.kind !== 'pack') worlds.push(w);
    measures.push(measure(w, prefixes[i], minRooms));
  }
  if (check) {
    const found = corpusNamesIn(readFileSync(check, 'utf8'), worlds);
    console.log(found.length ? `Corpus words in ${check} (review each): ${found.join(', ')}` : `No corpus words in ${check}.`);
    return;
  }
  const summaries = measures.map(summarise);
  const jsonText = `${JSON.stringify({ summaries, zones: measures.map((m) => ({ corpus: m.corpus, zones: m.zones })) }, null, 2)}\n`;
  const mdText = `${markdown(summaries, measures)}\n`;
  const strays = cleanRoomCheck(jsonText + mdText, sources.map((s) => s.label));
  if (strays.length > 0) {
    console.error(`Clean-room check failed: these words are not ours: ${strays.join(', ')}. Nothing was written.`);
    process.exit(1);
  }
  if (json) writeFileSync(json, jsonText);
  if (md) writeFileSync(md, mdText);
  if (!json && !md) process.stdout.write(mdText);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
