// The browser front end: a terminal-style page that loads pack bundles and
// plays them with no server. The packs on offer are whatever the build put in
// packs.js (window.STORY_PACKS); the page itself knows no story.

import {
  Game,
  isBundle,
  loadWorld,
  PackError,
  sourceFromBundle,
  type Block,
  type Host,
  type PackBundle,
  type ScriptModule,
} from '../engine/index.ts';

interface PackEntry {
  id: string;
  title: string;
  bundle: PackBundle;
}

declare global {
  interface Window {
    STORY_PACKS?: PackEntry[];
    /** For automated tests: the running game. */
    storyEngine?: { game: Game | null };
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const output = $<HTMLDivElement>('output');
const form = $<HTMLFormElement>('command-form');
const input = $<HTMLInputElement>('command');
const select = $<HTMLSelectElement>('pack-select');
const statusRoom = $<HTMLSpanElement>('status-room');
const statusScore = $<HTMLSpanElement>('status-score');
const seedInfo = $<HTMLSpanElement>('seed-info');

let game: Game | null = null;
let transcript: string[] = [];
const commandHistory: string[] = [];
let historyIndex = 0;
window.storyEngine = { game: null };

// ---------------------------------------------------------------------------
// Loading packs

/** Turn script source into a module. Blob URLs first; data URLs if the page's origin refuses them. */
async function importScript(source: string): Promise<ScriptModule> {
  const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    return (await import(/* webpackIgnore: true */ blobUrl)) as ScriptModule;
  } catch {
    const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
    return (await import(/* webpackIgnore: true */ dataUrl)) as ScriptModule;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function storageHost(packId: string): Host {
  const key = (slot: string) => `story-engine:${packId}:${slot}`;
  return {
    save(slot, data) {
      try {
        localStorage.setItem(key(slot), data);
        return true;
      } catch {
        return false;
      }
    },
    load(slot) {
      try {
        return localStorage.getItem(key(slot));
      } catch {
        return null;
      }
    },
  };
}

async function startBundle(bundle: PackBundle, seed: number): Promise<void> {
  output.replaceChildren();
  transcript = [];
  game = null;
  window.storyEngine = { game: null };
  try {
    const world = loadWorld(await sourceFromBundle(bundle, importScript));
    game = new Game(world, { seed, host: storageHost(world.manifest.id) });
    window.storyEngine = { game };
    document.title = world.manifest.title;
    seedInfo.textContent = `${world.manifest.title} · seed ${seed}`;
    input.disabled = false;
    show(game.start());
  } catch (e) {
    const lines = e instanceof PackError
      ? e.issues.filter((i) => i.level === 'error').map((i) => `${i.where ?? ''}: ${i.message}`)
      : [String(e instanceof Error ? e.message : e)];
    show([{ style: 'heading', text: 'This pack could not be loaded.' }, ...lines.map((text) => ({ style: 'text' as const, text }))], 'b-error');
    input.disabled = true;
  }
  updateStatus();
  input.focus();
}

function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % 2147483647;
}

function currentParams(): { pack: string | null; seed: number | null } {
  const p = new URLSearchParams(location.search);
  const seed = p.get('seed');
  return { pack: p.get('pack'), seed: seed !== null && /^\d+$/.test(seed) ? Number(seed) : null };
}

async function startEntry(entry: PackEntry, seed = randomSeed()): Promise<void> {
  select.value = entry.id;
  try {
    // Keep pack and seed in the address so a session can be shared and replayed.
    window.history.replaceState(null, '', withParams(entry.id, seed));
  } catch {
    // Some file:// pages refuse; the game runs regardless.
  }
  await startBundle(entry.bundle, seed);
}

function withParams(pack: string, seed: number): string {
  const url = new URL(location.href);
  url.searchParams.set('pack', pack);
  url.searchParams.set('seed', String(seed));
  return url.toString();
}

// ---------------------------------------------------------------------------
// Output

function show(blocks: Block[], extraClass = ''): void {
  for (const b of blocks) {
    const p = document.createElement('p');
    p.className = `b-${b.style} ${extraClass}`.trim();
    p.textContent = b.text;
    output.append(p);
    transcript.push(b.text);
  }
  output.scrollTop = output.scrollHeight;
}

function echo(command: string): void {
  const p = document.createElement('p');
  p.className = 'echo';
  p.textContent = `> ${command}`;
  output.append(p);
  transcript.push('', `> ${command}`);
}

function updateStatus(): void {
  if (!game) {
    statusRoom.textContent = ' ';
    statusScore.textContent = '';
    return;
  }
  const room = game.world.rooms.get(game.state.location);
  statusRoom.textContent = game.isLit() ? (room?.name ?? '') : game.messageText('darkTitle');
  const s = game.state;
  statusScore.textContent = game.world.maxScore > 0 ? `Score ${s.score}/${game.world.maxScore} · Turns ${s.turns}` : `Turns ${s.turns}`;
}

// ---------------------------------------------------------------------------
// Pack folders chosen in the browser

async function bundleFromFolder(files: FileList): Promise<PackBundle> {
  const bundle: PackBundle = { bundleFormat: 1, manifest: null, data: [], texts: [], scripts: [], walkthroughs: [] };
  const entries = [...files]
    .map((f) => ({ f, path: (f.webkitRelativePath || f.name).split('/').slice(1).join('/') }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  for (const { f, path } of entries) {
    const text = await f.text();
    if (path === 'pack.json') bundle.manifest = JSON.parse(text);
    else if (path.startsWith('world/') && path.endsWith('.json')) bundle.data.push({ file: path, content: JSON.parse(text) });
    else if (path.startsWith('text/') && path.endsWith('.txt')) bundle.texts.push({ file: path, content: text });
    else if (path.startsWith('scripts/') && /\.m?js$/.test(path)) bundle.scripts.push({ file: path, source: text });
    else if (path.startsWith('walkthroughs/') && path.endsWith('.txt')) bundle.walkthroughs.push({ file: path, content: text });
  }
  if (bundle.manifest === null) throw new Error('The folder has no pack.json');
  return bundle;
}

// ---------------------------------------------------------------------------
// Wiring

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!game) return;
  const command = input.value;
  input.value = '';
  if (command.trim() !== '') {
    commandHistory.push(command);
    historyIndex = commandHistory.length;
  }
  echo(command);
  show(game.input(command));
  updateStatus();
  if (game.quitRequested) {
    input.disabled = true;
    show([{ style: 'parser', text: 'Choose New game to play again.' }]);
  }
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' && historyIndex > 0) {
    historyIndex -= 1;
    input.value = commandHistory[historyIndex];
    e.preventDefault();
  } else if (e.key === 'ArrowDown' && historyIndex < commandHistory.length) {
    historyIndex += 1;
    input.value = commandHistory[historyIndex] ?? '';
    e.preventDefault();
  }
});

