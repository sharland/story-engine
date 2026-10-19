// The browser front end: a terminal-style page that loads pack bundles and
// plays them with no server. The packs on offer are whatever the build put in
// packs.js (window.STORY_PACKS); the page itself knows no story.

import {
  Game,
  inlineTheme,
  isBundle,
  loadWorld,
  PackError,
  sourceFromBundle,
  themeType,
  type Block,
  type Host,
  type Issue,
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
    /** Script modules of the built-in packs, compiled into the page by the build. */
    STORY_SCRIPT_MODULES?: Array<{ source: string; module: ScriptModule }>;
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
const themeStyle = document.createElement('style');
themeStyle.id = 'pack-theme';
document.head.append(themeStyle);

let game: Game | null = null;
let transcript: string[] = [];
const commandHistory: string[] = [];
let historyIndex = 0;
window.storyEngine = { game: null };

// ---------------------------------------------------------------------------
// Loading packs

/**
 * Turn script source into a module: a copy compiled into the page if there is
 * one, else a blob: URL import, else a data: URL import.
 */
async function importScript(source: string): Promise<ScriptModule> {
  const built = window.STORY_SCRIPT_MODULES?.find((m) => m.source === source);
  if (built) return built.module;
  const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    return (await import(/* webpackIgnore: true */ blobUrl)) as ScriptModule;
  } catch {
    const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
    try {
      return (await import(/* webpackIgnore: true */ dataUrl)) as ScriptModule;
    } catch {
      throw new Error('this page is not allowed to load script files from a pack (the built-in packs still work)');
    }
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

/**
 * A pack's theme replaces the look of the whole page. While one is on,
 * <html> carries data-skin="pack" (so the default light scheme stands aside)
 * and data-pack="<pack id>".
 */
function applyTheme(css: string | null, packId: string | null): void {
  themeStyle.textContent = css ?? '';
  const root = document.documentElement;
  if (css) root.dataset.skin = 'pack';
  else delete root.dataset.skin;
  if (packId) root.dataset.pack = packId;
  else delete root.dataset.pack;
}

async function startBundle(bundle: PackBundle, seed: number): Promise<void> {
  output.replaceChildren();
  transcript = [];
  game = null;
  window.storyEngine = { game: null };
  applyTheme(null, null);
  try {
    const world = loadWorld(await sourceFromBundle(bundle, importScript));
    applyTheme(bundle.theme?.css ?? null, world.manifest.id);
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
    const option = b.style === 'option' ? /^(\s*)(\S.*)$/s.exec(b.text) : null;
    if (option) {
      // A menu line. Its leading spaces stay in the text (for copying) but are
      // hidden; CSS indents the line instead, so a long option wraps in place.
      const indent = document.createElement('span');
      indent.className = 'indent';
      indent.textContent = option[1];
      if (typeof b.option === 'number') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'option';
        button.dataset.option = String(b.option);
        button.textContent = option[2];
        button.addEventListener('click', () => submit(String(b.option)));
        p.append(indent, button);
      } else {
        p.classList.add('locked');
        p.append(indent, option[2]);
      }
    } else p.textContent = b.text;
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
  // Reads "Score 5/25 · Turns 12". Each part has its own class so a theme can
  // relabel or hide it; data-padded holds the number as six digits.
  const s = game.state;
  const parts: Node[] = [];
  if (game.world.maxScore > 0) {
    parts.push(stat('score', 'Score', s.score, `/${game.world.maxScore}`), span('sep', ' · '));
  }
  parts.push(stat('turns', 'Turns', s.turns, ''));
  statusScore.replaceChildren(...parts);
}

function span(cls: string, text: string): HTMLSpanElement {
  const e = document.createElement('span');
  e.className = cls;
  e.textContent = text;
  return e;
}

function stat(kind: string, label: string, n: number, max: string): HTMLSpanElement {
  const value = span('value', String(n));
  value.dataset.padded = String(Math.max(0, n)).padStart(6, '0');
  const e = document.createElement('span');
  e.className = `stat stat-${kind}`;
  e.append(span('label', label), ' ', value);
  if (max) e.append(span('max', max));
  return e;
}

// ---------------------------------------------------------------------------
// Pack folders chosen in the browser

async function bundleFromFolder(files: FileList): Promise<PackBundle> {
  const bundle: PackBundle = { bundleFormat: 1, manifest: null, data: [], texts: [], scripts: [], walkthroughs: [] };
  const entries = [...files]
    .map((f) => ({ f, path: (f.webkitRelativePath || f.name).split('/').slice(1).join('/') }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  let themeCss: string | null = null;
  const themeAssets = new Map<string, string>();
  for (const { f, path } of entries) {
    if (path.startsWith('theme/')) {
      const name = path.slice('theme/'.length);
      if (name === 'theme.css') themeCss = await f.text();
      else if (themeType(name)) themeAssets.set(name, toBase64(new Uint8Array(await f.arrayBuffer())));
      continue;
    }
    const text = await f.text();
    if (path === 'pack.json') bundle.manifest = JSON.parse(text);
    else if (path.startsWith('world/') && path.endsWith('.json')) bundle.data.push({ file: path, content: JSON.parse(text) });
    else if (path.startsWith('text/') && path.endsWith('.txt')) bundle.texts.push({ file: path, content: text });
    else if (path.startsWith('scripts/') && /\.m?js$/.test(path)) bundle.scripts.push({ file: path, source: text });
    else if (path.startsWith('walkthroughs/') && path.endsWith('.txt')) bundle.walkthroughs.push({ file: path, content: text });
  }
  if (bundle.manifest === null) throw new Error('The folder has no pack.json');
  if (themeCss !== null) {
    const issues: Issue[] = [];
    bundle.theme = { css: inlineTheme(themeCss, themeAssets, issues) };
    for (const i of issues) console.warn(`theme: ${i.message}`);
  }
  return bundle;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------------------------------------------------------------------------
// Wiring

function submit(command: string): void {
  if (!game || input.disabled) return;
  // Options already on screen go stale once anything else happens.
  for (const b of output.querySelectorAll<HTMLButtonElement>('button.option')) b.disabled = true;
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
  input.focus();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const command = input.value;
  input.value = '';
  submit(command);
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
  const text = `${transcript.join('\n')}\n`;
  const done = (message: string) => show([{ style: 'parser', text: message }]);
  try {
    navigator.clipboard.writeText(text).then(
      () => done('Transcript copied to the clipboard.'),
      () => done('Copying was blocked here. Select the text above and copy it instead.'),
    );
  } catch {
    done('Copying was blocked here. Select the text above and copy it instead.');
  }
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

