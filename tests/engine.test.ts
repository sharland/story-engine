// Engine behaviours that are easiest to pin down with a tiny pack built in
// memory. Each test is a regression test for a problem found in review.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game, loadWorld, renderBlocks, validate, type PackSource } from '../src/engine/index.ts';
import { playWalkthrough } from '../src/engine/walkthrough.ts';

function pack(data: Record<string, unknown>, extra: Partial<PackSource> = {}): PackSource {
  return {
    origin: 'memory',
    manifest: { format: 1, id: 'mem', title: 'Mem', version: '1', author: 'Tests', licence: 'CC0-1.0', start: 'hall' },
    data: [{ file: 'world/main.json', content: data }],
    texts: [],
    scripts: [],
    walkthroughs: [],
    ...extra,
  };
}

function play(src: PackSource, commands: string[]): string[] {
  const g = new Game(loadWorld(src), { seed: 1 });
  g.start();
  return commands.map((c) => renderBlocks(g.input(c)));
}

const hall = { hall: { name: 'Hall', exits: { north: 'yard' } }, yard: { name: 'Yard', exits: { south: 'hall' } } };

test('a rule on the verb "turn" replaces its default, and every-turn rules run once a turn', () => {
  const src = pack({
    rooms: hall,
    vars: { ticks: 0 },
    objects: { wheel: { name: 'wheel', location: 'hall', fixed: true } },
    rules: [
      { on: 'turn', object: 'wheel', say: 'The wheel creaks round.' },
      { on: 'everyTurn', do: [{ inc: 'ticks' }] },
    ],
  });
  const g = new Game(loadWorld(src), { seed: 1 });
  g.start();
  assert.equal(renderBlocks(g.input('turn wheel')), 'The wheel creaks round.');
  assert.equal(g.get('ticks'), 1);
  g.input('z');
  assert.equal(g.get('ticks'), 2);
});

test('a lock with no key never asks for one', () => {
  const src = pack({
    rooms: { hall: { name: 'Hall', exits: { north: { to: 'yard', door: 'gate' } } }, yard: { name: 'Yard', exits: { south: { to: 'hall', door: 'gate' } } } },
    objects: { gate: { name: 'gate', door: true, locked: true, lockable: true, foundIn: ['hall', 'yard'] } },
  });
  assert.deepEqual(play(src, ['unlock gate', 'open gate', 'north']), [
    'There is no keyhole in the gate.',
    'It seems to be locked.',
    'The gate is locked.',
  ]);
});

test('articles in topic keys are ignored, as they are in what the player types', () => {
  const src = pack({
    rooms: hall,
    characters: { miller: { name: 'miller', location: 'hall', topics: [{ keys: ['the old mill'], text: 'It burned down.' }] } },
  });
  assert.deepEqual(play(src, ['ask miller about the old mill', 'ask miller about old mill']), ['It burned down.', 'It burned down.']);
});

test('"once" topics with the same id on two characters, and a rule with that id, are independent', () => {
  const src = pack({
    rooms: hall,
    characters: {
      ada: { name: 'Ada', location: 'hall', topics: [{ id: 'secret', keys: ['secret'], once: true, text: 'Ada whispers.' }] },
      bob: { name: 'Bob', location: 'hall', topics: [{ id: 'secret', keys: ['secret'], once: true, text: 'Bob whispers.' }] },
    },
    rules: [{ id: 'secret', on: 'jump', once: true, say: 'You jump once.' }],
  });
  assert.deepEqual(play(src, ['jump', 'ask ada about secret', 'ask bob about secret', 'ask ada about secret']), [
    'You jump once.',
    'Ada whispers.',
    'Bob whispers.',
    'Ada has nothing to say about that.',
  ]);
});

test('an object a rule gives the player loses its initial text', () => {
  const src = pack({
    rooms: hall,
    objects: { coin: { name: 'coin', initial: 'A coin glints on the floor.' } },
    rules: [{ on: 'jump', do: [{ move: 'coin', to: 'player' }] }],
  });
  const out = play(src, ['jump', 'north', 'drop coin', 'look']);
  assert.equal(out[3], 'Yard\nYou can see a coin here.');
});