$('terminal').addEventListener('click', () => {
  if (!window.getSelection()?.toString()) input.focus();
});

select.addEventListener('change', () => {
  const entry = (window.STORY_PACKS ?? []).find((p) => p.id === select.value);
  if (entry) void startEntry(entry);
});

$('new-game').addEventListener('click', () => {
  const entry = (window.STORY_PACKS ?? []).find((p) => p.id === select.value);
  if (entry) void startEntry(entry);
  else if (lastLoaded) void startBundle(lastLoaded, randomSeed());
});

$('transcript').addEventListener('click', () => {
  const blob = new Blob([`${transcript.join('\n')}\n`], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${game?.world.manifest.id ?? 'story'}-transcript.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

let lastLoaded: PackBundle | null = null;

$<HTMLInputElement>('pack-file').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const bundle = JSON.parse(await file.text()) as unknown;
    if (!isBundle(bundle)) throw new Error(`${file.name} is not a pack bundle`);
    lastLoaded = bundle;
    select.value = '';
    await startBundle(bundle, randomSeed());
  } catch (err) {
    show([{ style: 'text', text: `Could not open ${file.name}: ${(err as Error).message}` }], 'b-error');
  }
});

$<HTMLInputElement>('pack-folder').addEventListener('change', async (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (!files || files.length === 0) return;
  try {
    const bundle = await bundleFromFolder(files);
    lastLoaded = bundle;
    select.value = '';
    await startBundle(bundle, randomSeed());
  } catch (err) {
    show([{ style: 'text', text: `Could not open that folder: ${(err as Error).message}` }], 'b-error');
  }
});

// ---------------------------------------------------------------------------
// Start

const packs = window.STORY_PACKS ?? [];
for (const p of packs) {
  const option = document.createElement('option');
  option.value = p.id;
  option.textContent = p.title;
  select.append(option);
}
if (packs.length === 0) {
  show([{ style: 'text', text: 'No packs were built into this page. Use Open bundle… or Open folder… to load one.' }]);
  input.disabled = true;
} else {
  const params = currentParams();
  const entry = packs.find((p) => p.id === params.pack) ?? packs[0];
  void startEntry(entry, params.seed ?? randomSeed());
}

