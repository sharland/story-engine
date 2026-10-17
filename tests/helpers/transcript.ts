// Transcript files: commands and the exact output expected for each, played
// against a fixed seed.
//
//   # pack: ../fixtures/testbed        (relative to the transcript file)
//   # seed: 1
//   <output expected from game start>
//   > first command
//   <expected output>
//
// Lines starting with "#" are comments. Blank lines are ignored when
// comparing, so they can be used for readability.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Game, loadWorld, renderBlocks, type World } from '../../src/engine/index.ts';
import { memoryHost } from '../../src/engine/walkthrough.ts';
import { loadPack } from '../../src/node/loader.ts';

export interface Segment {
  command: string | null;
  expected: string[];
  line: number;
  /** Comment lines written just before this command (or, for the start, the header). */
  comments: string[];
}

export interface Transcript {
  pack: string;
  seed: number;
  segments: Segment[];
}

export function parseTranscript(text: string, file: string): Transcript {
  let pack = '';
  let seed = 1;
  const segments: Segment[] = [{ command: null, expected: [], line: 1, comments: [] }];
  let comments: string[] = [];
  text.replace(/\r\n?/g, '\n').split('\n').forEach((line, i) => {
    const directive = /^#\s*(pack|seed)\s*:\s*(.+?)\s*$/.exec(line);
    if (directive) {
      if (directive[1] === 'pack') pack = resolve(dirname(file), directive[2]);
      else seed = Number(directive[2]);
      segments[0].comments.push(line);
      return;
    }
    if (line.startsWith('#')) {
      if (segments.length === 1 && segments[0].expected.length === 0) segments[0].comments.push(line);
      else comments.push(line);
      return;
    }
    if (line.startsWith('>')) {
      segments.push({ command: line.replace(/^> ?/, ''), expected: [], line: i + 1, comments });
      comments = [];
      return;
    }
    if (line.trim() !== '') segments[segments.length - 1].expected.push(line);
  });
  if (!pack) throw new Error(`${file}: missing "# pack:" line`);
  return { pack, seed, segments };
}

const worlds = new Map<string, Promise<World>>();
export function worldFor(path: string): Promise<World> {
  if (!worlds.has(path)) worlds.set(path, loadPack(path).then(loadWorld));
  return worlds.get(path)!;
}

export interface Mismatch {
  line: number;
  command: string | null;
  expected: string;
  actual: string;
}

/** Play a transcript. Returns mismatches; with update=true, rewrites the file instead. */
export async function runTranscript(file: string, update = false): Promise<Mismatch[]> {
  const text = await readFile(file, 'utf8');
  const t = parseTranscript(text, file);
  const game = new Game(await worldFor(t.pack), { seed: t.seed, host: memoryHost() });
  const mismatches: Mismatch[] = [];
  const actualBySegment: string[][] = [];
  for (const seg of t.segments) {
    const blocks = seg.command === null ? game.start() : game.input(seg.command);
    const actual = renderBlocks(blocks).split('\n').filter((l) => l.trim() !== '');
    actualBySegment.push(actual);
    if (actual.join('\n') !== seg.expected.join('\n')) {
      mismatches.push({ line: seg.line, command: seg.command, expected: seg.expected.join('\n'), actual: actual.join('\n') });
    }
  }
  if (update && mismatches.length > 0) {
    const out: string[] = [];
    t.segments.forEach((seg, i) => {
      if (seg.command !== null) out.push('');
      out.push(...seg.comments);
      if (seg.command !== null) out.push(`> ${seg.command}`);
      out.push(...actualBySegment[i]);
    });
    await writeFile(file, out.join('\n') + '\n');
  }
  return mismatches;
}
