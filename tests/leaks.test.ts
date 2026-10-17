// The engine must contain no story content: no identifier, name or phrase
// from any pack may appear anywhere in src/. Words the engine itself owns
// (standard verbs, field names, TypeScript keywords) are listed in
// tests/helpers/leaks.ts and may be reused by packs.

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadPack } from '../src/node/loader.ts';
import { engineSources, findLeaks, packContent } from './helpers/leaks.ts';

const root = join(import.meta.dirname, '..');
const sources = engineSources(join(root, 'src'));
const packs = ['packs/halcyon-relay', 'packs/sorrow-creek', 'tests/fixtures/testbed', 'tests/fixtures/tiny-example'];

test('engine source is scanned', () => {
  assert.ok(sources.length >= 15, `only ${sources.length} source files found`);
});

for (const p of packs) {
  test(`engine source mentions nothing from ${p}`, async () => {
    const content = packContent(await loadPack(join(root, p)));
    assert.ok(content.identifiers.size > 5 && content.phrases.size > 10, 'pack content was collected');
    const leaks = findLeaks(content, sources);
    assert.deepEqual(
      leaks.map((l) => `${l.file.slice(root.length + 1)}: ${l.kind} "${l.value}"`),
      [],
    );
  });
}

test('the leak detector does find planted content', async () => {
  const content = packContent(await loadPack(join(root, 'packs/sorrow-creek')));
  const planted = [
    { file: 'fake/a.ts', text: "if (room === 'main-street') return;" },
    { file: 'fake/b.ts', text: '// Ada Pruitt says hello' },
    { file: 'fake/c.ts', text: "say('The stable smells of hay and harness oil.')" },
  ];
  const kinds = findLeaks(content, planted).map((l) => `${l.file} ${l.kind}`);
  assert.ok(kinds.includes('fake/a.ts identifier'));
  assert.ok(kinds.includes('fake/b.ts name'));
  assert.ok(kinds.includes('fake/c.ts phrase'));
});
