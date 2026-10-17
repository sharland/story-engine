// Build the static web site (site/) and a single-file CLI (dist/).
//
//   node scripts/build.ts            build both
//   node scripts/build.ts --site DIR build only the site, into DIR
//
// Every pack in packs/ is validated (walkthroughs included) and refused if it
// has errors. The page gets the packs through packs.js, a classic script,
// so it also works when opened straight from disk.

import { build, transform } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validate } from '../src/engine/index.ts';
import { bundleForDisk, bundlePack, loadPack } from '../src/node/loader.ts';

const root = resolve(import.meta.dirname, '..');

export async function buildSite(outDir: string, packsDir = join(root, 'packs')): Promise<string[]> {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  await build({
    entryPoints: [join(root, 'src/web/main.ts')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    outfile: join(outDir, 'app.js'),
    logLevel: 'warning',
  });
  for (const f of ['index.html', 'style.css']) copyFileSync(join(root, 'src/web', f), join(outDir, f));

  const entries = [];
  const compiled: string[] = [];
  for (const name of readdirSync(packsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    const dir = join(packsDir, name);
    const report = validate(await loadPack(dir));
    if (report.errors > 0) {
      throw new Error(`${name} has errors:\n${report.issues.filter((i) => i.level === 'error').map((i) => `  ${i.message}`).join('\n')}`);
    }
    const bundle = bundleForDisk(await bundlePack(dir));
    const manifest = bundle.manifest as { id: string; title: string };
    // Compile each script module into the page itself, so built-in packs never
    // need a runtime import (some hosts forbid importing from blob: or data: URLs).
    for (const s of bundle.scripts) {
      const { code } = await transform(s.source, { loader: 'js', format: 'iife', globalName: '__packScript', target: 'es2020' });
      compiled.push(`{ source: ${JSON.stringify(s.source)}, module: (function () {\n${code}\nreturn __packScript;\n})() }`);
    }
    writeFileSync(join(outDir, `${manifest.id}.pack.json`), JSON.stringify(bundle));
    entries.push({ id: manifest.id, title: manifest.title, bundle });
  }
  writeFileSync(
    join(outDir, 'packs.js'),
    `window.STORY_PACKS = ${JSON.stringify(entries)};\nwindow.STORY_SCRIPT_MODULES = [\n${compiled.join(',\n')}\n];\n`,
  );
  writeFileSync(join(outDir, '.nojekyll'), '');
  return entries.map((e) => e.id);
}

export async function buildCli(outFile: string): Promise<void> {
  await build({
    entryPoints: [join(root, 'src/cli/main.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: outFile,
    logLevel: 'warning',
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--site');
  if (i >= 0) {
    const ids = await buildSite(resolve(process.argv[i + 1] ?? 'site'));
    console.log(`Built site with packs: ${ids.join(', ')}`);
  } else {
    const ids = await buildSite(join(root, 'site'));
    console.log(`Built site/ with packs: ${ids.join(', ')}`);
    await buildCli(join(root, 'dist', 'story-engine.js'));
    console.log('Built dist/story-engine.js');
  }
}
