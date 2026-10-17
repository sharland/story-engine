#!/usr/bin/env node
// story-engine command line.
//
//   story-engine play <pack> [--seed N] [--saves DIR] [--width N]
//   story-engine validate <pack> [--no-play] [--json]
//   story-engine walkthrough <pack> [file...]
//   story-engine bundle <pack> [-o FILE]
//
// <pack> is a pack directory (anywhere on disk) or a bundle .json file.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { Game, loadWorld, PackError, validate, type Block, type Host } from '../engine/index.ts';
import { playWalkthrough } from '../engine/walkthrough.ts';
import { bundleForDisk, bundlePack, loadPack } from '../node/loader.ts';

export interface Io {
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  isTTY: boolean;
  columns: number;
}

const USAGE = `Usage:
  story-engine play <pack> [--seed N] [--saves DIR] [--width N]
      Play a pack. Reads commands from the keyboard, or from a pipe.
  story-engine validate <pack> [--no-play] [--json]
      Check a pack for errors and play its walkthroughs.
  story-engine walkthrough <pack> [file...]
      Play walkthroughs and print the full transcript.
  story-engine bundle <pack> [-o FILE]
      Write the pack as a single JSON bundle (what the web page loads).

<pack> is a pack directory or a bundle file, anywhere on disk.`;

interface Args {
  command: string | null;
  positional: string[];
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  const valued = new Set(['--seed', '--saves', '--width', '-o', '--out']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (valued.has(a)) flags.set(a, argv[++i] ?? '');
    else if (a.startsWith('-')) flags.set(a, true);
    else positional.push(a);
  }
  return { command: positional.shift() ?? null, positional, flags };
}

/** Wrap each output block to the terminal width, keeping indentation and line breaks. */
export function wrap(text: string, width: number): string {
  if (width <= 0) return text;
  return text
    .split('\n')
    .map((line) => {
      const indent = /^\s*/.exec(line)![0];
      const words = line.trim().split(/\s+/);
      const out: string[] = [];
      let current = indent;
      for (const w of words) {
        if (current.trim() !== '' && current.length + 1 + w.length > width) {
          out.push(current);
          current = indent + w;
        } else current = current.trim() === '' ? indent + w : `${current} ${w}`;
      }
      out.push(current);
      return out.join('\n');
    })
    .join('\n');
}

function fileHost(dir: string, packId: string): Host {
  const path = (slot: string) => join(dir, `${packId}-${slot.replace(/[^a-z0-9_-]+/gi, '_')}.sav.json`);
  return {
    save(slot, data) {
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(path(slot), data);
        return true;
      } catch {
        return false;
      }
    },
    load(slot) {
      const p = path(slot);
      return existsSync(p) ? readFileSync(p, 'utf8') : null;
    },
  };
}

