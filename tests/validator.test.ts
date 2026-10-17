// The validator must report dangling references, unreachable rooms, objects
// that can never be obtained, vocabulary clashes and schema mistakes. Each
// test builds a small broken pack in memory.

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { validate, type Issue, type PackSource } from '../src/engine/index.ts';
import { loadPack } from '../src/node/loader.ts';

const manifest = {
  format: 1,
  id: 'broken',
  title: 'Broken',
  version: '1',
  author: 'Tests',
  licence: 'CC0-1.0',
  start: 'a',
};

function pack(data: unknown, extra: Partial<PackSource> = {}): PackSource {
  return {
    origin: 'memory',
    manifest,
    data: [{ file: 'world/main.json', content: data }],
    texts: [],
    scripts: [],
    walkthroughs: [],
    ...extra,
  };
}

const twoRooms = {
  a: { name: 'A', exits: { north: 'b' } },
  b: { name: 'B', exits: { south: 'a' } },
};

function codes(issues: Issue[], level?: 'error' | 'warning'): string[] {
  return issues.filter((i) => !level || i.level === level).map((i) => i.code);
}

function find(issues: Issue[], code: string, text: string): Issue | undefined {
  return issues.find((i) => i.code === code && i.message.includes(text));
}

test('dangling references are errors, with suggestions', () => {
  const r = validate(
    pack({
      vars: { gold: 0 },
      rooms: {
        a: { name: 'A', description: '@missing-passage', exits: { north: 'bb', up: { to: 'b', door: 'lamp' }, sideways: 'b' } },
        b: { name: 'B', exits: { south: 'a' } },
      },
      objects: {
        lamp: { name: 'lamp', location: 'nowhere-room' },
        box: { name: 'box', location: 'a', key: 'no-key', description: 'It holds {the:ghost}.' },
      },
      rules: [
        { on: 'frobble', object: 'ghost', do: [{ award: 'nothing' }, { set: 'goldd', to: 1 }, { set: 'box.weight', to: 2 }] },
        { on: 'take', if: { has: 'phantom' }, do: [{ script: 'no-such-script' }, { movePlayer: 'c' }] },
      ],
    }),
  );
  const e = (code: string, text: string) => assert.ok(find(r.issues, code, text), `expected ${code} mentioning ${text}\n${JSON.stringify(r.issues, null, 1)}`);
  e('dangling-ref', 'room "bb" (did you mean "b"?)');
  e('not-a-door', '"lamp" is used as a door');
  e('dangling-ref', 'direction "sideways"');
  e('dangling-ref', 'passage "missing-passage"');
  e('dangling-ref', 'room, object or character "nowhere-room"');
  e('dangling-ref', 'object or character "no-key"');
  e('dangling-ref', 'object or character "ghost"');
  e('dangling-ref', 'verb "frobble"');
  e('dangling-ref', 'score item "nothing"');
  e('undeclared-var', 'Variable "goldd" is not declared in "vars" (did you mean "gold"?)');
  e('undeclared-prop', '"box" has no property "weight"');
  e('dangling-ref', 'object or character "phantom"');
  e('dangling-ref', 'script effect "no-such-script"');
  e('dangling-ref', 'room "c"');
  assert.equal(r.walkthroughs.length, 0, 'walkthroughs are not played when there are errors');
});

test('unreachable rooms are errors; movePlayer targets and assumeReachable count as reachable', () => {
  const r = validate(
    pack({
      rooms: {
        ...twoRooms,
        island: { name: 'Island' },
        dream: { name: 'Dream' },
        secret: { name: 'Secret' },
      },
      rules: [{ on: 'sleep', do: [{ movePlayer: 'dream' }] }],
      validator: { assumeReachable: ['secret'] },
    }),
  );
  assert.deepEqual(
    r.issues.filter((i) => i.code === 'unreachable-room').map((i) => i.message),
    [`Room "island" can't be reached from the start room by any exit or movePlayer effect`],
  );
});

