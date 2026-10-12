// Developer helper: play a pack with commands from argv. Not shipped.
import { Game, renderBlocks, validate } from '../src/engine/index.ts';
import { loadPack } from '../src/node/loader.ts';
import { memoryHost } from '../src/engine/walkthrough.ts';

const [dir, ...cmds] = process.argv.slice(2);
const src = await loadPack(dir);
const report = validate(src, { play: false });
for (const i of report.issues) console.log(`[${i.level}] ${i.where ?? ''}: ${i.message}`);
if (!report.world || report.errors) process.exit(1);
const g = new Game(report.world, { seed: 1, host: memoryHost() });
console.log(renderBlocks(g.start()));
for (const c of cmds) {
  console.log(`\n> ${c}`);
  console.log(renderBlocks(g.input(c)));
}
