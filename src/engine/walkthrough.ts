// Walkthrough files: a list of commands that must reach a named ending.
//
//   # expect: rescued        the ending id this walkthrough must reach (required)
//   # seed: 7                random seed (default 1)
//   # score: 50              final score to check (optional)
//   take the first thing
//   north
//   @guard.ask-name          choose a conversation option by id, whatever its number
//
// Blank lines and other "#" lines are ignored.

import { Game, renderBlocks } from './game.ts';
import type { World } from './types.ts';

export interface Walkthrough {
  seed: number;
  expect: string | null;
  score: number | null;
  commands: string[];
}

export interface WalkthroughResult {
  file: string;
  ok: boolean;
  problems: string[];
  ending: string | null;
  score: number;
  turns: number;
  transcript: string;
}

export function parseWalkthrough(content: string): Walkthrough {
  const w: Walkthrough = { seed: 1, expect: null, score: null, commands: [] };
  for (const raw of content.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('#')) {
      const m = /^#\s*(expect|seed|score)\s*:\s*(\S+)\s*$/i.exec(line);
      if (m) {
        const key = m[1].toLowerCase();
        if (key === 'expect') w.expect = m[2];
        else if (key === 'seed') w.seed = Number(m[2]);
        else w.score = Number(m[2]);
      }
      continue;
    }
    w.commands.push(line);
  }
  return w;
}

export function playWalkthrough(world: World, content: string, file: string): WalkthroughResult {
  const w = parseWalkthrough(content);
  const problems: string[] = [];
  const game = new Game(world, { seed: w.seed, host: memoryHost() });
  const lines: string[] = [renderBlocks(game.start())];
  w.commands.forEach((cmd, i) => {
    if (game.ended && i < w.commands.length) {
      if (problems.length === 0 || !problems[problems.length - 1].startsWith('The game ended')) {
        problems.push(`The game ended before command ${i + 1} ("${cmd}")`);
      }
      return;
    }
    let typed = cmd;
    const option = /^@([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(cmd);
    if (option) {
      const n = game.optionNumber(option[1]);
      if (n === null) {
        problems.push(`Command ${i + 1} ("${cmd}"): that option is not on screen`);
        return;
      }
      typed = String(n);
    }
    const blocks = game.input(typed);
    lines.push(`> ${typed === cmd ? cmd : `${typed} (${cmd})`}`, renderBlocks(blocks));
    const parserTrouble = blocks.find((b) => b.style === 'parser');
    if (parserTrouble) problems.push(`Command ${i + 1} ("${cmd}"): ${parserTrouble.text}`);
  });
  const ending = game.state.ended?.ending ?? null;
  if (w.expect === null) problems.push('The walkthrough has no "# expect: <ending>" line');
  else if (ending !== w.expect) {
    problems.push(ending ? `Reached ending "${ending}", expected "${w.expect}"` : `The game did not end; expected ending "${w.expect}"`);
  }
  if (w.score !== null && game.state.score !== w.score) problems.push(`Final score ${game.state.score}, expected ${w.score}`);
  return {
    file,
    ok: problems.length === 0,
    problems,
    ending,
    score: game.state.score,
    turns: game.state.turns,
    transcript: lines.join('\n'),
  };
}

/** Saves kept in memory: for tests, walkthroughs and the validator. */
export function memoryHost(): { save(slot: string, data: string): boolean; load(slot: string): string | null } {
  const slots = new Map<string, string>();
  return {
    save: (slot, data) => {
      slots.set(slot, data);
      return true;
    },
    load: (slot) => slots.get(slot) ?? null,
  };
}
