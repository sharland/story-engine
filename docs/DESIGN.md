# story-engine: design

This is the short version of how the engine works and why. The pack author's
manual is [WRITING-A-PACK.md](WRITING-A-PACK.md); the exact field list lives in
`src/engine/types.ts`.

## Goals and constraints

- Plays like the late-1970s mainframe adventures: typed commands, rooms and
  exits, objects, puzzles, a score, a move count.
- **The engine knows no story.** Every room, object, character, word of prose,
  piece of vocabulary beyond the standard English command set, and every
  puzzle rule comes from a *content pack* loaded at start-up. A test fails if
  engine source mentions an identifier or phrase from any shipped pack.
- Packs load from any directory, including one outside this repository.
- Runs in Node (tests, command line) and in a browser with no server.
- No runtime dependencies. Dev dependencies: `typescript` (type-checking),
  `esbuild` (browser and CLI bundles), `@types/node`, and `playwright-core`
  (drives a headless Chromium to test the web page).
- One seeded random generator, stored in the game state. A session is
  reproducible from `(pack, seed, commands)`.
- Game state is one plain JSON value. Save is `JSON.stringify`; restore is
  `JSON.parse` plus a pack-identity check; undo is a stack of earlier states
  (each `undo` steps back one turn, up to 10).

### Language: TypeScript

Chosen because the browser target makes JavaScript unavoidable, static types
catch shape errors in a data-heavy engine, and Node 22.18+ runs `.ts` files
directly (type stripping), so tests need no build step. Only erasable syntax
is allowed (`erasableSyntaxOnly`), so no enums, namespaces or parameter
properties.

### Licence: MIT (engine), CC0 (demo packs)

The brief offered GPL-3.0-or-later or MIT. I chose MIT. The engine's job is to
host content under *other* licences, including private packs whose script
modules run in the same JavaScript bundle as the engine in the web build.
Under the GPL, whether a pack's scripts become part of a "combined work" when
they ship together is a real question. MIT removes it. What MIT gives up: anyone
may fork the engine and close it. For a small engine whose value is in the
packs, that cost is low. If you prefer the GPL, change it now, before anyone
else has contributed; nothing in the code depends on the choice.

## Architecture

```
src/engine/   platform-free core: types, loader/compiler, parser, world
              model, rules, actions, turn loop, validator. No Node or DOM APIs.
src/node/     reads a pack directory from disk; builds single-file bundles
src/cli/      command-line runner (play, validate, walkthrough, bundle)
src/web/      static terminal-style page; loads pack bundles
packs/        demo packs (CC0)
tests/        node:test suites, transcript files, fixture packs
```

A pack reaches the engine as a `PackSource`: the manifest, the parsed data
files, the text files and the script modules. Node builds it from a directory;
the browser builds it from a *bundle* (one JSON file holding everything,
produced by `story-engine bundle`). `compilePack()` merges and normalises it
into an immutable `World`. A `Game` is a `World` plus a `GameState`.

## World model

Every entity has a pack-unique id (`^[a-z][a-z0-9_-]*$`). Kinds:

- **Room**: name, description, exits, optional `dark`, optional `region`.
- **Object**: name and vocabulary (nouns, adjectives), description, initial
  location. Capabilities are plain flags: `fixed`, `scenery`, `container`,
  `surface`, `openable`, `lockable` (with `key`), `transparent`, `wearable`,
  `switchable`, `light`, `edible`, `door`, `capacity`, `read` (text on it).
  `foundIn: [rooms]` puts one fixed object in several rooms (doors, rivers,
  the sky).
- **Character**: an object that can't be taken, with conversation `topics`,
  optional `wander` (random movement within a set of rooms) and a `following`
  property that makes it walk with the player.
- **Region**: a named group of rooms that may carry an entry condition, so a
  whole part of the map can open when the story reaches a point.

Dynamic data lives in `GameState`, never in the `World`:

