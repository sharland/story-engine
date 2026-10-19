// Diagrams: the committed ones are current, the SVG is well formed, the map
// lays rooms out without overlaps, and the puzzle chart works out what must
// happen before what, including what earlier rules imply.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { demoDiagrams, diagramsDir } from '../scripts/diagrams.ts';
import { diagram } from '../src/diagram/index.ts';
import { compilePack, type PackSource } from '../src/engine/index.ts';

const manifest = { format: 1, id: 'charts', title: 'Charts', version: '1', author: 'Tests', licence: 'CC0-1.0', start: 'hall' };

function draw(kind: 'map' | 'puzzles' | 'talk', data: unknown): string {
  const src: PackSource = { origin: 'memory', manifest, data: [{ file: 'world/main.json', content: data }], texts: [], scripts: [], walkthroughs: [] };
  const c = compilePack(src);
  assert.ok(c.world, JSON.stringify(c.issues));
  return diagram(kind, c.world, c);
}

/** Tags open and close in order (a light well-formedness check). */
function balanced(svg: string): boolean {
  const stack: string[] = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
    const [, close, name, self] = m;
    if (self) continue;
    if (close) {
      if (stack.pop() !== name) return false;
    } else stack.push(name);
  }
  return stack.length === 0;
}

function cards(svg: string): Array<{ x: number; y: number; w: number; h: number }> {
  return [...svg.matchAll(/<rect class="card" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    w: Number(m[3]),
    h: Number(m[4]),
  }));
}

test('the diagrams in docs/diagrams are up to date (node scripts/diagrams.ts)', async () => {
  for (const { file, svg } of await demoDiagrams()) {
    assert.equal(readFileSync(join(diagramsDir, file), 'utf8'), svg, `${file} is out of date: run node scripts/diagrams.ts`);
    assert.ok(balanced(svg), `${file} is not well formed`);
    const boxes = cards(svg);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        assert.ok(apart, `${file}: cards ${i} and ${j} overlap`);
      }
    }
  }
});

test('map: rooms by compass, words coloured by what they name, gated and one-way exits marked', () => {
  const svg = draw('map', {
    rooms: {
      hall: { name: 'Hall', description: 'A bare hall. A lamp hangs over a chest. The vault door is north; a hatch leads down.', exits: { north: { to: 'vault', if: { var: 'chest.open' } }, down: 'cellar' } },
      vault: { name: 'Vault', description: 'Empty shelves.', exits: { south: 'hall' } },
      cellar: { name: 'Cellar', description: 'Damp.', exits: {} },
    },
    objects: {
      lamp: { name: 'lamp', location: 'hall' },
      chest: { name: 'chest', location: 'hall', scenery: true, container: true, openable: true },
    },
  });
  const y = (name: string) => Number(new RegExp(`<text x="[\\d.]+" y="([\\d.]+)" class="head"[^>]*>${name}<`).exec(svg)![1]);
  assert.ok(y('Vault') < y('Hall') && y('Hall') < y('Cellar'), 'north is up, and down goes below');
  assert.match(svg, /<tspan class="item">lamp<\/tspan>/);
  assert.match(svg, /<tspan class="scenery">chest<\/tspan>/);
  assert.match(svg, /<tspan class="exit">north<\/tspan>/);
  assert.match(svg, /<tspan class="missing">hatch<\/tspan>/, 'a noun nothing answers to is marked');
  assert.match(svg, /class="edge-gate"/);
  assert.match(svg, />chest open</, 'the gate shows its condition');
  assert.match(svg, /marker-end="url\(#arrow\)"/, 'the way down to the cellar is one way');
});

test('puzzles: needs come from conditions, from earlier rules, and from where things are', () => {
  const svg = draw('puzzles', {
    rooms: {
      hall: { name: 'Hall', exits: { north: { to: 'vault', if: { var: 'door.open' }, else: 'The door is shut.' } } },
      vault: { name: 'Vault', exits: { south: 'hall' } },
    },
    objects: {
      door: { name: 'door', location: 'hall', scenery: true, props: { open: false } },
      key: { name: 'brass key', nouns: ['key'], location: 'hall' },
      idol: { name: 'idol', location: 'vault', fixed: true },
      note: { name: 'note', location: 'hall', read: 'It says: the word is XYZZY-7.' },
    },
    verbs: { say: { patterns: ['say TEXT'] } },
    scores: { opened: 5, found: 10 },
    endings: { rich: { title: 'Rich', win: true } },
    rules: [
      { on: 'push', object: 'door', priority: 5, if: { not: { has: 'key' } }, say: 'It needs a key.' },
      { on: 'push', object: 'door', say: 'It swings open.', do: [{ set: 'door.open', to: true }, { award: 'opened' }] },
      { on: 'take', object: 'idol', say: 'Got it.', do: [{ award: 'found' }, { end: 'rich' }] },
      { on: 'say', topic: 'XYZZY-7', say: 'Something stirs.', do: [{ award: 'found' }] },
      { on: 'take', object: 'idol', say: 'Never reached.', do: [{ award: 'found' }] },
    ],
  });
  assert.match(svg, /&gt; take brass key/, 'the key is needed because the rule before says so');
  assert.match(svg, />carrying brass key</);
  assert.match(svg, /&gt; push door/);
  assert.match(svg, />door open</);
  assert.match(svg, /&gt; north to Vault/);
  assert.match(svg, />reach Vault</);
  assert.match(svg, /&gt; read note/);
  assert.match(svg, /knows &quot;XYZZY-7&quot;/);
  assert.match(svg, /END: Rich/);
  assert.doesNotMatch(svg, /Never reached/, 'a rule an earlier one always answers is left out');
});

test('talk: menus with every option, reply and destination; topics', () => {
  const svg = draw('talk', {
    rooms: { hall: { name: 'Hall' } },
    characters: {
      guard: {
        name: 'guard',
        location: 'hall',
        topics: [{ keys: ['gate'], text: 'Shut till dawn.' }],
      },
    },
    dialogues: {
      guard: {
        entry: [{ node: 'hello' }],
        nodes: {
          hello: {
            say: '"Halt."',
            options: [
              { id: 'pass', text: '"Let me pass."', reply: '"No."', then: 'why' },
              { id: 'bye', text: '"Never mind."', then: 'end' },
            ],
          },
          why: { say: '"Orders."', noLeave: true, options: [{ id: 'ok', text: '"Fine."', then: 'hello' }] },
        },
      },
    },
  });
  for (const text of ['TALK TO GUARD', '1. &quot;Let me pass.&quot;', '&quot;No.&quot;', '→ why', 'ends the talk', 'no leaving', 'ASK / TELL ABOUT', 'Shut till dawn.']) {
    assert.ok(svg.includes(text), `missing ${text}`);
  }
  assert.match(svg, /class="edge-soft"/, 'the way back to the first menu curves round');
});
