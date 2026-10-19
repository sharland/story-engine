// A pack bundle is a whole pack in one JSON file: what the browser loads, and
// what `story-engine bundle <dir>` writes. Script modules travel as source text
// and are turned back into modules by a platform-specific importer.

import type { Issue, PackSource, ScriptModule } from './types.ts';

export interface PackBundle {
  bundleFormat: 1;
  origin?: string;
  manifest: unknown;
  data: Array<{ file: string; content: unknown }>;
  texts: Array<{ file: string; content: string }>;
  scripts: Array<{ file: string; source: string }>;
  walkthroughs: Array<{ file: string; content: string }>;
  /** theme/theme.css with its assets already inlined (see theme.ts). */
  theme?: { css: string } | null;
}

export type ScriptImporter = (source: string, file: string) => Promise<ScriptModule>;

export function isBundle(v: unknown): v is PackBundle {
  return typeof v === 'object' && v !== null && (v as { bundleFormat?: unknown }).bundleFormat === 1;
}

export async function sourceFromBundle(bundle: PackBundle, importScript: ScriptImporter, origin?: string): Promise<PackSource> {
  const issues: Issue[] = [];
  const scripts: PackSource['scripts'] = [];
  for (const s of bundle.scripts) {
    try {
      scripts.push({ file: s.file, module: await importScript(s.source, s.file) });
    } catch (e) {
      issues.push({ level: 'error', code: 'bad-script', message: `Could not load script: ${(e as Error).message}`, where: s.file });
    }
  }
  return {
    origin: origin ?? bundle.origin ?? 'bundle',
    manifest: bundle.manifest,
    data: bundle.data,
    texts: bundle.texts,
    scripts,
    walkthroughs: bundle.walkthroughs,
    theme: bundle.theme ?? null,
    issues,
  };
}
