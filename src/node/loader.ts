// Read a pack from disk: either a pack directory or a bundle file. Works with
// any path, inside or outside this repository.

import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { isBundle, sourceFromBundle, type PackBundle } from '../engine/bundle.ts';
import { inlineTheme, THEME_NOTES, themeType } from '../engine/theme.ts';
import type { Issue, PackSource, ScriptModule } from '../engine/types.ts';

/** Import a script module from its source text, the same way the browser does. */
export async function importScriptSource(source: string, file: string): Promise<ScriptModule> {
  const tagged = `${source}\n//# sourceURL=${file}\n`;
  return (await import(`data:text/javascript;base64,${Buffer.from(tagged).toString('base64')}`)) as ScriptModule;
}

/** Load a pack directory or a bundle (.json) file. */
export async function loadPack(path: string): Promise<PackSource> {
  const abs = resolve(path);
  const info = await stat(abs);
  if (info.isFile()) {
    const bundle = JSON.parse(await readFile(abs, 'utf8')) as unknown;
    if (!isBundle(bundle)) throw new Error(`${path} is not a pack bundle`);
    return sourceFromBundle(bundle, importScriptSource, abs);
  }
  const bundle = await bundlePack(abs);
  const src = await sourceFromBundle(bundle, importScriptSource, abs);
  src.issues = [...(bundle as BundleWithIssues).loadIssues, ...(src.issues ?? [])];
  return src;
}

type BundleWithIssues = PackBundle & { loadIssues: Issue[] };

/** Read a pack directory into a single bundle object. */
export async function bundlePack(dir: string): Promise<PackBundle> {
  const root = resolve(dir);
  const loadIssues: Issue[] = [];
  const rel = (f: string) => relative(root, f).split(sep).join('/');

  let manifest: unknown = null;
  try {
    manifest = JSON.parse(await readFile(join(root, 'pack.json'), 'utf8'));
  } catch (e) {
    loadIssues.push({ level: 'error', code: 'bad-json', message: (e as Error).message, where: 'pack.json' });
  }

  const data: PackBundle['data'] = [];
  for (const f of await listFiles(join(root, 'world'), ['.json'])) {
    try {
      data.push({ file: rel(f), content: JSON.parse(await readFile(f, 'utf8')) });
    } catch (e) {
      loadIssues.push({ level: 'error', code: 'bad-json', message: (e as Error).message, where: rel(f) });
    }
  }
  const texts: PackBundle['texts'] = [];
  for (const f of await listFiles(join(root, 'text'), ['.txt'])) texts.push({ file: rel(f), content: await readFile(f, 'utf8') });
  const scripts: PackBundle['scripts'] = [];
  for (const f of await listFiles(join(root, 'scripts'), ['.js', '.mjs'])) {
    scripts.push({ file: rel(f), source: await readFile(f, 'utf8') });
  }
  const walkthroughs: PackBundle['walkthroughs'] = [];
  for (const f of await listFiles(join(root, 'walkthroughs'), ['.txt'])) {
    walkthroughs.push({ file: rel(f), content: await readFile(f, 'utf8') });
  }
  const bundle: BundleWithIssues = {
    bundleFormat: 1,
    origin: basename(root),
    manifest,
    data,
    texts,
    scripts,
    walkthroughs,
    theme: await readTheme(join(root, 'theme'), loadIssues),
    loadIssues,
  };
  return bundle;
}

/** theme/theme.css with its fonts and images inlined, or null if there is none. */
async function readTheme(dir: string, issues: Issue[]): Promise<{ css: string } | null> {
  let css: string;
  try {
    css = await readFile(join(dir, 'theme.css'), 'utf8');
  } catch {
    return null;
  }
  const assets = new Map<string, string>();
  for (const f of await listFiles(dir, [''])) {
    const path = relative(dir, f).split(sep).join('/');
    if (path === 'theme.css' || THEME_NOTES.some((x) => path.toLowerCase().endsWith(x))) continue;
    if (themeType(path)) assets.set(path, (await readFile(f)).toString('base64'));
    else issues.push({ level: 'warning', code: 'theme-file', message: 'Not a font or image a theme can use', where: `theme/${path}` });
  }
  return { css: inlineTheme(css, assets, issues) };
}

/** Strip loader-only fields before writing a bundle to disk. */
export function bundleForDisk(b: PackBundle): PackBundle {
  const { bundleFormat, origin, manifest, data, texts, scripts, walkthroughs, theme } = b;
  return { bundleFormat, origin, manifest, data, texts, scripts, walkthroughs, ...(theme ? { theme } : {}) };
}

/** Files under a directory with the given extensions, sorted by path. Missing directory: none. */
async function listFiles(dir: string, exts: string[]): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && exts.some((x) => e.name.endsWith(x)))
    .map((e) => join(e.parentPath, e.name))
    .sort();
}
