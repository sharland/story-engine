// Engine behaviours that are easiest to pin down with a tiny pack built in
// memory. Each test is a regression test for a problem found in review.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game, loadWorld, renderBlocks, validate, type PackSource } from '../src/engine/index.ts';

function pack(data: Record<string, unknown>, extra: Partial<PackSource> = {}): PackSource {
  return {
    origin: 'memory',
    manifest: { format: 1, id: 'mem', title: 'Mem', version: '1', author: 'Tests', licence: 'CC0-1.0', start: 'hall' },
    data: [{ file: 'world/main.json', content: data }],
    texts: [],
    scripts: [],
    walkthroughs: [],
    ...extra,
  };
}

function play(src: PackSource, commands: string[]): string[] {
  const g = new Game(loadWorld(src), { seed: 1 });
  g.start();
  return commands.map((c) => renderBlocks(g.input(c)));
}

const hall = { hall: { name: 'Hall', exits: { north: 'yard' } }, yard: { name: 'Yard', exits: { south: 'hall' } } };

test('a rule on the verb "turn" replaces its default, and every-turn rules run once a turn', () => {
  const src = pack({
    rooms: hall,
    vars: { ticks: 0 },
    objects: { wheel: { name: 'wheel', location: 'hall', fixed: true } },
    rules: [
      { on: 'turn', object: 'wheel', say: 'The wheel creaks round.' },
      { on: 'everyTurn', do: [{ inc: 'ticks' }] },
    ],
  });
  const g = new Game(loadWorld(src), { seed: 1 });
  g.start();
  assert.equal(renderBlocks(g.input('turn wheel')), 'The wheel creaks round.');
  assert.equal(g.get('ticks'), 1);
  g.input('z');
  assert.equal(g.get('ticks'), 2);
});

test('a lock with no key never asks for one', () => {
  const src = pack({
    rooms: { hall: { name: 'Hall', exits: { north: { to: 'yard', door: 'gate' } } }, yard: { name: 'Yard', exits: { south: { to: 'hall', door: 'gate' } } } },
    objects: { gate: { name: 'gate', door: true, locked: true, lockable: true, foundIn: ['hall', 'yard'] } },
  });
  assert.deepEqual(play(src, ['unlock gate', 'open gate', 'north']), [
    'There is no keyhole in the gate.',
    'It seems to be locked.',
    'The gate is locked.',
  ]);
});

test('articles in topic keys are ignored, as they are in what the player types', () => {
  const src = pack({
    rooms: hall,
    characters: { miller: { name: 'miller', location: 'hall', topics: [{ keys: ['the old mill'], text: 'It burned down.' }] } },
  });
  assert.deepEqual(play(src, ['ask miller about the old mill', 'ask miller about old mill']), ['It burned down.', 'It burned down.']);
});

test('"once" topics with the same id on two characters, and a rule with that id, are independent', () => {
  const src = pack({
    rooms: hall,
    characters: {
      ada: { name: 'Ada', location: 'hall', topics: [{ id: 'secret', keys: ['secret'], once: true, text: 'Ada whispers.' }] },
      bob: { name: 'Bob', location: 'hall', topics: [{ id: 'secret', keys: ['secret'], once: true, text: 'Bob whispers.' }] },
    },
    rules: [{ id: 'secret', on: 'jump', once: true, say: 'You jump once.' }],
  });
  assert.deepEqual(play(src, ['jump', 'ask ada about secret', 'ask bob about secret', 'ask ada about secret']), [
    'You jump once.',
    'Ada whispers.',
    'Bob whispers.',
    'Ada has nothing to say about that.',
  ]);
});

test('an object a rule gives the player loses its initial text', () => {
  const src = pack({
    rooms: hall,
    objects: { coin: { name: 'coin', initial: 'A coin glints on the floor.' } },
    rules: [{ on: 'jump', do: [{ move: 'coin', to: 'player' }] }],
  });
  const out = play(src, ['jump', 'north', 'drop coin', 'look']);
  assert.equal(out[3], 'Yard\nYou can see a coin here.');
});

test('a script can move things to "nowhere" and "here"', () => {
  const src = pack(
    {
      rooms: hall,
      objects: { coin: { name: 'coin', location: 'hall' }, bell: { name: 'bell', location: 'yard' } },
      verbs: { vanish: { patterns: ['vanish'] } },
      rules: [{ on: 'vanish', do: [{ script: 'shuffle' }, { if: { obj: 'coin', in: 'nowhere' }, then: [{ say: 'The coin is gone.' }] }] }],
    },
    {
      scripts: [
        {
          file: 'scripts/s.js',
          module: {
            default: (api) =>
              api.effect('shuffle', (ctx) => {
                ctx.move('coin', 'nowhere');
                ctx.move('bell', 'here');
              }),
          },
        },
      ],
    },
  );
  assert.deepEqual(play(src, ['vanish', 'look']), ['The coin is gone.', 'Hall\nYou can see a bell here.']);
});

test('validator: templates inside passages are checked', () => {
  const r = validate(
    pack({ rooms: { hall: { name: 'Hall', description: '@hall' } } }, {
      texts: [{ file: 'text/t.txt', content: '== hall ==\nYou see {the:nosuchthing} and {var:nosuchvar}.' }],
    }),
  );
  assert.ok(r.issues.some((i) => i.code === 'dangling-ref' && i.message.includes('"nosuchthing"') && i.where === 'text/t.txt: hall'), JSON.stringify(r.issues));
  assert.ok(r.issues.some((i) => i.code === 'undeclared-var' && i.message.includes('"nosuchvar"')));
});

test('validator: assumeUsed silences unused-content warnings for things only scripts use', () => {
  const data = {
    rooms: hall,
    endings: { quiet: { title: 'Quiet', win: true } },
    validator: { assumeUsed: ['quiet', 'spare'] },
  };
  const r = validate(pack(data, { texts: [{ file: 'text/t.txt', content: '== spare ==\nUnused.' }] }));
  assert.deepEqual(r.issues.map((i) => i.code), ['no-walkthrough']);
});

test('validator: a "default" on a standard verb is reported as ignored', () => {
  const r = validate(pack({ rooms: hall, verbs: { push: { default: 'Pushing is rude.' } } }));
  assert.ok(r.issues.some((i) => i.code === 'verb-default' && i.message.includes('"push" is a standard verb')));
});