```ts
{ format, pack: {id, version}, seed, rng, turns, score, awarded[], location,
  parent: {objectId: parentId | null},      // room, object, "player", char, or offstage
  props:  {entityId: {open, locked, on, worn, moved, visited, ...custom}},
  vars:   {name: value}, act, events: [{id, at}], fired[], it, him, her,
  verbose, ended }
```

Containment is a tree of `parent` links. "In" or "on" follows from the
parent's kind (container or surface). Light: a room is lit unless its `dark`
property is true, or if a light source is visible from the player's position
(carried, in the room, or inside an open or transparent container there).

## Turn loop

```
input line ─► split on . ; ! ? and "then" ─► for each command:
  pending question?  try the input as an answer first
  parse ─► fail: message, no time passes, rest of the line dropped
  meta verb (save, restore, undo, score, again, ...) ─► run, no time passes
  otherwise:
    push state onto the undo stack; turns += 1
    for each object in the command (one, a list, or "all"):
      before-rules  (first rule that matches and doesn't say "continue" stops it)
      action        (standard library handler, or the pack verb's handler)
      after-rules   (only if the action succeeded)
    end of turn: due events fire ─► "everyTurn" rules (background processes)
      ─► wandering characters move ─► light change check
    an `end` effect anywhere stops the loop and prints the ending
```

Pseudo-actions let rules hook the loop: `start` (once, after the intro),
`arrive` (after the player enters a room and it is described), `everyTurn`
(the end of every turn). Movement is the `go` action, so "leaving" is a before-rule on `go`.

## Parser

Input is lower-cased, apostrophes and most punctuation dropped (`,` separates
list items; `.`, `;`, `!`, `?` and the word `then` separate commands), and the
articles `a`, `an`, `the` removed. The
grammar is a list of patterns, each tied to an action:

```
take/get/grab OBJ           put OBJ in/into/inside OBJ2     ask OBJ about TEXT
pick up OBJ                 put OBJ on/onto OBJ2            give OBJ to OBJ2
pick OBJ up                 unlock OBJ with OBJ2            give OBJ2 OBJ
go/walk/run DIR             DIR                             look
```

`OBJ`/`OBJ2` are noun phrases, `TEXT` is free text, `DIR` is a direction word.
Literal words may have `/` alternatives. Every pattern that fits the input is
ranked by how many literal words it matched; the parser takes the
highest-ranked one whose noun phrases resolve. So `turn lamp on` picks
`turn OBJ on` over `turn OBJ`.

A noun phrase resolves against the objects in scope (visible, or held when
dark). An object matches if every word in the phrase is one of its nouns or
adjectives. Words from its name count too. Matches through a noun beat
adjective-only matches. Then:

- `all`, `everything`, `all but X`, and lists (`X and Y`, `X, Y`) for actions
  that accept several objects (take, drop, put).
- `it`/`them` refer to the last object named, `him`/`her` to the last
  character.
- Several matching objects that can be told apart produce
  `Which do you mean, the brass key or the iron key?`. The next input is tried
  as an answer before it is parsed as a new command. Identical objects are not
  asked about.
- A missing noun produces `What do you want to take?`, answered the same way.
  `unlock door` with no key named uses a key the player holds.
- Unknown words give `I don't know the word "flummox".` Known words that name
  nothing present give `You can't see any such thing.`

Packs extend the grammar: a pack verb is a set of patterns plus a default
response, and a pack can add patterns to standard verbs (`feed OBJ to OBJ2` →
give). At equal rank, pack patterns win over standard ones.

## Pack format

```
my-pack/
  pack.json          manifest: id, title, version, author, source, licence,
                     credits, start room, intro, player
  world/**/*.json    data files, merged; any split you like (by region, by act)
  text/**/*.txt      long passages, referenced from data as "@key"
  scripts/*.js       optional script modules (the escape hatch)
  walkthroughs/*.txt command lists that must reach a named ending
  LICENSE
```