export async function runCli(argv: string[], io: Io): Promise<number> {
  const out = (s: string) => io.stdout.write(s);
  const err = (s: string) => io.stderr.write(s);
  const args = parseArgs(argv);
  const packPath = args.positional[0];

  if (!args.command || args.flags.has('--help') || args.flags.has('-h') || !packPath) {
    (args.command && args.command !== 'help' ? err : out)(`${USAGE}\n`);
    return args.command && args.command !== 'help' ? 2 : 0;
  }

  let source;
  try {
    source = await loadPack(packPath);
  } catch (e) {
    err(`Cannot read pack ${packPath}: ${(e as Error).message}\n`);
    return 2;
  }

  switch (args.command) {
    case 'validate': {
      const report = validate(source, { play: !args.flags.has('--no-play') });
      if (args.flags.has('--json')) {
        out(`${JSON.stringify({ errors: report.errors, warnings: report.warnings, issues: report.issues }, null, 2)}\n`);
      } else {
        for (const i of report.issues) out(`${i.level.toUpperCase()} ${i.code}${i.where ? ` (${i.where})` : ''}: ${i.message}\n`);
        for (const w of report.walkthroughs) {
          out(`walkthrough ${w.file}: ${w.ok ? 'ok' : 'FAILED'} (ending ${w.ending ?? 'none'}, score ${w.score}, ${w.turns} turns)\n`);
        }
        out(`${report.errors} error(s), ${report.warnings} warning(s)\n`);
      }
      return report.errors > 0 ? 1 : 0;
    }

    case 'walkthrough': {
      let world;
      try {
        world = loadWorld(source);
      } catch (e) {
        err(`${(e as Error).message}\nRun "story-engine validate" for details.\n`);
        return 1;
      }
      // A named walkthrough is one of the pack's own ("talk", "talk.txt",
      // "walkthroughs/talk.txt"), or a file anywhere on disk.
      const files: Array<{ file: string; content: string }> = [];
      for (const f of args.positional.slice(1)) {
        const own = world.walkthroughs.find((w) => [w.file, w.file.replace(/^walkthroughs\//, ''), w.file.replace(/^walkthroughs\/|\.txt$/g, '')].includes(f));
        if (own) files.push(own);
        else if (existsSync(f)) files.push({ file: f, content: readFileSync(f, 'utf8') });
        else {
          err(`No walkthrough "${f}" in the pack or on disk.\n`);
          return 1;
        }
      }
      if (args.positional.length <= 1) files.push(...world.walkthroughs);
      let failed = 0;
      for (const w of files) {
        const r = playWalkthrough(world, w.content, w.file);
        out(`=== ${w.file}\n${r.transcript}\n\n`);
        out(r.ok ? `ok: ending ${r.ending}, score ${r.score}, ${r.turns} turns\n\n` : `FAILED:\n${r.problems.map((p) => `  ${p}`).join('\n')}\n\n`);
        if (!r.ok) failed++;
      }
      return failed > 0 ? 1 : 0;
    }

    case 'bundle': {
      const target = (args.flags.get('-o') ?? args.flags.get('--out')) as string | undefined;
      const report = validate(source, { play: false });
      if (report.errors > 0) {
        err(`Refusing to bundle a pack with ${report.errors} error(s). Run "story-engine validate ${packPath}".\n`);
        return 1;
      }
      const json = JSON.stringify(bundleForDisk(await bundlePack(packPath)));
      if (target) {
        writeFileSync(target, json);
        out(`Wrote ${target}\n`);
      } else out(`${json}\n`);
      return 0;
    }

    case 'play': {
      let world;
      try {
        world = loadWorld(source);
      } catch (e) {
        err(`${e instanceof PackError ? e.message : String(e)}\nRun "story-engine validate" for details.\n`);
        return 1;
      }
      const seedFlag = args.flags.get('--seed');
      const seed = typeof seedFlag === 'string' ? Number(seedFlag) : Math.floor(Math.random() * 2 ** 31);
      if (!Number.isFinite(seed)) {
        err('--seed must be a number\n');
        return 2;
      }
      const widthFlag = args.flags.get('--width');
      const width = typeof widthFlag === 'string' ? Number(widthFlag) : io.isTTY ? Math.min(io.columns, 100) : 0;
      const savesFlag = args.flags.get('--saves');
      const saves = resolve(typeof savesFlag === 'string' ? savesFlag : '.');
      const game = new Game(world, { seed, host: fileHost(saves, world.manifest.id) });
      const show = (blocks: Block[]) => {
        if (blocks.length > 0) out(`${blocks.map((b) => wrap(b.text, width)).join('\n')}\n`);
      };
      if (io.isTTY) out(`[seed ${seed}]\n\n`);
      show(game.start());
      const rl = createInterface({ input: io.stdin, output: io.isTTY ? io.stdout : undefined, terminal: io.isTTY });
      const prompt = () => {
        if (io.isTTY) {
          out('\n');
          rl.setPrompt('> ');
          rl.prompt();
        }
      };
      prompt();
      for await (const line of rl) {
        if (!io.isTTY) out(`\n> ${line}\n`);
        show(game.input(line));
        if (game.quitRequested) break;
        prompt();
      }
      rl.close();
      return 0;
    }

    default:
      err(`Unknown command "${args.command}".\n${USAGE}\n`);
      return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const code = await runCli(process.argv.slice(2), {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    isTTY: !!process.stdin.isTTY && !!process.stdout.isTTY,
    columns: process.stdout.columns ?? 80,
  });
  process.exitCode = code;
}
