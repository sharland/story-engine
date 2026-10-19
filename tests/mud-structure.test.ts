// The MUD structure tools: readers for the two formats, the measures, and
// the clean-room guard. Every world here is a small synthetic one written for
// these tests; no corpus text is used.

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadWorld } from '../src/engine/index.ts';
import { loadPack } from '../src/node/loader.ts';
import { readMobs, readObjs, readRooms, readZones } from '../research/mud-structure/diku.ts';
import { measure } from '../research/mud-structure/metrics.ts';
import { emptyWorld, type MudExit, type MudWorld } from '../research/mud-structure/model.ts';
import { packWorld } from '../research/mud-structure/packs.ts';
import { cleanRoomCheck, summarise } from '../research/mud-structure/report.ts';
import { readVmeSources } from '../research/mud-structure/vme.ts';

const root = join(import.meta.dirname, '..');

// Five rooms in zone 1: a square of four (one loop) with a locked door out of
// it to a fifth room. The key is carried by a creature on the near side.
const wld = `#101
Square One~
A plain test square with nothing much in it at all.
~
1 0 1
D1
~
~
0 -1 102
D2
~
~
0 -1 104
E
plaque~
A test plaque.
~
S
#102
Square Two~
Same words.
~
1 1 1
D3
~
~
0 -1 101
D2
~
~
0 -1 103
S
#103
Square Three~
Same words.
~
1 2 1
D0
~
~
0 -1 102
D3
~
~
0 -1 104
D1
~
door~
1 900 105
S
#104
Square Four~
Another text.
~
1 8 0
D0
~
~
0 -1 101
D1
~
~
0 -1 103
note~
A stray note with no E marker before it.
~
S
#105
Vault~
Behind the door.
~
1 9 0
D3
~
door~
1 900 103
S
#19999
$~
`;
const mob = `#201
guard~
a guard~
A guard stands here.
~
Plain.
~
34 0 0 S
5 20 5 1d1+10 1d4+0
10 100
8 8 1
#202
pilgrim~
a pilgrim~
A pilgrim waits.
~
Plain.
~
10 0 0 D
10 10 10 10 10
1 1 1 1 1 1 1
8 8 1 0 7 20 100 100
0 0 0
0 0 0 0 0
#19999
$~
`;
const obj = `#900
key~
a key~
A key lies here.~
~
18 0 1
0 0 0 0
1 1 1
E
key~
A test key.
~
#19999
$~
`;
const zon = `#1
Test zone~
199 15 2
M 0 201 1 101
G 1 900 1
M 0 202 1 105
D 0 103 1 2
D 0 105 3 2
S
#19999
$~
`;

function dikuWorld(): MudWorld {
  const w = emptyWorld('test');
  readRooms(w, wld);
  readMobs(w, mob);
  readObjs(w, obj);
  readZones(w, zon);
  return w;
}

test('Diku reader: rooms, exits, doors, extras, creatures, objects and resets', () => {
  const w = dikuWorld();
  assert.equal(w.rooms.size, 5);
  const r101 = w.rooms.get('101')!;
  assert.equal(r101.zone, '1');
  assert.equal(r101.extras, 1);
  assert.equal(r101.descWords, 11);
  assert.deepEqual(r101.exits.map((e) => [e.dir, e.to]), [['east', '102'], ['south', '104']]);
  assert.equal(w.rooms.get('102')!.dark, true);
  assert.equal(w.rooms.get('103')!.death, true);
  assert.equal(w.rooms.get('104')!.indoors, true);
  // The stray keywords line is read as an extra description and counted.
  assert.equal(w.rooms.get('104')!.extras, 1);
  assert.equal(w.skipped['extra description without its E marker'], 1);
  const door: MudExit = w.rooms.get('103')!.exits.find((e) => e.dir === 'east')!;
  assert.deepEqual([door.door, door.closed, door.locked, door.key], [true, true, true, '900']);
  assert.deepEqual(w.mobs.get('201'), { id: '201', level: 5, aggressive: true, sentinel: true, special: false });
  assert.deepEqual(w.mobs.get('202'), { id: '202', level: 7, aggressive: false, sentinel: true, special: false });
  assert.deepEqual(w.objs.get('900'), { id: '900', type: 'key', extras: 1, takeable: true });
  assert.deepEqual(w.placements, [
    { kind: 'mob', what: '201', room: '101', via: 'room' },
    { kind: 'obj', what: '900', room: '101', via: 'mob' },
    { kind: 'mob', what: '202', room: '105', via: 'room' },
  ]);
});

