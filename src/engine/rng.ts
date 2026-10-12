// The only source of randomness in the engine. The generator state is a
// single 32-bit integer kept in GameState.rng, so save, restore and undo
// restore the random sequence along with everything else.

/** Mulberry32 step: returns [value in [0, 1), next state]. */
export function nextRandom(state: number): [number, number] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let r = Math.imul(next ^ (next >>> 15), next | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  return [((r ^ (r >>> 14)) >>> 0) / 4294967296, next];
}

/** Turn any integer seed into a starting generator state. */
export function seedState(seed: number): number {
  return Math.trunc(seed) >>> 0;
}