test('objects that can never be obtained are errors', () => {
  const r = validate(
    pack({
      rooms: { ...twoRooms, island: { name: 'Island' } },
      characters: { guard: { name: 'Guard', location: 'a' } },
      objects: {
        offstage: { name: 'offstage thing' },
        marooned: { name: 'marooned thing', location: 'island' },
        held: { name: 'guarded thing', location: 'guard' },
        given: { name: 'given thing', location: 'guard' },
        appears: { name: 'appearing thing' },
        chest: { name: 'chest', location: 'b', container: true, openable: true, locked: true, fixed: true },
        inside: { name: 'thing in chest', location: 'chest' },
        ghostbox: { name: 'ghost box', container: true },
        ghostly: { name: 'thing in ghost box', location: 'ghostbox' },
        scenery: { name: 'backdrop', scenery: true },
      },
      rules: [
        { on: 'ask', object: 'guard', do: [{ move: 'given', to: 'player' }] },
        { on: 'wait', do: [{ move: 'appears', to: 'here' }] },
      ],
    }),
  );
  const unobtainable = r.issues.filter((i) => i.code === 'unobtainable').map((i) => i.message.split(':')[0]);
  assert.deepEqual(unobtainable.sort(), [
    'Object "ghostbox" can never be obtained',
    'Object "ghostly" can never be obtained',
    'Object "held" can never be obtained',
    'Object "marooned" can never be obtained',
    'Object "offstage" can never be obtained',
  ]);
  assert.ok(find(r.issues, 'unreachable-room', 'island'));
});

test('vocabulary clashes: identical vocabulary, parser keywords, shadowed patterns', () => {
  const r = validate(
    pack({
      rooms: twoRooms,
      objects: {
        'red-book': { name: 'red book', nouns: ['book'], adjectives: ['red'], location: 'a' },
        'book-red': { name: 'book, red', nouns: ['book', 'red'], location: 'a' },
        twin1: { name: 'coin', location: 'a' },
        twin2: { name: 'coin', location: 'a' },
        everything: { name: 'everything', nouns: ['all'], location: 'a' },
        unnamed: { name: 'the', location: 'a' },
      },
      verbs: {
        grab: { patterns: ['grab OBJ'] },
        'pick-up': { patterns: ['pick up OBJ'] },
      },
    }),
  );
  assert.ok(find(r.issues, 'vocabulary-clash', '"red-book" and "book-red" answer to exactly the same words'));
  assert.ok(!find(r.issues, 'vocabulary-clash', 'twin1'), 'identical things with the same name are not a clash');
  assert.ok(find(r.issues, 'vocabulary-clash', '"all" is a parser keyword'));
  assert.ok(find(r.issues, 'no-words', '"unnamed" has no words'));
  assert.ok(find(r.issues, 'pattern-clash', 'Pattern "grab OBJ" (grab) also matches "take/get/grab/carry OBJ" (take)'));
  assert.ok(find(r.issues, 'pattern-clash', '"pick up OBJ" (pick-up)'));
});

test('direction words used twice are an error', () => {
  const r = validate(pack({ rooms: twoRooms, directions: { nor: { words: ['n'] } } }));
  assert.ok(find(r.issues, 'vocabulary-clash', 'The word "n" is used by directions "north" and "nor"'));
});

test('schema mistakes: unknown keys, wrong types, bad ids, duplicates, bad forms', () => {
  const r = validate({
    ...pack({
      rooms: { a: { name: 'A', desciption: 'typo', dark: 'yes', exits: { north: 'b' } }, b: { name: 'B' }, 'Bad Id': { name: 'X' } },
      objects: { thing: { location: 'a' }, a: { name: 'clash with room' } },
      romos: {},
      rules: [
        { on: 'take', if: { flag: 'x' } },
        { on: 'take', do: [{ shout: 'x' }] },
        { on: 'take', if: { has: 'thing', at: 'a' } },
        { on: 'take', if: { var: 'turns', gt: 1, lt: 5 } },
        { on: 'take', do: [{ set: 'turns', to: 3 }, { schedule: 'e', in: 0 }] },
      ],
      events: { e: {} },
    }),
    texts: [{ file: 'text/a.txt', content: 'stray line\n== ok ==\nfine\n== ok ==\nagain' }],
  });
  const has = (code: string, text: string) => assert.ok(find(r.issues, code, text), `expected ${code}: ${text}\n${JSON.stringify(r.issues, null, 1)}`);
  has('unknown-key', 'Unknown field "desciption" (did you mean "description"?)');
  has('type', 'Expected true or false');
  has('bad-id', 'Id "Bad Id"');
  has('missing-field', 'Missing required field "name"');
  has('duplicate-id', '"a" is already used by');
  has('unknown-section', 'Unknown section "romos" (did you mean "rooms"?)');
  has('bad-condition', 'Not a recognised condition');
  has('bad-effect', 'Not a recognised effect');
  has('bad-condition', 'A condition must have one form, found: has, at');
  has('bad-condition', 'Use at most one comparison');
  has('read-only', '"turns" is a built-in variable');
  has('type', 'Expected a whole number of turns, 1 or more');
  has('text-outside-passage', 'Line 1 is outside any');
  has('duplicate-passage', 'Passage "ok" is defined more than once');
});

