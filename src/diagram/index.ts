// Diagrams of a pack, as SVG: the map, the puzzle chart and the conversations.
// Platform-free, like the engine: they take a compiled world and return text.

import type { CompileResult } from '../engine/pack.ts';
import type { World } from '../engine/types.ts';
import { mapDiagram } from './map.ts';
import { puzzlesDiagram } from './puzzles.ts';
import { talkDiagram } from './talk.ts';

export const DIAGRAMS = ['map', 'puzzles', 'talk'] as const;
export type DiagramKind = (typeof DIAGRAMS)[number];

export function diagram(kind: DiagramKind, w: World, c: Pick<CompileResult, 'moves' | 'playerMoves'>): string {
  if (kind === 'map') return mapDiagram(w, c);
  if (kind === 'puzzles') return puzzlesDiagram(w, c);
  return talkDiagram(w);
}
