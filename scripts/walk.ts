// Developer helper: validate a pack and print walkthrough transcripts.
import { validate } from '../src/engine/index.ts';
import { loadPack } from '../src/node/loader.ts';
const src = await loadPack(process.argv[2]);
const r = validate(src);
for (const i of r.issues) console.log(`[${i.level}] ${i.where ?? ''}: ${i.message}`);
for (const w of r.walkthroughs) {
  console.log(`\n=== ${w.file}: ${w.ok ? 'OK' : 'FAIL'} ending=${w.ending} score=${w.score} turns=${w.turns}`);
  if (process.argv[3] === '-v') console.log(w.transcript);
}
