// The command-line runner, driven through runCli with in-memory streams.

import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { after, test } from 'node:test';
import { runCli, wrap } from '../src/cli/main.ts';

const root = join(import.meta.dirname, '..');
const temp = mkdtempSync(join(tmpdir(), 'story-engine-cli-'));
after(() => rmSync(temp, { recursive: true, force: true }));

async function cli(argv: string[], input = ''): Promise<{ code: number; out: string; err: string }> {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = '';
  let err = '';
  stdout.on('data', (d) => (out += d));
  stderr.on('data', (d) => (err += d));
  stdin.end(input);
  const code = await runCli(argv, { stdin, stdout, stderr, isTTY: false, columns: 80 });
  return { code, out, err };
}

test('play reads piped commands and echoes them, from a pack outside the repository', async () => {
  const pack = join(temp, 'western');
  cpSync(join(root, 'packs', 'sorrow-creek'), pack, { recursive: true });
  const r = await cli(['play', pack, '--seed', '1'], 'w\nread poster\nquit\nlook\n');
  assert.equal(r.code, 0);
  assert.match(r.out, /^Ada Pruitt's best mare has bolted/);
  assert.match(r.out, /\n> w\nSheriff's Office\n/);
  assert.match(r.out, /\n> read poster\nREWARD\n/);
  assert.match(r.out, /\n> quit\nGoodbye\.\n$/, 'nothing after quit is played');
});

test('play saves to and restores from files', async () => {
  const saves = join(temp, 'saves');
  const first = await cli(['play', join(root, 'packs', 'sorrow-creek'), '--seed', '1', '--saves', saves], 'e\ntake rope\nsave mine\n');
  assert.match(first.out, /> save mine\nSaved\./);
  assert.ok(existsSync(join(saves, 'sorrow-creek-mine.sav.json')));
  const second = await cli(['play', join(root, 'packs', 'sorrow-creek'), '--seed', '9', '--saves', saves], 'restore mine\ni\n');
  assert.match(second.out, /> restore mine\nRestored\.\nLivery Stable/);
  assert.match(second.out, /> i\nYou are carrying:\n {2}a lariat/);
});

test('validate exits 0 for a good pack and 1 for a broken one, naming the problem', async () => {
  const good = await cli(['validate', join(root, 'packs', 'halcyon-relay')]);
  assert.equal(good.code, 0);
  assert.match(good.out, /walkthrough walkthroughs\/win\.txt: ok \(ending docked, score 50/);
  assert.match(good.out, /0 error\(s\), 0 warning\(s\)/);

  const broken = join(temp, 'broken');
  mkdirSync(join(broken, 'world'), { recursive: true });
  writeFileSync(
    join(broken, 'pack.json'),
    JSON.stringify({ format: 1, id: 'broken', title: 'B', version: '1', author: 'T', licence: 'CC0-1.0', start: 'hall' }),
  );
  writeFileSync(join(broken, 'world', 'rooms.json'), JSON.stringify({ rooms: { hall: { name: 'Hall', exits: { north: 'nowhere-at-all' } } } }));
  const bad = await cli(['validate', broken]);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /ERROR dangling-ref \(world\/rooms\.json: rooms\.hall\.exits\.north\): Unknown room "nowhere-at-all"/);

  const json = await cli(['validate', broken, '--json']);
  assert.equal(JSON.parse(json.out).errors, 1);

  writeFileSync(join(broken, 'world', 'rooms.json'), '{ "rooms": ');
  const unparseable = await cli(['validate', broken]);
  assert.equal(unparseable.code, 1);
  assert.match(unparseable.out, /ERROR bad-json \(world\/rooms\.json\)/);

  const refused = await cli(['play', broken]);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /has \d+ error/);
});

test('bundle writes one JSON file that plays like the directory', async () => {
  const file = join(temp, 'relay.json');
  const b = await cli(['bundle', join(root, 'packs', 'halcyon-relay'), '-o', file]);
  assert.equal(b.code, 0);
  const fromBundle = await cli(['play', file, '--seed', '3'], 'open locker\n');
  const fromDir = await cli(['play', join(root, 'packs', 'halcyon-relay'), '--seed', '3'], 'open locker\n');
  assert.equal(fromBundle.out, fromDir.out);
  assert.match(fromBundle.out, /Opening the storage locker reveals a hand torch and a photograph\./);
});

test('walkthrough prints transcripts and fails on a bad one', async () => {
  const ok = await cli(['walkthrough', join(root, 'packs', 'sorrow-creek')]);
  assert.equal(ok.code, 0);
  assert.match(ok.out, /=== walkthroughs\/win\.txt\n/);
  assert.match(ok.out, /ok: ending home, score 25/);
  const badFile = join(temp, 'bad-walkthrough.txt');
  writeFileSync(badFile, '# expect: home\nw\n');
  const bad = await cli(['walkthrough', join(root, 'packs', 'sorrow-creek'), badFile]);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /FAILED:\n {2}The game did not end; expected ending "home"/);
});

test('usage and errors', async () => {
  assert.equal((await cli([])).code, 0);
  assert.equal((await cli(['frobnicate', 'x'])).code, 2);
  assert.equal((await cli(['play', join(temp, 'no-such-pack')])).code, 2);
});

test('wrap keeps indentation and explicit line breaks', () => {
  assert.equal(wrap('one two three four', 9), 'one two\nthree\nfour');
  assert.equal(wrap('You are carrying:\n  a long rope coil', 12), 'You are\ncarrying:\n  a long\n  rope coil');
  assert.equal(wrap('unchanged', 0), 'unchanged');
});