test('a script can move things to "nowhere" and "here"', () => {
  const src = pack(
    {
      rooms: hall,
      objects: { coin: { name: 'coin', location: 'hall' }, bell: { name: 'bell', location: 'yard' } },
      verbs: { vanish: { patterns: ['vanish'] } },
      rules: [{ on: 'vanish', do: [{ script: 'shuffle' }, { if: { obj: 'coin', in: 'nowhere' }, then: [{ say: 'The coin is gone.' }] }] }],
    },
    {
      scripts: [
        {
          file: 'scripts/s.js',
          module: {
            default: (api) =>
              api.effect('shuffle', (ctx) => {
                ctx.move('coin', 'nowhere');
                ctx.move('bell', 'here');
              }),
          },
        },
      ],
    },
  );
  assert.deepEqual(play(src, ['vanish', 'look']), ['The coin is gone.', 'Hall\nYou can see a bell here.']);
});

test('validator: templates inside passages are checked', () => {
  const r = validate(
    pack({ rooms: { hall: { name: 'Hall', description: '@hall' } } }, {
      texts: [{ file: 'text/t.txt', content: '== hall ==\nYou see {the:nosuchthing} and {var:nosuchvar}.' }],
    }),
  );
  assert.ok(r.issues.some((i) => i.code === 'dangling-ref' && i.message.includes('"nosuchthing"') && i.where === 'text/t.txt: hall'), JSON.stringify(r.issues));
  assert.ok(r.issues.some((i) => i.code === 'undeclared-var' && i.message.includes('"nosuchvar"')));
});

test('validator: assumeUsed silences unused-content warnings for things only scripts use', () => {
  const data = {
    rooms: hall,
    endings: { quiet: { title: 'Quiet', win: true } },
    validator: { assumeUsed: ['quiet', 'spare'] },
  };
  const r = validate(pack(data, { texts: [{ file: 'text/t.txt', content: '== spare ==\nUnused.' }] }));
  assert.deepEqual(r.issues.map((i) => i.code), ['no-walkthrough']);
});

test('validator: a "default" on a standard verb is reported as ignored', () => {
  const r = validate(pack({ rooms: hall, verbs: { push: { default: 'Pushing is rude.' } } }));
  assert.ok(r.issues.some((i) => i.code === 'verb-default' && i.message.includes('"push" is a standard verb')));
});

const twoPeople = {
  rooms: hall,
  vars: { nodded: false },
  characters: {
    guard: { name: 'guard', location: 'hall', topics: [{ keys: ['pass'], text: '"Go on, then."' }] },
    clerk: { name: 'clerk', location: 'yard', talk: 'The clerk looks up.' },
    porter: { name: 'porter', location: 'yard' },
  },
  rules: [{ on: 'answer', object: 'porter', topic: 'yes', say: 'The porter nods back.', do: [{ set: 'nodded', to: true }] }],
};

test('a bare answer goes to the last speaker, else the only person here, and rules see who it is for', () => {
  const out = play(pack(twoPeople), ['yes', 'answer guard with pass', 'n', 'yes', 'talk to clerk', 'no', 'answer porter with yes', 's', 's']);
  assert.deepEqual(out.slice(0, 2), ['The guard has no reply to that.', '"Go on, then."']);
  // In the yard: the guard (last to speak) has gone, and two people are here.
  assert.match(out[3], /^Say who you are answering/);
  assert.equal(out[5], 'The clerk has no reply to that.');
  assert.equal(out[6], 'The porter nods back.');
  const g = new Game(loadWorld(pack({ rooms: hall })), { seed: 1 });
  g.start();
  assert.equal(renderBlocks(g.input('yes')), 'There is nobody here to answer.');
});

test('talk falls back to talk text, or a message, when no entry node applies', () => {
  const src = pack({
    rooms: hall,
    vars: { open: false },
    characters: {
      guard: { name: 'guard', location: 'hall', talk: 'The guard ignores you.' },
      clerk: { name: 'clerk', location: 'hall' },
    },
    dialogues: {
      guard: { entry: [{ if: { var: 'open' }, node: 'hello' }], nodes: { hello: { say: 'Hello.' } } },
      clerk: { entry: [{ if: { var: 'open' }, node: 'hello' }], nodes: { hello: { say: 'Hello.' } } },
    },
  });
  assert.deepEqual(play(src, ['talk to guard', 'talk to clerk']), ['The guard ignores you.', 'The clerk has nothing to say to you.']);
});