A data file is an object with any of these sections: `rooms`, `objects`,
`characters`, `regions`, `acts`, `rules`, `events`, `endings`, `scores`,
`vars`, `verbs`, `directions`, `messages`. Ids are unique across the whole
pack. Keys starting with `_` are comments and are ignored.

### How logic is expressed

Three layers, in the order an author should reach for them:

1. **Plain data.** Rooms, exits, objects and their flags, topics. Locked doors,
   containers, light, wearables and the score need no logic at all.
2. **Declarative rules.** A rule is `on` (action), optional matchers
   (`object`, `with`, `dir`, `topic`, `in`), an optional condition `if`, and
   effects (`say`, `do`). Conditions and effects are small JSON forms:

   ```
   conditions: {var, eq|ne|gt|gte|lt|lte}  {has}  {wearing}  {at}  {region}
               {obj, in}  {here}  {visited}  {act}  {actAtLeast}  {light}
               {chance}  {all:[..]}  {any:[..]}  {not}  {script}
   effects:    {say}  {sayRandom}  {set,to}  {inc}  {dec}  {move,to}
               {movePlayer}  {award}  {end}  {act}  {schedule,in}  {cancel}
               {if,then,else}  {look}  {script}
   ```

   Text fields accept variants, `["base text", {"if": cond, "text": "..."}]`,
   so descriptions follow the state without rules.
3. **Script modules.** A pack may ship ES modules in `scripts/`. Each exports
   `default function (api)` and registers named conditions, effects and verb
   handlers. They receive a narrow context object (read and set variables,
   move things, print, use the seeded random generator). They cannot reach
   engine internals, and must not keep their own state; the validator plays
   each walkthrough twice to catch scripts that do. Scripts are trusted code: they
   run with the page's or the process's privileges.

**Why this split.** Data covers most of a novel adaptation, and a validator can
check all of it. The declarative layer covers the common puzzle shapes
("if the player has X and Y is open, do Z") in a form that is still checkable
and that a writer can read without knowing JavaScript. A general-purpose
expression language inside JSON would be harder to validate than JavaScript
and harder to read than either. Anything beyond the declarative layer goes to
a real language through a narrow interface. That interface is the bounded
extension point that lets two people write two packs without touching the
engine.

Rule order: rules are tried by `priority` (highest first), then most
specific first (room + object + second noun beats object alone beats action
alone), then in load order. Load order is files sorted by path, then position
in the file. All of this is deterministic. Before-rules stop at the first one
that runs, unless it says `continue`. After-rules run only when the standard
behaviour succeeded. For the pseudo-actions every matching rule runs.

### Worked example

`pack.json`:

```json
{
  "format": 1,
  "id": "tiny-example",
  "title": "A Tiny Example",
  "version": "1.0.0",
  "author": "A. Writer",
  "licence": "CC0-1.0",
  "start": "porch",
  "intro": "@intro"
}
```

`world/house.json`:

```json
{
  "vars": { "rang-bell": false },
  "scores": { "opened-door": 5 },
  "rooms": {
    "porch": {
      "name": "Porch",
      "description": ["A sagging porch. The front door is to the north.",
        { "if": { "var": "front-door.open" }, "text": "The door stands open." }],
      "exits": { "north": { "to": "hall", "door": "front-door" } }
    },
    "hall": { "name": "Hall", "description": "@hall", "dark": true,
              "exits": { "south": { "to": "porch", "door": "front-door" } } }
  },
  "objects": {
    "front-door": { "name": "front door", "nouns": ["door"], "adjectives": ["front"],
      "door": true, "openable": true, "lockable": true, "locked": true,
      "key": "iron-key", "foundIn": ["porch", "hall"] },
    "iron-key": { "name": "iron key", "location": "porch",
      "initial": "An iron key lies under the mat." },
    "bell": { "name": "bell", "scenery": true, "location": "porch" }
  },
  "verbs": { "ring": { "patterns": ["ring OBJ"], "default": "You can't ring that." } },
  "rules": [
    { "on": "ring", "object": "bell", "say": "Nobody comes.",
      "do": [{ "set": "rang-bell", "to": true }] },
    { "on": "open", "object": "front-door", "when": "after",
      "do": [{ "award": "opened-door" }] }
  ]
}
```

