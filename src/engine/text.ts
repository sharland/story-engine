// Text files, passage references and message templates.
//
// A text file holds passages:
//
//   == passage-key ==
//   First paragraph, which may be
//   wrapped over several lines.
//
//   Second paragraph.
//   | A line kept as it is,
//   | for verse or letters.
//
// Data refers to a passage as "@passage-key". "@@" at the start of a string
// stands for a literal "@".

import type { Issue } from './types.ts';

const HEADER = /^==\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*==\s*$/;

export function parsePassages(content: string, file: string, into: Map<string, string>, issues: Issue[]): void {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  let key: string | null = null;
  let body: string[] = [];
  const flush = () => {
    if (key === null) return;
    if (into.has(key)) {
      issues.push({ level: 'error', code: 'duplicate-passage', message: `Passage "${key}" is defined more than once`, where: file });
    }
    into.set(key, formatPassage(body));
  };
  lines.forEach((line, i) => {
    const m = HEADER.exec(line);
    if (m) {
      flush();
      key = m[1];
      body = [];
    } else if (key === null) {
      if (line.trim() !== '') {
        issues.push({
          level: 'error',
          code: 'text-outside-passage',
          message: `Line ${i + 1} is outside any "== key ==" passage`,
          where: file,
        });
      }
    } else {
      body.push(line);
    }
  });
  flush();
}

/** Join wrapped lines into paragraphs; keep "|" lines as separate lines. */
export function formatPassage(lines: string[]): string {
  const paragraphs: string[] = [];
  let current: string[] = [];
  let currentKept = false;
  const end = () => {
    if (current.length > 0) paragraphs.push(current.join(currentKept ? '\n' : ' '));
    current = [];
    currentKept = false;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      end();
      continue;
    }
    const kept = /^\s*\|/.test(line);
    if (current.length > 0 && kept !== currentKept) {
      // Mixing wrapped and kept lines in one paragraph: keep the break.
      paragraphs.push(current.join(currentKept ? '\n' : ' '));
      current = [];
    }
    currentKept = kept;
    current.push(kept ? line.replace(/^\s*\|\s?/, '') : line.trim());
  }
  end();
  return paragraphs.join('\n\n');
}

/** If a string is a passage reference, return its key. */
export function passageRef(s: string): string | null {
  if (s.startsWith('@@')) return null;
  if (s.startsWith('@')) return s.slice(1);
  return null;
}

export function unescapeAt(s: string): string {
  return s.startsWith('@@') ? s.slice(1) : s;
}

export interface TemplateToken {
  tag: string;
  ref: string | null;
  raw: string;
}

const TEMPLATE = /\{([A-Za-z]+)(?::([A-Za-z0-9_.-]+))?\}/g;

/** Find every {tag} or {tag:ref} in a string. "{{" and "}}" are literal braces. */
export function templateTokens(s: string): TemplateToken[] {
  const out: TemplateToken[] = [];
  const cleaned = s.replace(/\{\{|\}\}/g, '  ');
  for (const m of cleaned.matchAll(TEMPLATE)) out.push({ tag: m[1], ref: m[2] ?? null, raw: m[0] });
  return out;
}

export function fillTemplate(s: string, resolve: (tag: string, ref: string | null) => string | null): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s.startsWith('{{', i)) {
      out += '{';
      i += 2;
      continue;
    }
    if (s.startsWith('}}', i)) {
      out += '}';
      i += 2;
      continue;
    }
    if (s[i] === '{') {
      TEMPLATE.lastIndex = i;
      const m = TEMPLATE.exec(s);
      if (m && m.index === i) {
        const value = resolve(m[1], m[2] ?? null);
        out += value ?? m[0];
        i += m[0].length;
        continue;
      }
    }
    out += s[i];
    i += 1;
  }
  return out;
}

/** Split printed text into output blocks (paragraphs). */
export function toBlocks(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+\n/g, '\n').trim())
    .filter((p) => p.length > 0);
}

export function capitalise(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/** "a, b and c" */
export function joinList(items: string[], conjunction = 'and'): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`;
}

/** Lower-case words of a name, as the parser sees them. */
export function nameWords(s: string): string[] {
  return normaliseWords(s);
}

export function normaliseWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

/** Levenshtein distance, for "did you mean" suggestions. */
export function editDistance(a: string, b: string): number {
  const d: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}

export function suggest(word: string, options: Iterable<string>): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const o of options) {
    const dist = editDistance(word, o);
    if (dist < bestD) {
      bestD = dist;
      best = o;
    }
  }
  return best !== null && bestD <= Math.max(2, Math.floor(word.length / 3)) ? best : null;
}

/** A topic key matches if all its words appear in what the player typed. */
export function matchTopic(keys: string[], topic: string | null): boolean {
  if (!topic) return false;
  const words = new Set(normaliseWords(topic));
  return keys.some((k) => {
    const kw = normaliseWords(k);
    return kw.length > 0 && kw.every((w) => words.has(w));
  });
}