test('duplicate ids across data files are errors', () => {
  const r = validate({
    ...pack({ rooms: twoRooms }),
    data: [
      { file: 'world/one.json', content: { rooms: twoRooms } },
      { file: 'world/two.json', content: { rooms: { b: { name: 'Another B' } } } },
    ],
  });
  assert.ok(find(r.issues, 'duplicate-id', '"b" is already defined in world/one.json'));
});

test('unused content and an unwinnable score are warnings', () => {
  const r = validate({
    ...pack({
      rooms: twoRooms,
      scores: { never: 5 },
      endings: { lost: { title: 'Lost' } },
      events: { idle: { say: 'x' } },
      acts: [{ id: 'one' }, { id: 'two' }],
    }),
    texts: [{ file: 'text/t.txt', content: '== spare ==\nUnused.' }],
  });
  assert.equal(r.errors, 0);
  for (const code of ['unused-passage', 'unused-ending', 'unused-score', 'unused-event', 'unused-act', 'no-win', 'no-walkthrough']) {
    assert.ok(codes(r.issues, 'warning').includes(code), `expected warning ${code}`);
  }
});

test('walkthroughs are played: wrong ending, parser trouble and a short game are errors', () => {
  const data = {
    rooms: twoRooms,
    endings: { home: { title: 'Home', win: true } },
    rules: [{ on: 'go', dir: 'north', when: 'after', do: [{ end: 'home' }] }],
  };
  const r = validate(
    pack(data, {
      walkthroughs: [
        { file: 'walkthroughs/good.txt', content: '# expect: home\nnorth\n' },
        { file: 'walkthroughs/bad.txt', content: '# expect: home\nfrobnicate\nsouth\n' },
        { file: 'walkthroughs/long.txt', content: '# expect: home\nnorth\nsouth\n' },
        { file: 'walkthroughs/none.txt', content: 'north\n' },
      ],
    }),
  );
  const problems = (file: string) => r.issues.filter((i) => i.where === file).map((i) => i.message);
  assert.deepEqual(problems('walkthroughs/good.txt'), []);
  assert.deepEqual(problems('walkthroughs/bad.txt'), [
    'Command 1 ("frobnicate"): I don\'t know the word "frobnicate".',
    'The game did not end; expected ending "home"',
  ]);
  assert.deepEqual(problems('walkthroughs/long.txt'), ['The game ended before command 2 ("south")']);
  assert.deepEqual(problems('walkthroughs/none.txt'), ['The walkthrough has no "# expect: <ending>" line']);
});

test('a script that uses Math.random is caught as nondeterministic', () => {
  const r = validate(
    pack(
      {
        rooms: twoRooms,
        endings: { done: { title: 'Done', win: true } },
        verbs: { roll: { patterns: ['roll'] } },
        rules: [{ on: 'roll', do: [{ script: 'bad-dice' }] }, { on: 'go', do: [{ end: 'done' }] }],
      },
      {
        scripts: [
          {
            file: 'scripts/dice.js',
            module: { default: (api) => api.effect('bad-dice', (ctx) => ctx.say(String(Math.random()))) },
          },
        ],
        walkthroughs: [{ file: 'walkthroughs/w.txt', content: '# expect: done\nroll\nnorth\n' }],
      },
    ),
  );
  assert.ok(find(r.issues, 'nondeterministic', 'Math.random'));
});

