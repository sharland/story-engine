// Pack themes: theme/theme.css and its fonts and images travel inline in the
// pack, so a bundle carries its skin and the page works from disk. Problems
// with a theme are reported like any other pack problem.

import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { inlineTheme, validate, type Issue } from '../src/engine/index.ts';
import { bundleForDisk, bundlePack, loadPack } from '../src/node/loader.ts';

const root = join(import.meta.dirname, '..');
const scratch = mkdtempSync(join(tmpdir(), 'story-engine-theme-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

test('url() references to theme files become data: URLs; others are kept or reported', () => {
  const assets = new Map([['fonts/a.woff2', 'AAAA'], ['art/sky.svg', 'PHN2Zz4=']]);
  const issues: Issue[] = [];
  const css = inlineTheme(
    [
      '@font-face { src: url("fonts/a.woff2"); }',
      'body { background: url(./art/sky.svg), url(\'data:image/png;base64,xx\'); }',
      'a { mask: url(#m); }',
      '.x { background: url(https://example.com/x.png); }',
      '.y { background: url(art/missing.png); }',
      '.z { background: url(../outside.png); }',
    ].join('\n'),
    assets,
    issues,
  );
  assert.match(css, /url\("data:font\/woff2;base64,AAAA"\)/);
  assert.match(css, /url\("data:image\/svg\+xml;base64,PHN2Zz4="\)/);
  assert.match(css, /url\('data:image\/png;base64,xx'\)/);
  assert.match(css, /url\(#m\)/);
  assert.deepEqual(
    issues.map((i) => `${i.level} ${i.code}`),
    ['warning theme-external', 'error theme-missing-asset', 'error theme-missing-asset'],
  );
  const imports: Issue[] = [];
  inlineTheme('@import url("more.css");', new Map(), imports);
  assert.equal(imports[0].code, 'theme-import');
});

for (const pack of ['sorrow-creek', 'halcyon-relay']) {
  test(`${pack}: its theme loads with every font and image inlined, and travels in the bundle`, async () => {
    const dir = join(root, 'packs', pack);
    const src = await loadPack(dir);
    const css = src.theme?.css ?? '';
    assert.match(css, /@font-face/);
    assert.equal((css.match(/url\("data:font\/woff2;base64,/g) ?? []).length, 2);
    assert.match(css, /url\("data:image\/svg\+xml;base64,/);
    const left = css.match(/url\(\s*(?!["']?(?:data:|#))[^)]*\)/);
    assert.equal(left, null, `a url() was left pointing at a file: ${left?.[0]}`);
    const bundle = bundleForDisk(await bundlePack(dir));
    assert.equal(bundle.theme?.css, css);
  });
}

test('a pack without a theme has none, and a bundle written to disk carries no theme field', async () => {
  const src = await loadPack(join(root, 'tests', 'fixtures', 'testbed'));
  assert.equal(src.theme, null);
  const bundle = bundleForDisk(await bundlePack(join(root, 'tests', 'fixtures', 'testbed')));
  assert.equal('theme' in bundle, false);
});

test('theme problems are reported by validate: missing assets, stray files', async () => {
  const dir = join(scratch, 'broken-theme');
  cpSync(join(root, 'tests', 'fixtures', 'tiny-example'), dir, { recursive: true });
  mkdirSync(join(dir, 'theme', 'fonts'), { recursive: true });
  writeFileSync(join(dir, 'theme', 'theme.css'), 'body { background: url("art/nope.png"); }\n');
  writeFileSync(join(dir, 'theme', 'fonts', 'OFL.txt'), 'licence text is allowed\n');
  writeFileSync(join(dir, 'theme', 'notes.docx'), 'not a theme file\n');
  const r = validate(await loadPack(dir), { play: false });
  const theme = r.issues.filter((i) => i.code.startsWith('theme-'));
  assert.deepEqual(
    theme.map((i) => `${i.level} ${i.code} ${i.where}`),
    ['warning theme-file theme/notes.docx', 'error theme-missing-asset theme/theme.css'],
  );
});