test('measures: loops, dead ends, corridors, duplicates, gates and keys', () => {
  const m = measure(dikuWorld(), 'T');
  assert.equal(m.zones.length, 1);
  const z = m.zones[0];
  assert.equal(z.rooms, 5);
  assert.equal(z.loops, 1); // the square
  assert.equal(z.deadEnds, 1); // the vault
  assert.equal(z.junctions, 1); // room 103: three ways
  assert.equal(z.corridors, 1); // room 102: two ways, nothing in it
  assert.equal(z.duplicateDescs, 2); // 102 and 103 share their text
  assert.equal(z.gates, 2); // one locked door, seen from both sides
  assert.equal(z.gateDepth, 1); // the vault is behind one locked door, counted from the first room (the zone has no entrance)
  assert.deepEqual(m.keyLock, { locks: 1, keyFound: 1, keyUnreachable: 0, distances: [2], keyBehindOwnDoor: 0 });
  assert.equal(z.levelMedian, 6);
  assert.deepEqual(z.levelRange, [5, 7]);
});

test('VME reader: rooms, cross-zone exits, doors with keys, scripts and nested resets', () => {
  const town = `%zone town
lifespan 20
%rooms
square
title "A test square"
descr "Four words of text."
extra {"well"} "A test well."
movement SECT_CITY
east to gate;
north to hut@forest;
end
gate
title "A test gate"
descr "Two words."
flags {UNIT_FL_INDOORS}
west to square;
east to cell open {EX_OPEN_CLOSE, EX_CLOSED, EX_LOCKED} keyword {"door"} key brass;
dilcopy something@lib(1);
end
cell
title "A test cell"
descr "Two words."
west to gate open {EX_OPEN_CLOSE, EX_CLOSED, EX_LOCKED} key brass;
end
%objects
brass
names {"key"}
type ITEM_KEY
manipulate {MANIPULATE_TAKE}
end
%mobiles
warden
names {"warden"}
dilcopy aggressive@lib(0);
dilbegin unused();
code { end; }
dilend
end
%reset
load warden into square max 1
{ equip brass position WEAR_HOLD }
%end
`;
  const forest = `%zone forest
%rooms
hut
title "A test hut"
descr "Two words."
south to square@town;
end
%end
`;
  const w = readVmeSources([{ file: 'a.zon', text: town }, { file: 'b.zon', text: forest }], 'test');
  assert.deepEqual([...w.rooms.keys()].sort(), ['forest/hut', 'town/cell', 'town/gate', 'town/square']);
  const square = w.rooms.get('town/square')!;
  assert.equal(square.descWords, 4);
  assert.equal(square.extras, 1);
  assert.equal(square.sector, 'city');
  assert.deepEqual(square.exits.map((e) => e.to), ['town/gate', 'forest/hut']);
  const gate = w.rooms.get('town/gate')!;
  assert.equal(gate.indoors, true);
  assert.equal(gate.scripted, true);
  const door = gate.exits.find((e) => e.dir === 'east')!;
  assert.deepEqual([door.to, door.door, door.locked, door.key], ['town/cell', true, true, 'town/brass']);
  assert.equal(w.zones.get('town')!.lifespan, 20);
  assert.deepEqual(w.objs.get('town/brass'), { id: 'town/brass', type: 'key', extras: 0, takeable: true });
  assert.equal(w.mobs.get('town/warden')!.aggressive, true);
  assert.deepEqual(w.placements, [
    { kind: 'mob', what: 'town/warden', room: 'town/square', via: 'room' },
    { kind: 'obj', what: 'town/brass', room: 'town/square', via: 'mob' },
  ]);
  assert.deepEqual(w.skipped, {});
});

test('our packs are measured in the same terms', async () => {
  const w = packWorld(loadWorld(await loadPack(join(root, 'packs', 'sorrow-creek'))), 'western');
  const m = measure(w, 'P', 1);
  assert.equal(m.rooms, 4);
  assert.equal(m.zones[0].loops, 0);
  assert.ok(m.zones[0].roomsWithExtras >= 3);
  assert.equal(summarise(m).corpus, 'western');
});

test('the clean-room guard rejects any word that is not ours', () => {
  assert.deepEqual(cleanRoomCheck('| Dead ends | 14% | A07 |', ['Alfa']), []);
  assert.deepEqual(cleanRoomCheck('| Rooms | 3 | Alfa |', ['Alfa']), []);
  assert.deepEqual(cleanRoomCheck('| Zone | Grimbleshanks |', ['Alfa']), ['Grimbleshanks']);
});
