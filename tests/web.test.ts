// The static web page, in a real headless Chromium: opened straight from disk
// (no server at all) and served over HTTP the way GitHub Pages serves it.
// Each demo pack's walkthrough is typed into the page and the page's output
// must equal the same session played by the engine in Node.
//
// If no browser can be launched the tests are skipped, unless
// REQUIRE_BROWSER=1 (as in CI), when that is a failure.

import assert from 'node:assert/strict';
import { readFileSync, createReadStream, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { loadWorld } from '../src/engine/index.ts';
import { parseWalkthrough, playWalkthrough } from '../src/engine/walkthrough.ts';
import { loadPack } from '../src/node/loader.ts';
import { buildSite } from '../scripts/build.ts';

const root = join(import.meta.dirname, '..');
const site = mkdtempSync(join(tmpdir(), 'story-engine-site-'));
let browser: Browser | null = null;
let server: Server | null = null;
let httpBase = '';
let skip: string | false = false;

before(async () => {
  await buildSite(site);
  try {
    browser = await chromium.launch();
  } catch (e) {
    if (process.env.REQUIRE_BROWSER === '1') throw e;
    skip = `no browser available: ${(e as Error).message.split('\n')[0]}`;
  }
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  server = createServer((req, res) => {
    // Under /strict/, serve with a policy that forbids blob: and data: scripts.
    let pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    const strict = pathname.startsWith('/strict/');
    if (strict) pathname = pathname.slice('/strict'.length);
    const path = join(site, pathname.replace(/^\/$/, '/index.html'));
    if (!path.startsWith(site) || !existsSync(path)) {
      res.writeHead(404).end();
      return;
    }
    const headers: Record<string, string> = { 'content-type': types[extname(path)] ?? 'application/octet-stream' };
    if (strict) headers['content-security-policy'] = "script-src 'self' 'unsafe-inline'";
    res.writeHead(200, headers);
    createReadStream(path).pipe(res);
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const addr = server.address();
  httpBase = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

after(async () => {
  await browser?.close();
  server?.close();
  rmSync(site, { recursive: true, force: true });
});

async function open(url: string): Promise<Page> {
  const page = await browser!.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelectorAll('#output p').length > 0);
  assert.deepEqual(errors, []);
  return page;
}

async function type(page: Page, command: string): Promise<void> {
  const before = await page.locator('#output p').count();
  await page.fill('#command', command);
  await page.press('#command', 'Enter');
  await page.waitForFunction((n) => document.querySelectorAll('#output p').length > n, before);
}

async function outputText(page: Page): Promise<string> {
  return (await page.locator('#output p').allTextContents()).join('\n');
}

const fileUrl = (query: string) => `${pathToFileURL(join(site, 'index.html')).href}?${query}`;

for (const [pack, walkthrough] of [
  ['halcyon-relay', 'walkthroughs/win.txt'],
  ['sorrow-creek', 'walkthroughs/whistle.txt'],
] as const) {
  test(`${pack}: the winning walkthrough, typed into the page opened from disk, matches Node exactly`, async (t) => {
    if (skip) return t.skip(skip);
    const content = readFileSync(join(root, 'packs', pack, walkthrough), 'utf8');
    const w = parseWalkthrough(content);
    const expected = playWalkthrough(loadWorld(await loadPack(join(root, 'packs', pack))), content, walkthrough);
    assert.ok(expected.ok);
    const page = await open(fileUrl(`pack=${pack}&seed=${w.seed}`));
    for (const c of w.commands) await type(page, c);
    assert.equal(await outputText(page), expected.transcript.split('\n').filter((l) => l !== '').join('\n'));
    assert.match(await page.locator('#status-score').textContent() ?? '', new RegExp(`^Score ${expected.score}/${expected.score} `));
    await page.close();
  });
}

test('conversation options are buttons: clicking them gives the same transcript as typing the numbers', async (t) => {
  if (skip) return t.skip(skip);
  const file = 'walkthroughs/talk.txt';
  const content = readFileSync(join(root, 'packs/sorrow-creek', file), 'utf8');
  const expected = playWalkthrough(loadWorld(await loadPack(join(root, 'packs/sorrow-creek'))), content, file);
  assert.ok(expected.ok, expected.problems.join('\n'));
  // Node's transcript shows "> 3 (@ada.whistle)"; the page shows what was sent, "> 3".
  const transcript = expected.transcript.replace(/^> (\d+) \(@[^)]+\)$/gm, '> $1');
  const numbers = [...expected.transcript.matchAll(/^> (\d+) \(@[^)]+\)$/gm)].map((m) => m[1]);
  assert.equal(numbers.length, 4);
  const page = await open(fileUrl(`pack=sorrow-creek&seed=${parseWalkthrough(content).seed}`));
  for (const c of parseWalkthrough(content).commands) {
    if (!c.startsWith('@')) {
      await type(page, c);
      continue;
    }
    const before = await page.locator('#output p').count();
    await page.locator(`#output button.option[data-option="${numbers.shift()}"]:not([disabled])`).click();
    await page.waitForFunction((n) => document.querySelectorAll('#output p').length > n, before);
  }
  assert.equal(await outputText(page), transcript.split('\n').filter((l) => l !== '').join('\n'));
  // Only the newest menu's buttons work; earlier ones went stale.
  assert.equal(await page.locator('#output button.option:not([disabled])').count(), 0);
  assert.ok((await page.locator('#output button.option[disabled]').count()) > 10);
  await page.close();
});

test('served over HTTP: the pack picker switches packs, and save and restore use browser storage', async (t) => {
  if (skip) return t.skip(skip);
  const page = await open(`${httpBase}/?pack=sorrow-creek&seed=4`);
  assert.match(await outputText(page), /^Ada Pruitt's best mare has bolted/);
  await type(page, 'e');
  await type(page, 'take rope');
  await type(page, 'save');
  await type(page, 'drop rope');
  await type(page, 'restore');
  await type(page, 'i');
  assert.match(await outputText(page), /> i\nYou are carrying:\n {2}a lariat$/);
  assert.match(await page.locator('#status-room').textContent() ?? '', /Livery Stable/);

  await page.selectOption('#pack-select', 'halcyon-relay');
  await page.waitForFunction(() => document.querySelector('#output p')?.textContent?.startsWith('The alarm wakes you'));
  assert.match(page.url(), /pack=halcyon-relay/);
  await page.close();
});

test('a bundle file chosen in the page loads and plays', async (t) => {
  if (skip) return t.skip(skip);
  const page = await open(fileUrl('pack=halcyon-relay&seed=1'));
  await page.setInputFiles('#pack-file', join(site, 'sorrow-creek.pack.json'));
  await page.waitForFunction(() => document.querySelector('#output p')?.textContent?.startsWith("Ada Pruitt's"));
  await type(page, 'whistle');
  assert.match(await outputText(page), /> whistle\nYour whistle carries down the street\. Nothing comes of it\.$/);
  await page.close();
});

test('a pack folder chosen in the page loads and plays, scripts included', async (t) => {
  if (skip) return t.skip(skip);
  const page = await open(fileUrl('pack=halcyon-relay&seed=1'));
  await page.setInputFiles('#pack-folder', join(root, 'packs', 'sorrow-creek'));
  await page.waitForFunction(() => document.querySelector('#output p')?.textContent?.startsWith("Ada Pruitt's"));
  await type(page, 'whistle');
  assert.match(await outputText(page), /> whistle\nYour whistle carries down the street\. Nothing comes of it\.$/);
  await page.close();
});

test('built-in pack scripts work under a policy that forbids blob: and data: scripts', async (t) => {
  if (skip) return t.skip(skip);
  const page = await open(`${httpBase}/strict/?pack=sorrow-creek&seed=1`);
  for (const c of ['w', 'open jar', 'take sugar', 'e', 's', 'give sugar to mare', 'n', 'whistle']) await type(page, c);
  assert.match(await outputText(page), /> whistle\nYou put two fingers to your lips and whistle\. A moment later the mare trots up/);
  await page.close();
});
