// Every tests/transcripts/*.txt file is played and compared line by line.
// Set UPDATE_TRANSCRIPTS=1 to rewrite them from the engine's current output
// (then read the diff before committing).

import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runTranscript } from './helpers/transcript.ts';

const dir = join(import.meta.dirname, 'transcripts');
const update = process.env.UPDATE_TRANSCRIPTS === '1';

for (const name of readdirSync(dir).filter((f) => f.endsWith('.txt')).sort()) {
  test(`transcript ${name}`, async () => {
    const mismatches = await runTranscript(join(dir, name), update);
    if (update) return;
    if (mismatches.length > 0) {
      const m = mismatches[0];
      assert.equal(
        m.actual,
        m.expected,
        `${name}:${m.line} ${m.command === null ? '(start)' : `> ${m.command}`} — ${mismatches.length} mismatch(es)`,
      );
    }
  });
}