test('scripts: bad modules, duplicate names and replacing standard verbs are errors', () => {
  const r = validate(
    pack(
      { rooms: twoRooms, verbs: { hop: { patterns: ['hop'] } } },
      {
        scripts: [
          { file: 'scripts/a.js', module: { default: (api) => api.effect('x', () => {}) } },
          { file: 'scripts/b.js', module: { default: (api) => { api.effect('x', () => {}); api.action('take', () => true); api.action('fly', () => true); } } },
          { file: 'scripts/c.js', module: {} as never },
          { file: 'scripts/d.js', module: { default: () => { throw new Error('boom'); } } },
        ],
      },
    ),
  );
  assert.ok(find(r.issues, 'duplicate-id', 'Script effect "x" is already registered by scripts/a.js'));
  assert.ok(find(r.issues, 'builtin-verb', 'standard verb "take"'));
  assert.ok(find(r.issues, 'unknown-verb', 'Script handles verb "fly"'));
  assert.ok(find(r.issues, 'bad-script', 'must export a default function'));
  assert.ok(find(r.issues, 'bad-script', 'Script registration failed: boom'));
});

test('dialogues: bad references, duplicate options, unreachable nodes and dead ends are errors', () => {
  const r = validate(
    pack({
      rooms: twoRooms,
      objects: { stone: { name: 'stone', location: 'a' } },
      characters: {
        guard: { name: 'guard', location: 'a' },
        clerk: { name: 'clerk', location: 'b' },
        porter: { name: 'porter', location: 'b' },
      },
      dialogues: {
        guard: {
          entry: [{ if: { said: 'guard.gretting' }, node: 'later' }, { node: 'strat' }],
          nodes: {
            start: {
              say: 'The guard nods.',
              options: [
                { id: 'greeting', text: 'Hello.', then: 'midle' },
                { id: 'greeting', text: 'Hello again.' },
                { id: 'leave', text: 'Bye.', then: 'end' },
              ],
            },
            middle: { options: [{ id: 'ask', text: 'Why?', then: 'start' }] },
            later: { say: 'Again?' },
            orphan: { say: 'Nobody gets here.' },
            trap: { noLeave: true },
          },
        },
        clerk: { nodes: { hello: { say: 'Hm?' } } },
        stone: { nodes: { start: {} } },
      },
      rules: [
        { on: 'wait', do: [{ converse: 'porter' }, { converse: 'guard', node: 'trap' }, { converse: 'guard', node: 'nowhere' }] },
      ],
    }),
  );
  const e = (code: string, text: string) => assert.ok(find(r.issues, code, text), `expected ${code} mentioning ${text}\n${JSON.stringify(r.issues, null, 1)}`);
  e('dangling-ref', 'Unknown option "gretting" in guard\'s dialogue (did you mean "greeting"?)');
  e('dangling-ref', 'Unknown node "strat" in guard\'s dialogue (did you mean "start"?)');
  e('dangling-ref', 'Unknown node "midle" in guard\'s dialogue (did you mean "middle"?)');
  e('duplicate-id', 'Option id "greeting" is already used');
  e('missing-field', 'clerk\'s dialogue has no "entry" list and no node called "start"');
  e('not-a-character', 'stone');
  e('dangling-ref', 'No dialogue for "porter"');
  e('dangling-ref', 'Unknown node "nowhere" in guard\'s dialogue');
  e('dead-end-node', 'Node "trap" of guard\'s dialogue has "noLeave" but no options');
  assert.deepEqual(
    r.issues.filter((i) => i.code === 'unreachable-node').map((i) => i.message),
    [
      `Node "middle" of guard's dialogue can't be reached from its entry, a "then" or a converse effect`,
      `Node "orphan" of guard's dialogue can't be reached from its entry, a "then" or a converse effect`,
      `Node "hello" of clerk's dialogue can't be reached from its entry, a "then" or a converse effect`,
    ],
  );
});

test('the testbed fixture validates with no errors or warnings and its walkthroughs pass', async () => {
  const r = validate(await loadPack(join(import.meta.dirname, 'fixtures', 'testbed')));
  assert.deepEqual(r.issues, []);
  assert.equal(r.walkthroughs.length, 2);
  assert.ok(r.walkthroughs.every((w) => w.ok));
});

test('the worked example from DESIGN.md validates (its only warning: no walkthrough)', async () => {
  const r = validate(await loadPack(join(import.meta.dirname, 'fixtures', 'tiny-example')));
  assert.deepEqual(codes(r.issues), ['no-walkthrough']);
});
