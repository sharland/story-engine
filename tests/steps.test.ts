// The step model: what must happen before what, and the validator's check
// that every ending and score item can be reached from the start.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compilePack, validate, type Issue, type PackSource } from '../src/engine/index.ts';
import { buildSteps, reachability, runForward } from '../src/engine/steps.ts';

const manifest = { format: 1, id: 'steps', title: 'Steps', version: '1', author: 'Tests', licence: 'CC0-1.0', start: 'hall' };

function pack(data: unknown, scripts: PackSource['scripts'] = []): PackSource {
  return { origin: 'memory', manifest, data: [{ file: 'world/main.json', content: data }], texts: [], scripts, walkthroughs: [] };
}

function warnings(issues: Issue[]): Issue[] {
  return issues.filter((i) => i.level === 'warning' && i.code !== 'no-walkthrough');
}

// A vault behind a locked door, with gold that wins the game.
function vault(keyIn: string): Record<string, unknown> {
  return {
    rooms: {
      hall: { name: 'Hall', exits: { north: { to: 'vault', door: 'door' } } },
      vault: { name: 'Vault', exits: { south: { to: 'hall', door: 'door' } } },
    },
    objects: {
      door: { name: 'door', foundIn: ['hall', 'vault'], door: true, openable: true, lockable: true, locked: true, key: 'key' },
      key: { name: 'key', location: keyIn },
      gold: { name: 'gold', location: 'vault' },
    },
    scores: { rich: 10 },
    endings: { won: { title: 'Won', win: true } },
    rules: [{ on: 'take', object: 'gold', do: [{ award: 'rich' }, { end: 'won' }] }],
  };
}

test('a key behind its own door: the winning ending and its score are unreachable, and the loop is named', () => {
  const r = validate(pack(vault('vault')));
  assert.equal(r.errors, 0);
  const [ending, score] = warnings(r.issues);
  assert.equal(ending.code, 'unwinnable');
  assert.match(ending.message, /^Winning ending "won" can never be reached: "take gold" needs reach Vault, /);
  assert.match(ending.message, /"unlock door with key" needs carrying key, "take key" needs reach Vault, which only "north through door" can make: a loop/);
  assert.equal(score.code, 'unreachable-score');
  assert.match(score.message, /^Score item "rich" can never be awarded/);
});

test('with the key outside, the same pack is winnable', () => {
  assert.deepEqual(warnings(validate(pack(vault('hall'))).issues), []);
});

test('a condition nothing sets is named, scripts are allowed for, and assumeAchievable quiets it', () => {
  const data = {
    rooms: { hall: { name: 'Hall' } },
    vars: { blessed: false },
    endings: { saved: { title: 'Saved', win: true }, lost: { title: 'Lost' } },
    verbs: { pray: { patterns: ['pray'] } },
    rules: [
      { on: 'pray', if: { var: 'blessed' }, do: [{ end: 'saved' }] },
      { on: 'wait', do: [{ end: 'lost' }] },
    ],
  };
  const plain = warnings(validate(pack(data)).issues);
  assert.equal(plain.length, 1);
  assert.match(plain[0].message, /"pray" needs blessed, and nothing in the pack makes that\. If a script/);

  const register = (api: { effect: (name: string, fn: () => void) => void }) => api.effect('chant', () => {});
  const scripted = warnings(validate(pack(data, [{ file: 'scripts/chant.js', module: { default: register as never } }])).issues);
  assert.match(scripted[0].message, /nothing in the pack makes that \(unless a script does\)/);

  const quiet = warnings(validate(pack({ ...data, validator: { assumeAchievable: ['saved'] } })).issues);
  assert.deepEqual(quiet, []);
});

test('standard actions count: switching on, unlocking and opening, dropping somewhere', () => {
  const data = {
    rooms: {
      hall: { name: 'Hall', exits: { up: { to: 'loft', if: { obj: 'ladder', in: 'hall' } } } },
      loft: { name: 'Loft', exits: { down: 'hall' } },
    },
    objects: {
      ladder: { name: 'ladder', location: 'loft' },
      lamp: { name: 'lamp', location: 'hall', switchable: true },
      chest: { name: 'chest', location: 'hall', container: true, openable: true, lockable: true, locked: true, key: 'key', fixed: true },
      key: { name: 'key', location: 'hall' },
    },
    scores: { lit: 1, opened: 1 },
    endings: { done: { title: 'Done', win: true } },
    verbs: { finish: { patterns: ['finish'] } },
    rules: [
      { on: 'wait', if: { var: 'lamp.on' }, do: [{ award: 'lit' }] },
      { on: 'wait', if: { var: 'chest.open' }, do: [{ award: 'opened' }] },
      { on: 'finish', if: { obj: 'ladder', in: 'hall' }, do: [{ end: 'done' }] },
    ],
    validator: { assumeReachable: ['loft'] },
  };
  const c = compilePack(pack(data));
  const steps = buildSteps(c.world!, c);
  for (const id of ['switch-on:lamp', 'unlock:chest:key', 'open:chest', 'drop:ladder:hall']) assert.ok(steps.has(id), `no step ${id}`);
  assert.deepEqual(warnings(validate(pack(data)).issues), []);
  const progress = runForward(c.world!, steps);
  assert.ok(progress.done.has('open:chest'));
});

test('a room two gates lead to lists both, so either will do', () => {
  const data = {
    rooms: {
      hall: { name: 'Hall', exits: { north: { to: 'yard', if: { var: 'bell' } }, east: { to: 'yard', if: { var: 'horn' } } } },
      yard: { name: 'Yard', exits: { south: 'hall' } },
    },
    vars: { bell: false, horn: false },
  };
  const c = compilePack(pack(data));
  const reach = reachability(c.world!, c);
  assert.deepEqual(reach.opens.get('yard'), ['hall:north', 'hall:east']);
  assert.equal(reach.opens.get('hall'), undefined);
});

test('validator.assumeAchievable must be a list of ids', () => {
  const r = validate(pack({ rooms: { hall: { name: 'Hall' } }, validator: { assumeAchievable: 'won' } }));
  assert.ok(r.issues.some((i) => i.level === 'error' && i.message.includes('Expected a list of ids')));
});
