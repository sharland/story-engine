// Shape: the map measures and the notes validate gives on them. Each test
// builds a small pack in memory.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compilePack, packShape, validate, type PackSource } from '../src/engine/index.ts';
import { unexaminedNouns } from '../src/engine/shape.ts';

const manifest = { format: 1, id: 'shape', title: 'Shape', version: '1', author: 'Tests', licence: 'CC0-1.0', start: 'a' };

function pack(data: unknown): PackSource {
  return { origin: 'memory', manifest, data: [{ file: 'world/main.json', content: data }], texts: [], scripts: [], walkthroughs: [] };
}

// A square of four rooms (one loop) with a run of three empty road rooms off
// it to a cave, an empty nook, and a wood of eight rooms in a line with one
// way in.
function map(): Record<string, unknown> {
  const rooms: Record<string, unknown> = {
    a: { name: 'A', exits: { north: 'b', west: 'r1', south: 'w1' } },
    b: { name: 'B', exits: { south: 'a', east: 'c' } },
    c: { name: 'C', exits: { west: 'b', south: 'd', east: 'nook' } },
    d: { name: 'D', exits: { north: 'c', west: 'a' } },
    r1: { name: 'Road', description: 'A dusty road.', exits: { east: 'a', west: 'r2' } },
    r2: { name: 'Road', description: 'A dusty road.', exits: { east: 'r1', west: 'r3' } },
    r3: { name: 'Road', description: 'The road runs west.', exits: { east: 'r2', west: 'cave' } },
    cave: { name: 'Cave', exits: { east: 'r3' } },
    nook: { name: 'Nook', exits: { west: 'c' } },
  };
  for (let i = 1; i <= 8; i++) {
    const exits: Record<string, string> = {};
    if (i > 1) exits.north = `w${i - 1}`;
    else exits.north = 'a';
    if (i < 8) exits.south = `w${i + 1}`;
    rooms[`w${i}`] = { name: 'Wood', region: 'woods', exits };
  }
  return {
    rooms,
    objects: {
      lamp: { name: 'lamp', location: 'a' },
      coin: { name: 'coin', location: 'cave' },
      bell: { name: 'bell', location: 'b' },
      chalk: { name: 'chalk', location: 'c' },
      dice: { name: 'dice', location: 'd' },
      trees: { name: 'trees', scenery: true, foundIn: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8'] },
    },
  };
}

test('measures: loops, dead ends, corridors, entrances and distance across', () => {
  const c = compilePack(pack(map()));
  const s = packShape(c.world!, c);
  assert.equal(s.whole.rooms, 17);
  const [plain, woods] = s.areas;
  assert.equal(plain.label, '(no region)');
  assert.deepEqual([plain.rooms, plain.loops, plain.deadEnds, plain.corridors, plain.longestCorridorRun], [9, 1, 2, 3, 3]);
  assert.equal(plain.sharedDescriptions, 2);
  assert.deepEqual(plain.joins, ['woods']);
  assert.equal(woods.label, 'woods');
  assert.deepEqual([woods.rooms, woods.loops, woods.entrances, woods.across, woods.corridors], [8, 0, 1, 7, 0]);
  assert.equal(woods.details, 8);
  assert.deepEqual(woods.joins, ['(no region)']);
});

test('notes: shared descriptions, corridor runs, empty dead ends, one way in, no loop', () => {
  const r = validate(pack(map()));
  assert.equal(r.errors, 0);
  assert.ok(!r.issues.some((i) => i.code.startsWith('shape') || i.code === 'empty-dead-end'), 'notes are not issues');
  const byCode = new Map(r.notes.map((n) => [n.code, n.message]));
  assert.deepEqual([...byCode.keys()].sort(), ['corridor-run', 'empty-dead-end', 'no-loop', 'one-way-in', 'shared-description']);
  assert.match(byCode.get('shared-description')!, /Rooms "r1" and "r2" have the same description/);
  assert.match(byCode.get('corridor-run')!, /Rooms "r1", "r2" and "r3" are 3 empty rooms in a row/);
  assert.match(byCode.get('empty-dead-end')!, /Room "nook" is a dead end with nothing in it/);
  assert.match(byCode.get('one-way-in')!, /Region "woods" \(8 rooms\) has one way in/);
  assert.match(byCode.get('no-loop')!, /Region "woods" has 8 rooms and no loop, .*\(7 steps across\)/);
  assert.equal(r.notes.find((n) => n.code === 'empty-dead-end')!.where, 'world/main.json: rooms.nook');
});

test('a dead end with a character passing through, or a rule of its own, is not empty', () => {
  const data = {
    rooms: {
      a: { name: 'A', exits: { north: 'b', south: 'c' } },
      b: { name: 'B', exits: { south: 'a' } },
      c: { name: 'C', exits: { north: 'a' } },
    },
    characters: { cat: { name: 'cat', location: 'a', wander: { rooms: ['a', 'b'], chance: 0.5 } } },
    rules: [{ on: 'arrive', in: 'c', say: 'Cold here.' }],
  };
  assert.deepEqual(validate(pack(data)).notes, []);
});

test('nouns the text names that nothing answers to', () => {
  assert.deepEqual(unexaminedNouns('A ladder well drops down into the shaft. Amber strips glow along it.', new Set(['shaft'])), [
    'a ladder well',
    'amber strips',
  ]);
  // Plurals, hyphens, "of" and "with", possessives, and words that name no thing.
  assert.deepEqual(unexaminedNouns('A cabin with two bunks and a fold-down table.', new Set(['cabin', 'bunk', 'table'])), []);
  assert.deepEqual(unexaminedNouns("The station's hum fills the back of the room.", new Set()), ['the station']);
  assert.deepEqual(unexaminedNouns('Shelves of sealed crates line the walls.', new Set(['shelf', 'wall'])), ['sealed crates']);
});

test('only things that can be in the room count; room names, exits and ignoreWords do too', () => {
  const data = {
    rooms: {
      a: {
        name: 'Quay',
        description: 'A lamp hangs from a hook beside the window. The harbour is north, and gulls wheel overhead.',
        exits: { north: 'b' },
      },
      b: { name: 'Harbour', exits: { south: 'a' } },
    },
    objects: {
      lamp: { name: 'lamp', location: 'a', fixed: true },
      hook: { name: 'hook', location: 'b', fixed: true },
    },
    validator: { ignoreWords: ['window'] },
  };
  const notes = validate(pack(data)).notes;
  assert.equal(notes.length, 1);
  assert.match(notes[0].message, /^Room "a" names "a hook", which the player can't examine here/);
});

test('validator.ignoreWords must be a list of words', () => {
  const r = validate(pack({ rooms: { a: { name: 'A' } }, validator: { ignoreWords: 'window' } }));
  assert.ok(r.issues.some((i) => i.level === 'error' && i.message.includes('Expected a list of words')));
});
