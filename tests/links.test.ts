// Every link to a heading in the documentation goes somewhere: "#anchor"
// within a file, or "file.md#anchor" to another, using GitHub's heading ids.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';

const root = join(import.meta.dirname, '..');

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (['node_modules', '.git', 'site', 'dist'].includes(e.name)) return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? markdownFiles(p) : e.name.endsWith('.md') ? [p] : [];
  });
}

/** Heading ids as GitHub makes them: lower case, punctuation dropped, spaces to hyphens, repeats numbered. */
function headingIds(file: string): Set<string> {
  const ids = new Set<string>();
  const seen = new Map<string, number>();
  let fenced = false;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    const m = fenced ? null : /^#{1,6}\s+(.*)$/.exec(line);
    if (!m) continue;
    const id = m[1].trim().toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, '').replace(/ /g, '-');
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    ids.add(n === 0 ? id : `${id}-${n}`);
  }
  return ids;
}

test('links to headings in the documentation all resolve', () => {
  const broken: string[] = [];
  const files = markdownFiles(root);
  assert.ok(files.length >= 5);
  for (const file of files) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\]\(([^)\s#]*)#([^)\s]+)\)/g)) {
      const target = m[1] === '' ? file : resolve(dirname(file), m[1]);
      if (!target.endsWith('.md') || !existsSync(target)) continue;
      if (!headingIds(target).has(m[2])) broken.push(`${relative(root, file)}: #${m[2]} in ${relative(root, target)}`);
    }
  }
  assert.deepEqual(broken, []);
});
