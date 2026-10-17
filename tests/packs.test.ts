// Every shipped pack must validate cleanly, every walkthrough must reach its
// ending, at least one must win with the full score, and packs must load
// from outside the repository and from a single-file bundle.

import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { loadWorld, sourceFromBundle, validate } from '../src/engine/index.ts';
import { playWalkthrough } from '../src/engine/walkthrough.ts';
import { bundleForDisk, bundlePack, importScriptSource, loadPack } from '../src/node/loader.ts';

const root = join(import.meta.dirname, '..');
const packsDir = join(root, 'packs');
const packs = readdirSync(packsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();

test('there are two demo packs', () => {
  assert.deepEqual(packs, ['halcyon-relay', 'sorrow-creek']);
});

for (const name of packs) {
  const dir = join(packsDir, name);

  test(`${name}: validates with no errors and no warnings`, async () => {
    const r = validate(await loadPack(dir));
    assert.deepEqual(r.issues, []);
  });

  test(`${name}: every walkthrough reaches its ending, and one wins with the full score`, async () => {
    const r = validate(await loadPack(dir));
    assert.ok(r.walkthroughs.length > 0);
    for (const w of r.walkthroughs) assert.ok(w.ok, `${w.file}: ${w.problems.join('; ')}`);
    const world = r.world!;
    const wins = r.walkthroughs.filter((w) => w.ending && world.endings.get(w.ending)?.win && w.score === world.maxScore);
    assert.ok(wins.length > 0, 'no walkthrough wins with the full score');
  });

  test(`${name}: is CC0 with the licence text alongside`, () => {
    const manifest = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8'));
    assert.equal(manifest.licence, 'CC0-1.0');
    assert.match(readFileSync(join(dir, 'LICENSE'), 'utf8'), /CC0 1\.0 Universal/);
  });
}

const temp = mkdtempSync(join(tmpdir(), 'story-engine-external-'));
after(() => rmSync(temp, { recursive: true, force: true }));

test('a pack loads and plays from a directory outside the repository', async () => {
  for (const name of packs) {
    const outside = join(temp, `copy-of-${name}`);
    cpSync(join(packsDir, name), outside, { recursive: true });
    assert.ok(!outside.startsWith(root), 'the copy must be outside the repository');
    const r = validate(await loadPack(outside));
    assert.equal(r.errors, 0);
    assert.ok(r.walkthroughs.every((w) => w.ok));
  }
});

test('a pack bundle (the browser format) plays exactly like the directory it came from', async () => {
  for (const name of packs) {
    const dir = join(packsDir, name);
    const fromDir = loadWorld(await loadPack(dir));
    const bundle = JSON.parse(JSON.stringify(bundleForDisk(await bundlePack(dir))));
    const fromBundle = loadWorld(await sourceFromBundle(bundle, importScriptSource));
    for (const w of fromDir.walkthroughs) {
      const a = playWalkthrough(fromDir, w.content, w.file);
      const b = playWalkthrough(fromBundle, w.content, w.file);
      assert.ok(a.ok);
      assert.equal(b.transcript, a.transcript);
    }
  }
});
