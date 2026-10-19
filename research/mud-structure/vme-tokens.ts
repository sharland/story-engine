// Tokenizer for DikuMUD III (VME) zone source. Strings are kept only as a
// word count, never as text, so later stages cannot leak them.

import { fingerprint, wordCount } from './model.ts';

export type Tok =
  | { k: 'str'; words: number; print: string; line: number }
  | { k: 'word'; v: string; line: number }
  | { k: 'punct'; v: string; line: number };

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let line = 1;
  let lineStart = true;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
      lineStart = true;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    // Preprocessor lines (#include, #define with "\" continuations) are skipped.
    if (lineStart && c === '#') {
      while (i < n) {
        const eol = src.indexOf('\n', i);
        const end = eol < 0 ? n : eol;
        const cont = src.slice(i, end).trimEnd().endsWith('\\');
        i = end;
        if (!cont || i >= n) break;
        i++;
        line++;
      }
      continue;
    }
    lineStart = false;
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      for (let j = i; j < stop; j++) if (src[j] === '\n') line++;
      i = stop;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '"') {
      const startLine = line;
      let j = i + 1;
      let text = '';
      while (j < n && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < n) {
          text += ' ';
          j += 2;
          continue;
        }
        if (src[j] === '\n') line++;
        text += src[j];
        j++;
      }
      out.push({ k: 'str', words: wordCount(text), print: fingerprint(text), line: startLine });
      i = j + 1;
      continue;
    }
    if ('{}();,=[]'.includes(c)) {
      out.push({ k: 'punct', v: c, line });
      i++;
      continue;
    }
    let j = i;
    while (j < n && !/[\s{}();,=[\]"]/.test(src[j])) j++;
    if (j === i) j = i + 1;
    out.push({ k: 'word', v: src.slice(i, j), line });
    i = j;
  }
  return out;
}
