// A neutral model of a MUD world's structure, which every format is read into.
// It keeps ids and numbers only: no titles, descriptions or keywords survive
// parsing, so nothing written from this model can carry a corpus's text.

export interface MudWorld {
  /** Short label for the corpus, chosen by whoever runs the analysis. */
  corpus: string;
  zones: Map<string, MudZone>;
  rooms: Map<string, MudRoom>;
  mobs: Map<string, MudMob>;
  objs: Map<string, MudObj>;
  placements: Placement[];
  /** Counts of things the parser skipped or could not place, for honesty in the report. */
  skipped: Record<string, number>;
}

export interface MudZone {
  id: string;
  rooms: string[];
  /** Minutes between resets, where the format records it. */
  lifespan: number | null;
}

export interface MudRoom {
  id: string;
  zone: string;
  dark: boolean | null;
  death: boolean | null;
  indoors: boolean | null;
  sector: string | null;
  /** Words in the room's main description. */
  descWords: number;
  /** A fingerprint of the description (not the text), to find rooms that share one. */
  descPrint: string;
  /** Extra descriptions: details the player can examine. */
  extras: number;
  /** A script or special routine is attached to the room. */
  scripted: boolean;
  exits: MudExit[];
}

export interface MudExit {
  dir: string;
  /** Target room id, or null if it leads nowhere the parser could resolve. */
  to: string | null;
  door: boolean;
  closed: boolean;
  locked: boolean;
  pickproof: boolean;
  /** Key object id, if the door has one. */
  key: string | null;
}

export interface MudMob {
  id: string;
  level: number | null;
  aggressive: boolean | null;
  /** Never moves of its own accord. */
  sentinel: boolean | null;
  /** Has a special routine or script. */
  special: boolean | null;
}

export interface MudObj {
  id: string;
  type: string | null;
  extras: number;
  takeable: boolean | null;
}

/** Something the zone resets put into a room, directly or carried. */
export interface Placement {
  kind: 'mob' | 'obj';
  what: string;
  room: string;
  via: 'room' | 'mob' | 'container';
}

export function emptyWorld(corpus: string): MudWorld {
  return { corpus, zones: new Map(), rooms: new Map(), mobs: new Map(), objs: new Map(), placements: [], skipped: {} };
}

export function skip(w: MudWorld, what: string): void {
  w.skipped[what] = (w.skipped[what] ?? 0) + 1;
}

/** FNV-1a over the description's words, lower-cased: equal for identical text, nothing more. */
export function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (const ch of s.toLowerCase().split(/\s+/).filter(Boolean).join(' ')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

export function wordCount(s: string): number {
  return s.split(/\s+/).filter((x) => /[A-Za-z]/.test(x)).length;
}
