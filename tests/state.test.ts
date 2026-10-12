// Reproducibility, save/restore and undo, tested through the public Game API.

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { Game, renderBlocks } from '../src/engine/index.ts';
import { memoryHost } from '../src/engine/walkthrough.ts';
import { worldFor } from './helpers/transcript.ts';

const testbed = join(import.meta.dirname, 'fixtures', 'testbed');
// Enough turns for the wandering cat to use the random generator many times.
const COMMANDS = ['w', 'e', 'e', 'take apple', 'w', 'w', 'give apple to gardener', 'z', 'z', 'z', 'n', 's', 'e', 'z', 'z'];

async function play(seed: number, commands: string[]): Promise<string> {
  const g = new Game(await worldFor(testbed), { seed, host: memoryHost() });
  const out = [renderBlocks(g.start())];
  for (const c of commands) out.push(`> ${c}`, renderBlocks(g.input(c)));
  return out.join('\n');
}

test('a session is reproducible from its seed and commands', async () => {
  assert.equal(await play(7, COMMANDS), await play(7, COMMANDS));
});

test('different seeds give different random events', async () => {
  const outputs = new Set<string>();
  for (const seed of [1, 2, 3, 4, 5]) outputs.add(await play(seed, COMMANDS));
  assert.ok(outputs.size > 1, 'the wandering cat should move differently under different seeds');
});

test('game state is plain JSON', async () => {
  const g = new Game(await worldFor(testbed), { seed: 3 });
  g.start();
  for (const c of COMMANDS) g.input(c);
  assert.deepEqual(JSON.parse(JSON.stringify(g.state)), g.state);
});

test('saving, then restoring into a fresh game, continues exactly as an unbroken session', async () => {
  const world = await worldFor(testbed);
  const half = COMMANDS.slice(0, 7);
  const rest = COMMANDS.slice(7);

  const unbroken = new Game(world, { seed: 11 });
  unbroken.start();
  for (const c of half) unbroken.input(c);
  const expected = rest.map((c) => renderBlocks(unbroken.input(c)));

  const first = new Game(world, { seed: 11 });
  first.start();
  for (const c of half) first.input(c);
  const saved = first.saveState();

  const second = new Game(world, { seed: 999 });
  second.start();
  second.restoreState(saved);
  assert.deepEqual(rest.map((c) => renderBlocks(second.input(c))), expected);
  assert.deepEqual(second.state, unbroken.state);
});

test('restore refuses a save from another pack or another version', async () => {
  const g = new Game(await worldFor(testbed), { seed: 1 });
  g.start();
  const s = JSON.parse(g.saveState());
  assert.throws(() => g.restoreState(JSON.stringify({ ...s, pack: { id: 'other', version: '1.0.0' } })), /different story/);
  assert.throws(() => g.restoreState(JSON.stringify({ ...s, pack: { id: 'testbed', version: '0.9' } })), /version 0\.9/);
  assert.throws(() => g.restoreState('{"format": 2}'), /not a saved game/);
});

test('undo restores the exact previous state, including the random generator', async () => {
  const g = new Game(await worldFor(testbed), { seed: 5 });
  g.start();
  g.input('w');
  const before = structuredClone(g.state);
  const firstTry = renderBlocks(g.input('e'));
  g.input('undo');
  assert.deepEqual(g.state, before);
  assert.equal(renderBlocks(g.input('e')), firstTry);
});

test('undo goes back at most undoDepth turns', async () => {
  const g = new Game(await worldFor(testbed), { seed: 1, undoDepth: 3 });
  g.start();
  for (let i = 0; i < 5; i++) g.input('z');
  const said = [1, 2, 3, 4].map(() => renderBlocks(g.input('undo')));
  assert.deepEqual(said, ['Previous turn undone.', 'Previous turn undone.', 'Previous turn undone.', 'There is nothing to undo.']);
  assert.equal(g.state.turns, 2);
});