`text/house.txt`:

```
== intro ==
You have come a long way to reach this house.

== hall ==
A cold hall that smells of old paper.
```

## Validator

`story-engine validate <pack>` (and a test for every shipped pack) reports:

- schema problems: unknown keys (with a "did you mean"), wrong types, bad ids,
  duplicate ids across files;
- dangling references: exits, doors, keys, locations, rule matchers, ids in
  conditions and effects, `@text` keys, `{the:id}` template references,
  undeclared variables, unknown actions, unregistered script names;
- unreachable rooms: breadth-first search from the start over every exit
  (ignoring conditions) plus every `movePlayer` target;
- objects that can never be obtained: portable objects that start nowhere
  and are never moved, or whose starting place is unreachable;
- vocabulary clashes: objects that can share a room and have identical
  vocabulary, object words that are parser keywords or directions, pack
  patterns that shadow other patterns.

The validator is static. It can't see what scripts do. A pack can name rooms
and objects that scripts make reachable in `validator.assumeReachable`. It
also plays every file in `walkthroughs/` and checks each reaches its declared
ending.

## The novel-adaptation requirements

| Requirement | How the format handles it |
|---|---|
| Story moves through acts or chapters; regions and events open up | `acts` is an ordered list. An `{"act": id}` effect advances the story, prints the act's title and intro, and runs the act's effects (move characters, schedule events). Conditions `act` and `actAtLeast` gate exits, topics, rules and descriptions. `regions` carry an entry condition, so a whole area opens when its act arrives. |
| Long descriptive passages and dialogue, some quoted | Text files hold passages of any length under `== key ==` headers, referenced as `"@key"`. Blank lines make paragraphs, and lines starting with `|` keep their line breaks (verse, letters). Dialogue is ordinary text in topics, rules and events. Character `topics` carry conditions, so conversations change as the story moves. |
| Metadata | `pack.json` carries `title`, `author` (the adapter), `source` (`title`, `author`, `year`, `url`, `licence`, `note`), `licence` (SPDX id), `credits`, `version`. The `about` command prints it. |
| More than one ending | `endings` with `title`, `text` and `win: true/false`. Any effect can `end` the game. Each walkthrough names the ending it must reach, so every ending can be tested. |
| Two writers, two packs, no engine edits | A pack is a self-contained directory. Pack-only verbs, rules, directions, messages and script modules cover new mechanics. The script API is the one bounded extension point. If a pack needs more, the writer records it in the pack's `ENGINE-REQUESTS.md` and does not edit the engine. |

## Left for later

- Commands addressed to characters (`robot, go north`) and NPC goal-seeking
  (path-finding). Characters wander at random, follow, or are moved by effects.
- Player inside enterable objects (vehicles, beds) and nested rooms.
- Weight and size. Capacity is a simple item count.
- Ranks for score ranges, and full-score bonus messages.
- Conversation menus. Conversation is ask, tell and talk only.
- Paging ("press a key") for long passages; act intros print in one go.
- An `exits` command; `opposite` on directions is recorded but unused.
- Asking for the first noun of two-noun verbs (`put` alone is not
  understood; `put lamp in` asks what to put it in).
- A JSON Schema for editor completion. The validator is the schema today.
- Localisation of the standard library. Packs can override every standard
  message, but the grammar is English.
- Marking passages as verbatim quotation for source-tracking reports.
- Save migration between pack versions: a save only restores into the
  version that made it.
- Indexing containment for very large packs. Scope is computed by scanning
  every object. Measured on a synthetic pack of 100 rooms, 620 objects and
  20 wandering characters: about 0.7 ms per command in Node 22, so this only
  matters far beyond novel scale.
- Sandboxing pack scripts. They are trusted.
