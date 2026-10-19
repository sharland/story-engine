// Draw every diagram of the demo packs into docs/diagrams. The diagram test
// fails if these are out of date, so run this after changing a demo pack or
// the diagram code:
//
//   node scripts/diagrams.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DIAGRAMS, diagram } from '../src/diagram/index.ts';
import { compilePack } from '../src/engine/index.ts';
import { loadPack } from '../src/node/loader.ts';

const root = join(import.meta.dirname, '..');
export const DIAGRAM_PACKS = ['sorrow-creek', 'halcyon-relay'];
export const diagramsDir = join(root, 'docs', 'diagrams');

/** Every demo diagram: file name and SVG. */
export async function demoDiagrams(): Promise<Array<{ file: string; svg: string }>> {
  const out: Array<{ file: string; svg: string }> = [];
  for (const pack of DIAGRAM_PACKS) {
    const c = compilePack(await loadPack(join(root, 'packs', pack)));
    for (const kind of DIAGRAMS) out.push({ file: `${pack}-${kind}.svg`, svg: diagram(kind, c.world!, c) });
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  mkdirSync(diagramsDir, { recursive: true });
  for (const { file, svg } of await demoDiagrams()) {
    writeFileSync(join(diagramsDir, file), svg);
    console.log(`wrote docs/diagrams/${file}`);
  }
}