test('walkthroughs choose options by id, and report one that is not on screen', () => {
  const src = pack({
    rooms: hall,
    vars: { asked: false },
    endings: { done: { title: 'Done', win: true } },
    characters: { guard: { name: 'guard', location: 'hall' } },
    dialogues: {
      guard: {
        nodes: {
          start: {
            options: [
              { id: 'news', text: 'Any news?', if: { var: 'asked' }, reply: 'None.' },
              { id: 'ask', text: 'May I pass?', reply: '"Yes."', do: [{ set: 'asked', to: true }] },
              { id: 'go', text: 'Thank you.', do: [{ end: 'done' }] },
            ],
          },
        },
      },
    },
  });
  const world = loadWorld(src);
  // "go" is option 2, then option 3 once "news" appears above it.
  const ok = playWalkthrough(world, '# expect: done\ntalk to guard\n@guard.ask\n@guard.news\n@guard.go\n', 'w.txt');
  assert.deepEqual(ok.problems, []);
  assert.match(ok.transcript, /> 3 \(@guard\.go\)/);
  const bad = playWalkthrough(world, '# expect: done\ntalk to guard\n@guard.news\n@guard.go\n', 'w.txt');
  assert.deepEqual(bad.problems, ['Command 2 ("@guard.news"): that option is not on screen']);
});

test('a conversation opened by a rule resumes where it was interrupted, with the node\'s own resume line', () => {
  const src = pack({
    rooms: hall,
    characters: { guard: { name: 'guard', location: 'yard' } },
    dialogues: {
      guard: {
        resumeText: '"Where were we?"',
        nodes: {
          start: {
            say: '"Halt! Who goes there?"',
            resumeText: '"I asked you a question. Who goes there?"',
            options: [{ id: 'friend', text: '"A friend."', reply: '"Pass, friend."', then: 'chat' }],
          },
          chat: { options: [{ id: 'weather', text: '"Cold out."', reply: '"Bitter."' }] },
          alarm: { say: '"Intruder!"' },
        },
      },
    },
    rules: [
      { on: 'arrive', in: 'yard', if: { not: { said: 'guard.friend' } }, do: [{ converse: 'guard' }] },
      { on: 'jump', in: 'yard', do: [{ converse: 'guard', node: 'alarm' }] },
    ],
  });
  const out = play(src, ['n', 's', 'n', '1', 's', 'n', 'talk to guard', 'jump']);
  assert.match(out[0], /"Halt! Who goes there\?"\n {2}1\. "A friend\."\n {2}0\. Leave$/);
  // Walked off without answering: coming back, the guard asks again in his own words.
  assert.equal(out[2], 'Yard\nThe guard is here.\n"I asked you a question. Who goes there?"\n  1. "A friend."\n  0. Leave');
  // Once answered, the rule stops firing; talking resumes at the later node.
  assert.equal(out[5], 'Yard\nThe guard is here.');
  assert.equal(out[6], '"Where were we?"\n  1. "Cold out."\n  0. Leave');
  // A rule that names a node starts there, whatever was interrupted.
  assert.equal(out[7], '"Intruder!"\n  0. Leave');
});

test('help lists every direction, the pack\'s own included, and "climb up" moves the player', () => {
  const rooms = {
    hall: { name: 'Hall', exits: { up: 'loft', widdershins: { say: 'You go round in a circle.' } } },
    loft: { name: 'Loft', exits: { down: 'hall' } },
  };
  const src = pack({ rooms, directions: { widdershins: { words: ['widdershins', 'ws'] } } });
  const out = play(src, ['help', 'climb up', 'climb down']);
  assert.match(out[0], /^To move, type a direction: NORTH \(N\), .*, UP \(U\), DOWN \(D\), IN, OUT and WIDDERSHINS \(WS\)\.$/m);
  assert.match(out[1], /^Loft/);
  assert.match(out[2], /^Hall/);
  const own = validate(pack({ rooms, messages: { help: 'Try {directions}.' } }));
  assert.deepEqual(own.issues.filter((i) => i.code === 'bad-template'), []);
});
