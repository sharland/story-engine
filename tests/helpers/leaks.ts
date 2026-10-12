// Collects what a pack contributes (identifiers, names, prose) and searches
// engine source for any of it. Used by tests/leaks.test.ts.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACT_SPEC,
  CHARACTER_SPEC,
  DIRECTION_SPEC,
  ENDING_SPEC,
  EVENT_SPEC,
  MANIFEST_SPEC,
  OBJECT_SPEC,
  REGION_SPEC,
  ROOM_SPEC,
  RULE_SPEC,
  SECTIONS,
  VERB_SPEC,
} from '../../src/engine/schema.ts';
import { STANDARD_DIRECTIONS, STANDARD_MESSAGES, STANDARD_PROPS, STANDARD_VERBS } from '../../src/engine/stdlib.ts';
import type { PackSource } from '../../src/engine/types.ts';

export interface PackContent {
  identifiers: Set<string>;
  names: Set<string>;
  phrases: Set<string>;
}

/**
 * Words the engine owns, which a pack may reuse as ids without that being a
 * leak: standard verbs, directions, messages and properties, the pack
 * format's own field and section names, TypeScript keywords and browser
 * globals (a pack may well call an object "case" or "window", or a verb "type").
 */
export const ENGINE_WORDS = new Set<string>([
  ...Object.keys(STANDARD_VERBS),
  ...Object.keys(STANDARD_DIRECTIONS),
  ...Object.keys(STANDARD_MESSAGES),
  ...STANDARD_PROPS,
  ...SECTIONS,
  ...[ROOM_SPEC, OBJECT_SPEC, CHARACTER_SPEC, ACT_SPEC, RULE_SPEC, EVENT_SPEC, ENDING_SPEC, VERB_SPEC, DIRECTION_SPEC, REGION_SPEC, MANIFEST_SPEC]
    .flatMap((spec) => Object.keys(spec.fields)),
  ...['break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'delete', 'do', 'else', 'export', 'false',
    'for', 'function', 'if', 'import', 'in', 'let', 'new', 'null', 'return', 'switch', 'this', 'throw', 'true', 'try',
    'type', 'typeof', 'var', 'void', 'while'],
  // Browser globals that are also ordinary words a story might use.
  ...['window', 'document', 'history', 'location', 'navigator', 'console', 'screen', 'event'],
]);

/** Every identifier, display name and 5-word phrase a pack defines. */
export function packContent(src: PackSource): PackContent {
  const identifiers = new Set<string>();
  const names = new Set<string>();
  const strings: string[] = [];
  const addId = (id: unknown) => {
    if (typeof id === 'string' && !ENGINE_WORDS.has(id)) identifiers.add(id);
  };
  const m = src.manifest as Record<string, unknown>;
  addId(m.id);
  names.add(String(m.title));
  const walk = (v: unknown, key: string | null) => {
    if (typeof v === 'string') {
      if (key === 'name' || key === 'title') names.add(v);
      if (key === 'id') addId(v);
      strings.push(v);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, k);
    }
  };
  for (const { content } of src.data) {
    const d = content as Record<string, Record<string, unknown> | unknown[]>;
    for (const [section, body] of Object.entries(d)) {
      if (section === 'messages') continue; // keys are the engine's own message names
      if (body && !Array.isArray(body) && typeof body === 'object') Object.keys(body).forEach(addId);
      walk(body, null);
    }
  }
  for (const t of src.texts) {
    for (const line of t.content.split('\n')) {
      const h = /^==\s*(\S+)\s*==/.exec(line);
      if (h) addId(h[1]);
      else strings.push(line);
    }
  }
  for (const s of src.scripts) {
    // Script names are pack identifiers too; find them by registering against a recorder.
    s.module.default({
      condition: (n: string) => addId(n),
      effect: (n: string) => addId(n),
      action: (n: string) => addId(n),
    });
  }
  const phrases = new Set<string>();
  for (const raw of strings) {
    // Template tags such as {the:noun} are engine syntax, not pack prose.
    const s = raw.replace(/\{[^}]*\}/g, ' ');
    const words = s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
    for (let i = 0; i + 5 <= words.length; i++) phrases.add(words.slice(i, i + 5).join(' '));
  }
  return { identifiers, names, phrases };
}

/** All engine source files: everything under src/. */
export function engineSources(root: string): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|js|html|css)$/.test(e.name)) out.push({ file: p, text: readFileSync(p, 'utf8') });
    }
  };
  walk(root);
  return out;
}

export interface Leak {
  file: string;
  kind: 'identifier' | 'name' | 'phrase';
  value: string;
}

export function findLeaks(content: PackContent, sources: Array<{ file: string; text: string }>): Leak[] {
  const leaks: Leak[] = [];
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const { file, text } of sources) {
    const flat = text.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ');
    for (const id of content.identifiers) {
      // Whole identifiers only; a contraction such as "won't" is not the id "won".
      const re = new RegExp(`(?<![A-Za-z0-9_-])(?<![A-Za-z]')${escape(id)}(?![A-Za-z0-9_-])(?!'[A-Za-z])`, 'i');
      if (re.test(text)) leaks.push({ file, kind: 'identifier', value: id });
    }
    for (const name of content.names) {
      if (ENGINE_WORDS.has(name.toLowerCase())) continue;
      const re = new RegExp(`(?<![A-Za-z0-9])${escape(name)}(?![A-Za-z0-9])`, 'i');
      if (re.test(text)) leaks.push({ file, kind: 'name', value: name });
    }
    for (const p of content.phrases) if (flat.includes(p)) leaks.push({ file, kind: 'phrase', value: p });
  }
  return leaks;
}
