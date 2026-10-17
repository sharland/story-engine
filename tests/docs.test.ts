// The documentation must not drift from the engine: the guide's example pack
// is a real, validated fixture; its reference tables are the standard
// library's; every format field, condition and effect is documented; and the
// DESIGN.md worked example is the tiny-example fixture.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { validate } from '../src/engine/index.ts';
import {
  ACT_SPEC,
  CHARACTER_SPEC,
  CONDITION_FORMS,
  DIRECTION_SPEC,
  EFFECT_FORMS,
  ENDING_SPEC,
  EVENT_SPEC,
  MANIFEST_SPEC,
  OBJECT_SPEC,
  REGION_SPEC,
  ROOM_SPEC,
  RULE_SPEC,
  SECTIONS,
  VERB_SPEC,
} from '../src/engine/schema.ts';
import { loadPack } from '../src/node/loader.ts';
import { messageTable, verbTable } from '../scripts/reference.ts';

const root = join(import.meta.dirname, '..');
const guide = readFileSync(join(root, 'docs', 'WRITING-A-PACK.md'), 'utf8');
const design = readFileSync(join(root, 'docs', 'DESIGN.md'), 'utf8');

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)));
}

test('the guide shows every file of its example pack, verbatim', () => {
  const dir = join(root, 'tests', 'fixtures', 'guide-example');
  for (const f of filesUnder(dir)) {
    const content = readFileSync(join(dir, f), 'utf8').trimEnd();
    assert.ok(guide.includes(`\`${f}\`:\n\n\`\`\``), `the guide does not introduce ${f}`);
    assert.ok(guide.includes(`\n${content}\n\`\`\``), `the guide's copy of ${f} differs from tests/fixtures/guide-example/${f}`);
  }
});

test('the guide example validates cleanly and its walkthroughs reach both endings', async () => {
  const r = validate(await loadPack(join(root, 'tests', 'fixtures', 'guide-example')));
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.walkthroughs.map((w) => [w.ending, w.ok]).sort(), [['on-the-road', true], ['stranded', true]]);
  const win = r.walkthroughs.find((w) => w.ending === 'on-the-road')!;
  assert.ok(guide.includes(`\`\`\`\n${win.transcript}\n\`\`\``), 'the transcript shown in the guide is not what the example produces');
});

test('the guide appendices are the standard library', () => {
  assert.ok(guide.includes(verbTable()), 'Appendix A is out of date: regenerate with node scripts/reference.ts verbs');
  assert.ok(guide.includes(messageTable()), 'Appendix B is out of date: regenerate with node scripts/reference.ts messages');
});

test('every field, section, condition and effect of the pack format is documented', () => {
  const specs = { ROOM_SPEC, OBJECT_SPEC, CHARACTER_SPEC, ACT_SPEC, RULE_SPEC, EVENT_SPEC, ENDING_SPEC, VERB_SPEC, DIRECTION_SPEC, REGION_SPEC, MANIFEST_SPEC };
  const missing: string[] = [];
  for (const [name, spec] of Object.entries(specs)) {
    for (const field of Object.keys(spec.fields)) if (!guide.includes(`\`${field}\``)) missing.push(`${name}.${field}`);
  }
  for (const s of SECTIONS) if (!guide.includes(`\`${s}\``)) missing.push(`section ${s}`);
  for (const c of Object.keys(CONDITION_FORMS)) if (!guide.includes(`{"${c}"`)) missing.push(`condition ${c}`);
  for (const e of Object.keys(EFFECT_FORMS)) if (!guide.includes(`{"${e}"`)) missing.push(`effect ${e}`);
  assert.deepEqual(missing, []);
});

test('the DESIGN.md worked example is the tiny-example fixture', () => {
  const dir = join(root, 'tests', 'fixtures', 'tiny-example');
  for (const f of filesUnder(dir)) {
    const content = readFileSync(join(dir, f), 'utf8').trimEnd();
    assert.ok(design.includes(content), `DESIGN.md's copy of ${f} differs from tests/fixtures/tiny-example/${f}`);
  }
});
