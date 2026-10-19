# Writing a pack

This guide is for anyone turning a novel, or any setting, into a playable
story-engine pack. You need the book, this guide, and a terminal that can run
the commands in [Tools](#13-tools-validate-play-walkthrough). You do not need
to read or change the engine, and you must not change it.

Contents:

1. [What you are making](#1-what-you-are-making)
2. [Ground rules](#2-ground-rules)
3. [Adapting a novel: the method](#3-adapting-a-novel-the-method)
4. [Pack layout and pack.json](#4-pack-layout-and-packjson)
5. [Text](#5-text)
6. [Rooms and exits](#6-rooms-and-exits)
7. [Objects](#7-objects)
8. [Characters and conversation](#8-characters-and-conversation)
9. [Story structure: acts, regions, events, scores, endings](#9-story-structure-acts-regions-events-scores-endings)
10. [Logic: variables, conditions, effects, rules](#10-logic-variables-conditions-effects-rules)
11. [Verbs, directions and messages](#11-verbs-directions-and-messages)
12. [Script modules](#12-script-modules)
13. [Tools: validate, play, walkthrough](#13-tools-validate-play-walkthrough)
14. [Recipes](#14-recipes)
15. [Definition of done](#15-definition-of-done)
16. [Licences and credits](#16-licences-and-credits)
17. [A complete example pack](#17-a-complete-example-pack)
18. [Appendix A: standard verbs](#appendix-a-standard-verbs)
19. [Appendix B: standard messages](#appendix-b-standard-messages)

---

## 1. What you are making

A text adventure in the late-1970s mainframe style. The player reads a room
description and types short commands: `north`, `take lantern`,
`put key in box`, `ask the innkeeper about the coach`. The game answers, time
moves on one turn, and things happen: a timer runs down, a character walks in,
a door is now open. The player earns points for progress. The game ends when
an effect says so, in one of several endings you write.

The engine supplies the parser, the standard verbs (take, drop, open, wear,
and so on), containers, light and darkness, saving, undo, scoring and the turn
clock. You supply everything the player sees: every room, object, character,
line of prose, puzzle and ending. All of it lives in your pack, a directory of
JSON and text files.

The engine is the same for every story, so it knows nothing about yours. When
your story needs something unusual, you express it in the pack, as data, as
declarative rules or, as a last resort, as a small script.

## 2. Ground rules

- **Work only inside your pack directory.** Never edit anything under `src/`,
  `tests/` or another pack. Another writer may be working on another pack at
  the same time, and the engine must stay identical for both of you.
- **If you need something the engine cannot do**, first try rules
  ([section 10](#10-logic-variables-conditions-effects-rules)), then a script
  module ([section 12](#12-script-modules)). If neither can do it, write the
  request in `ENGINE-REQUESTS.md` in your pack directory (what you need, why,
  and how you worked around it) and carry on with a workaround. Do not edit the
  engine.
- **Validate early and often.** `validate` must report 0 errors and 0 warnings
  before you call the pack done.
- **Every ending needs a walkthrough** that reaches it, and the winning one must
  reach the full score.
- **Write original text, or quote the source.** Do not use text, names, maps or
  puzzles from other games.

## 3. Adapting a novel: the method

A novel is told; a game is played. Most of the work is deciding what the
player *does*. Follow these steps in order, and write your decisions into
`NOTES.md` in your pack directory as you go. The notes are for you and for
whoever reviews the pack, and the engine ignores them.

### 3.1 Read for the playable spine

Read the whole book first. Then list, in `NOTES.md`:

- **The protagonist and their goal.** The player will be this person (see 3.2).
- **The places** where things happen, and how they connect. These become rooms.
- **The objects that matter to the plot.** A key, a weapon, a letter, a horse,
  a machine. These become objects, and the important ones become puzzles.
- **The obstacles.** Each thing that stands between the protagonist and the
  goal is a candidate puzzle: a locked place, a person who must be persuaded,
  a thing that must be found, made or repaired.
- **The turning points.** Moments after which the world is different. These
  become act boundaries (3.3).
- **The ending, and the plausible other endings.** The book's ending is usually
  the winning one. Deaths, captures, failures and wrong choices that the book
  threatens are candidates for losing endings.

### 3.2 Choose the player character and the voice

- The player is usually the protagonist. If the book is narrated by an
  observer (a frame narrator, a friend), make the player the person who acts,
  and give the observer's knowledge to a character or to act intros.
- Write room descriptions, object descriptions and responses in **second
  person, present tense**: "You are standing in a dusty street." Convert
  first-person and third-person narration as you adapt it.
- Dialogue from the book can be quoted directly. Other characters keep their
  own voices.
- Keep the book's period and tone in your own text. A western reads like a
  western; a Victorian scientific romance reads like one.

### 3.3 Turn the book's structure into acts

An **act** is a stretch of the story in which the world is in one state. A new
act begins at a turning point: a door to a new part of the world opens, a
character changes sides, night falls, the protagonist travels in time.

- Aim for **3 to 7 acts** for a novel. An act usually covers several chapters.
  Do not make one act per chapter unless chapters really are turning points.
- Each act gets a `title` (shown when it starts), an optional `intro` passage
  (the bridging narration that the player does not play) and optional effects
  (move characters, unlock regions, start timers).
- Acts advance only when the player achieves something: a rule's effect runs
  `{"act": "<id of the next act>"}`. Do not advance acts on a timer unless the book really
  forces the pace.
- Parts of the book the player cannot influence (a long journey, a battle seen
  from afar, years passing) become act intros or event text. Keep them short
  (under about 300 words) and let the player act again quickly.

### 3.4 Build the map

- Make one room per place where the player can do something distinct. Merge
  places that would be empty; split a place that has two different puzzles.
- **Scale for a novel: about 25 to 60 rooms, 40 to 120 objects, 5 to 15
  characters.** More is not better. Every room should earn its place.
- Group rooms into **regions** that open with the acts (a valley, a city, a
  future era). A region can carry an entry condition, so one line of data opens
  a whole area when its act arrives.
- Directions must be consistent: if north from A leads to B, south from B
  should lead back to A unless the story explains why not.
- **Every room description names its exits** ("The stable is east and the
  street is west."). The engine does not list exits for the player.
- Keep a map in `NOTES.md` as a list of rooms with their exits.

### 3.5 Design puzzles from the plot

Good puzzles come from the book's own obstacles. For each obstacle, decide:
what does the player have to *know*, *have* or *do* to get past it, and where
in the game do they learn, find or do it?

Rules for fair puzzles:

- **Clue before lock.** The player must be able to find the information or
  object before they need it, and the text must point to it ("a keypad", "she
  keeps a jar of sugar on her desk").
- **Three clues for anything essential.** Players miss things: they skip a
  menu option, never examine the right object, ask the wrong person. Anything
  the player must work out needs at least three clues in different places,
  which game designers call the Three Clue Rule. In the western, the sugar
  is mentioned by one of Ada's menu options, by another that is always
  offered, by her answer when asked about the mare, and by the sheriff.
- **Prefer soft gates for story beats.** A hard gate has one way through: no
  sugar, no horse. A soft gate has a best way and a worse way: patience
  catches the mare too, but slower, for fewer points, with a sore horse and
  a cross owner, and without the whistle trick sugar would have taught. Soft
  gates make choices matter without making them all compulsory. If every
  important fact hides behind one menu option, players learn to click every
  option of every menu, and the menu becomes a checklist. Keep hard gates
  for real locks, and give story obstacles more than one route at different
  costs ([recipe](#14-recipes)). Each route still needs its own clues.
- **Use standard verbs where you can** (open, unlock, give, put, push, turn,
  wear, ask). When you need a special verb, add it with sensible synonyms
  ([section 11](#11-verbs-directions-and-messages)) and mention the action in
  the text so the player can guess the verb.
- **Answer the obvious wrong attempt** with a helpful response, not "Nothing
  happens." If the player tries to lasso the horse before it is calm, say why
  it fails.
- **Avoid unwinnable states without warning.** If an object can be destroyed or
  used up, either make that impossible ("You're tempted, but she needs it more
  than you do") or end the game at once with a losing ending. Undo is
  available, but do not rely on players knowing that.
- **Timed puzzles** (a fuse burning, air running out) must give a warning before
  the end and must be beatable with a few turns to spare.
- **No guessing games.** Every puzzle has at least one sensible solution
  the text supports. Accept reasonable phrasings by giving objects good nouns and
  adjectives, and verbs good patterns.

Aim for **one significant puzzle per act** and several small ones (a locked
container, a dark room, a reluctant character).

### 3.6 Characters and dialogue

- Each important character gets a description, a line for `talk to`, and
  **topics** for `ask X about Y` and `tell X about Y`. Topics carry conditions,
  so a character's answers change as the story moves on.
- The characters who matter most can have a **conversation menu** instead
  ([section 8](#conversation-menus)): numbered things to say, which change
  with the story, and replies that change what the character thinks of the
  player. Menus spare the player from guessing the right word, which ask/tell
  never fully does. Minor characters can stay on topics, which are cheaper to
  write; one character can have both.
- Quote the book's dialogue where it fits. Keep each answer to a few sentences;
  a long speech can be a passage.
- Give every character a `noTopic` reply in their own voice.
- Move characters between rooms with effects at act changes, or let them
  `wander` within a set of rooms, or set `following` so they walk with the
  player.
- Characters cannot be taken. Things they carry are visible but cannot be
  taken until a rule gives them to the player.

### 3.7 Text: how much, and how to quote

- Room descriptions: **40 to 120 words**. Name what matters, name the exits,
  leave out what the player cannot interact with or will never need.
- First visits can add atmosphere with `firstVisit` (shown once).
- Object descriptions: one to three sentences, with the clue if there is one.
- Use the book's own phrases and dialogue freely when the source is in the
  public domain (see [section 16](#16-licences-and-credits)). Long quotations
  belong in passages ([section 5](#5-text)).
- Put any text containing double quotes (dialogue) or longer than a sentence or
  two in a text file as a passage. It saves escaping quotes in JSON.

### 3.8 Endings and score

- The book's ending is the winning ending (`"win": true`). Write it as a short
  epilogue in second person.
- Add losing endings where the book threatens a failure the player could
  actually cause: death, capture, missing the boat, betraying a friend. Each
  ending needs a walkthrough that reaches it.
- Award points for **milestones**: solving each puzzle, reaching each new act,
  finding each important object. A total of **50 to 150 points** is typical.
  The winning walkthrough must reach the maximum.

### 3.9 Work plan with checkpoints

Work in this order and run `validate` after each step.

1. `NOTES.md`: spine, player character, acts, map, puzzle list, endings.
2. Skeleton: `pack.json`, every room with a one-line description and its exits,
   the acts, the endings. Validate: no unreachable rooms.
3. Objects and characters, with placeholder descriptions. Validate: no
   unobtainable objects, no vocabulary clashes.
4. Puzzle logic: rules, events, scores, act changes. Write the winning
   walkthrough now and make it pass.
5. Losing endings and their walkthroughs.
6. Full prose: passages for rooms, intros, dialogue, endings.
7. Play it yourself with `play`. Try wrong things. Add responses for what a
   player would reasonably try.
8. [Definition of done](#15-definition-of-done).

## 4. Pack layout and pack.json

A pack is a directory. It can live anywhere on disk.

```
my-pack/
  pack.json            manifest (required)
  world/               data files (*.json), any names, any subfolders
  text/                passage files (*.txt), any names, any subfolders
  scripts/             script modules (*.js), only if you need them
  walkthroughs/        one *.txt per ending
  theme/               a skin for the web page: theme.css, fonts, images (optional)
  LICENSE              the pack's licence text
  NOTES.md             your adaptation notes (ignored by the engine)
  ENGINE-REQUESTS.md   only if you need something the engine lacks
```

All files in `world/` are merged. Split them however helps you: by region, by
act, or by kind (rooms, objects, rules). Files are read in path order, which
matters in two places: rules that tie ([section 10.4](#104-rules)), and
`acts`, whose order is the story's order. **Keep all your acts in one file.**

### theme/: a skin for the web page

A pack can change the whole look of the web page while it is being played,
with `theme/theme.css` and the fonts and images that file uses. The command
line ignores it. Both demo packs have one: an arcade western cabinet and a
1970s space-opera console.

```
theme/
  theme.css            the stylesheet
  fonts/*.woff2        fonts it uses, with their licence texts (*.txt)
  art/*.svg, *.png     images it uses
```

- **Files.** Refer to fonts and images with paths relative to `theme/`:
  `url("fonts/pixel.woff2")`, `url("art/horizon.svg")`. Fonts may be `.woff2`,
  `.woff`, `.ttf` or `.otf`; images `.png`, `.jpg`, `.gif`, `.webp` or `.svg`.
  When the pack is read they are built into the stylesheet, so a one-file
  bundle carries its skin and works from disk with no internet. Licence texts
  and notes (`.txt`, `.md`) can sit alongside; other file types are reported.
- **Not allowed.** `@import` is an error. A `url()` that points at the
  internet works, but is a warning: the skin breaks offline, and every player
  is tracked by whoever serves the file. Put the file in `theme/`.
- **Size.** Above 1 MB with its fonts and images, a theme is a warning: the
  page gets slow to load. The demo themes are about 40 and 55 KB.
- **Cosmetic only.** Never put a clue in a theme. Screen readers, the command
  line and transcripts don't see it.

While a theme is on, `<html>` has `data-skin="pack"` and `data-pack="<your
pack id>"`, and the page's own light colour scheme stands aside, so your
colours apply in both light and dark mode. The page is built from these
parts, which your CSS can restyle:

| Part | What it is |
|---|---|
| `:root` variables | `--bg`, `--panel`, `--text`, `--dim`, `--title`, `--heading`, `--prompt`, `--error`, `--border`, `--focus`: the colours the page uses. Setting these alone gives a quick recolour. |
| `.bar` | The top strip: the story picker and the buttons. |
| `.status` | The status line: `#status-room` (where the player is) and `#status-score`. That holds `.stat-score` and `.stat-turns`, each with a `.label`, a `.value` and, for the score, a `.max` (`/25`), with a `.sep` between them. Each `.value` has `data-padded`, its number as six digits, for an arcade-style `000025`: `content: attr(data-padded)`. |
| `.terminal`, `#output` | The game screen and the scrolling text inside it. |
| `.b-title` | A room name, when the room is described. |
| `.b-heading` | An act title, and an ending's title. |
| `.b-text`, `.b-parser` | Ordinary text, and the parser's replies ("I don't know the word..."). |
| `.b-score` | "[Your score has gone up by 5.]" |
| `.b-option`, `button.option` | A line of a conversation menu, and its button (`data-option` holds the number; `:disabled` once the menu is out of date). A locked option is a `.b-option.locked`, with no button. |
| `.echo` | The player's command, echoed. |
| `.command`, `.prompt`, `.command input` | The command line. |
| `.foot` | The footer: story and seed, and a link. |

Test the skin at phone width (the page must not scroll sideways), keep body
text large and high in contrast, and wrap animation in
`@media (prefers-reduced-motion: reduce)`. A font in a theme must have a
licence that allows embedding; the SIL Open Font Licence does, as long as its
text travels with the font. Don't copy another game's or show's logo,
lettering or artwork: make the mood yours.

### pack.json

| Field | Required | Meaning |
|---|---|---|
| `format` | yes | Always `1`. |
| `id` | yes | Pack id: lower case, starting with a letter, then letters, digits, `-`, `_`. Saved games record it. |
| `title` | yes | The game's title. |
| `version` | yes | Your version, such as `"1.0.0"`. Saved games only restore into the same version, so change it when you release changes. |
| `author` | yes | Who wrote the pack (the adapter). |
| `licence` | yes | SPDX licence id of the pack, such as `"CC0-1.0"` or `"CC-BY-4.0"`. |
| `start` | yes | Id of the room the player starts in. |
| `description` | no | One or two sentences about the game. |
| `source` | no | The work you adapted: `{"title", "author", "year", "url", "licence", "note"}`. Only `title` is required inside it. |
| `credits` | no | List of credit lines. |
| `intro` | no | Text shown before anything else (usually a passage, `"@intro"`). |
| `player` | no | `{"description": text, "capacity": number}`. `capacity` limits how many things the player can carry at once (worn things do not count). |

The `about` command shows the title, version, description, author ("Adapted
by" when there is a `source`, "By" otherwise), source, licence and credits.

### Data files

Each data file is one JSON object with any of these sections:

| Section | Shape | Section in this guide |
|---|---|---|
| `rooms` | object of id → room | [6](#6-rooms-and-exits) |
| `objects` | object of id → object | [7](#7-objects) |
| `characters` | object of id → character | [8](#8-characters-and-conversation) |
| `dialogues` | object of character id → conversation menu | [8](#conversation-menus) |
| `regions` | object of id → region | [9](#9-story-structure-acts-regions-events-scores-endings) |
| `acts` | list of acts, in story order | [9](#9-story-structure-acts-regions-events-scores-endings) |
| `events` | object of id → event | [9](#9-story-structure-acts-regions-events-scores-endings) |
| `scores` | object of id → points | [9](#9-story-structure-acts-regions-events-scores-endings) |
| `endings` | object of id → ending | [9](#9-story-structure-acts-regions-events-scores-endings) |
| `vars` | object of name → starting value | [10](#10-logic-variables-conditions-effects-rules) |
| `rules` | list of rules | [10](#10-logic-variables-conditions-effects-rules) |
| `verbs` | object of id → verb | [11](#11-verbs-directions-and-messages) |
| `directions` | object of id → direction | [11](#11-verbs-directions-and-messages) |
| `messages` | object of key → text | [11](#11-verbs-directions-and-messages) |
| `validator` | `{"assumeReachable": [ids], "assumeObtainable": [ids], "assumeUsed": [ids]}` | [13](#13-tools-validate-play-walkthrough) |

Any other section name is an error.

**Ids.** Rooms, objects and characters share one set of ids, so a room and an
object cannot both be called `forge`. Ids are lower case, start with a letter,
and use only `a-z`, `0-9`, `-` and `_`. `player`, `nowhere`, `here`, `noun`
and `second` are reserved. Ids are never shown to the player, so make them
descriptive: `blacksmith-forge`, not `room7`.

**Comments.** JSON has no comments, but any key starting with `_` is ignored:
`"_note": "this door opens in act 3"`. Any other unknown key is reported as a
warning, with a suggestion if it looks like a typo.

## 5. Text

Any field marked *text* in this guide accepts three forms.

**A plain string.**

```json
"description": "A dusty street between false-fronted buildings."
```

**A passage reference**, `"@key"`, which pulls in a passage from a text file.
(If you need a string that really starts with `@`, write `@@`.)

```json
"description": "@main-street"
```

**A list of parts**, joined with spaces. Each part is a string, or an object
`{"if": condition, "text": "...", "else": "..."}` that is included only when
its condition holds (or its `else` when it does not). Use this for
descriptions that follow the state of the world.

```json
"description": [
  "A narrow kitchen.",
  { "if": { "var": "cupboard.open" }, "text": "The cupboard hangs open.", "else": "The cupboard is shut." }
]
```

### Passage files

Files in `text/` hold passages. A line `== key ==` starts a passage; it runs
until the next header.

```
== main-street ==
Sorrow Creek's only street runs between a handful of false-fronted buildings,
baking in the afternoon sun. The livery stable is east.

A trail drops south into the dry wash below town.

== poster ==
| REWARD
| for the return of a DUN MARE.
```

- Lines are joined into paragraphs, so you can wrap text however you like.
- A blank line starts a new paragraph.
- Lines starting with `|` keep their line breaks (verse, letters, signs).
- Keys may use letters, digits, `.`, `-` and `_`.
- Every line must belong to a passage, and every key must be unique across
  all text files.
- Passages you never use are reported as warnings.

### Templates

Text can contain these placeholders, filled in when it is shown:

| Template | Shows |
|---|---|
| `{the:noun}` `{The:noun}` | "the lariat" / "The lariat" (or just the name for proper names) |
| `{a:noun}` `{A:noun}` | "a lariat", "an apple", "some sugar lumps" |
| `{name:noun}` | the bare name |
| `{it:noun}` `{It:noun}` | it / them / him / her (`It` gives It / They / He / She) |
| `{that:noun}` `{That:noun}` | that / those / him / her |
| `{is:noun}` `{has:noun}` | is/are, has/have, agreeing with the thing |
| `{s:noun}` `{es:noun}` | "s"/"es" for a singular thing, nothing for a plural: `seem{s:noun}` |
| `{var:gold}` `{var:lamp.fuel}` | the value of a variable or property |
| `{score}` `{max}` `{turns}` `{turnCount}` | score, maximum score, turns, "1 turn"/"5 turns" |

`noun` is the first object of the command, `second` the second ("put **noun**
in **second**"). Instead of `noun` or `second` you can name any object or
character by id: `{The:sheriff}`. In an object's or character's own texts
(`description`, `initial`, `read`, topics), `noun` means that thing itself.
Write `{{` and `}}` for literal braces.

## 6. Rooms and exits

```json
"rooms": {
  "livery": {
    "name": "Livery Stable",
    "description": "@livery",
    "exits": { "west": "main-street", "out": "main-street" }
  }
}
```

| Field | Meaning |
|---|---|
| `name` | Required. Shown as the heading when the player arrives. |
| `description` | *Text.* Shown on arrival and on `look`. |
| `firstVisit` | *Text.* Shown after the description, the first time only. |
| `dark` | `true` if the room is dark without a light source. Can be changed later with `{"set": "cellar.dark", "to": false}`. |
| `region` | Id of the region the room belongs to ([section 9](#9-story-structure-acts-regions-events-scores-endings)). |
| `exits` | Object of direction → exit (below). |
| `noExit` | *Text* shown when the player tries a direction with no exit. Default: "You can't go that way." |
| `tags` | List of words, for your own grouping. |
| `props` | Your own properties with starting values ([section 10.1](#101-variables-and-properties)). |

**Directions** are `north`, `south`, `east`, `west`, `northeast`, `northwest`,
`southeast`, `southwest`, `up`, `down`, `in` and `out`. The player can type
them in full or as `n`, `s`, `e`, `w`, `ne`, `nw`, `se`, `sw`, `u`, `d`, and
`inside`, `outside` for in and out. Packs can add more
([section 11](#11-verbs-directions-and-messages)).

### Exits

The simplest exit is the id of the room it leads to: `"east": "livery"`. The
full form is an object:

| Field | Meaning |
|---|---|
| `to` | Room it leads to. Without `to`, the exit is a dead end that only prints `say`. |
| `door` | Id of a door object. The exit is passable only while the door is open. |
| `if` | Condition. If false, the exit is blocked. |
| `else` | *Text* shown when `if` is false. Default: "You can't go that way." |
| `say` | *Text* shown when the player uses the exit (before arriving), or, with no `to`, the refusal. |
| `do` | Effects run when the player uses the exit (also when an exit without `to` is tried). |

```json
"exits": {
  "north": { "to": "study", "door": "study-door" },
  "up": { "to": "attic", "if": { "obj": "ladder", "in": "hall" }, "else": "The trapdoor is too high to reach." },
  "south": { "say": "The front door is barred from outside." },
  "down": { "to": "cellar", "say": "The steps are slick with damp." }
}
```

A door needs an exit on each side, both naming the door, and the door object
must be `foundIn` both rooms ([section 7](#7-objects)).

When the player arrives the engine prints the room name, the description (in
full, unless the player has chosen `brief` and has been here before), the
`firstVisit` text the first time, then what is in the room: objects with an
`initial` text get their own sentence, the rest are listed as "You can see a
lariat and a lantern here.", then the contents of visible containers and
surfaces, then the characters.

## 7. Objects

```json
"objects": {
  "lariat": {
    "name": "lariat",
    "nouns": ["lariat", "rope", "lasso", "loop"],
    "location": "peg",
    "description": "Thirty feet of stiff grass rope."
  }
}
```

### Naming

| Field | Meaning |
|---|---|
| `name` | Required. How the object is named in text: "glass jar". |
| `nouns` | Words that name it. Default: the last word of `name`. |
| `adjectives` | Words that describe it: `["glass", "small"]`. |
| `article` | "a", "an", "some", or "" for none. Default: "an" before a vowel letter, otherwise "a" ("some" if `plural`). Set it where that is wrong: "an hour", "a unicorn". |
| `proper` | `true` for proper names (no "the"). |
| `plural` | `true` for things named in the plural ("sugar lumps"). |

The player can use any of the object's nouns, adjectives and the words of its
name, in any combination: `jar`, `glass jar`, `small glass jar`. All the words
must belong to the object. Words are single lower-case words; use hyphens
inside a word if needed (`"sun-bonnet"`). Apostrophes are ignored, so
`"sheriffs"` matches what the player types as `sheriff's`.

When two objects in reach share a word, the parser asks "Which do you mean,
the brass key or the iron key?" and the player answers with a distinguishing
word. Give similar objects different adjectives. Never use these words as
nouns or adjectives: `a`, `an`, `the`, `all`, `everything`, `but`, `except`,
`and`, `then`, `it`, `them`, `him`, `her`.

### Texts

| Field | Meaning |
|---|---|
| `description` | *Text* for `examine`. Default: "You see nothing special about the X." |
| `initial` | *Text* shown in the room description until the player first has the object (by taking it, or by a rule putting it in their hands). Use it for anything you want described in place: "A lantern hangs from a nail by the door." Not shown for `scenery`. |
| `read` | *Text* for `read`. Without it, `read` examines. |

### Where it is

| Field | Meaning |
|---|---|
| `location` | Where it starts: a room id, a container or surface id, a character id, or `"player"`. Leave it out for objects that start offstage and are brought in by an effect. |
| `foundIn` | List of rooms for a fixed thing that is in several rooms at once: doors, a river, the sky. |

### What it is

| Field | Default | Meaning |
|---|---|---|
| `fixed` | false | Can't be taken. `true`, or a refusal message: `"The anvil weighs as much as a horse."` |
| `scenery` | false | Fixed, and not listed in the room description: mention it in the room's own text. |
| `container` | false | Things can be put in it. |
| `surface` | false | Things can be put on it. |
| `openable` | false | Can be opened and closed. A container that is not openable is always open. |
| `open` | false | Starts open (for openable things). |
| `transparent` | false | Its contents can be seen when it is closed (but not taken). |
| `capacity` | none | How many things fit in or on it. |
| `lockable` | if `key` or `locked` | Can be locked and unlocked. |
| `locked` | false | Starts locked. |
| `key` | none | Id (or list of ids) of the key(s) that fit. |
| `door` | false | It is a door: fixed and openable; use it in exits. |
| `wearable` | false | Can be worn. |
| `worn` | false | Starts worn (with `location: "player"`). |
| `switchable` | false | Can be switched on and off. |
| `on` | false | Starts switched on. |
| `light` | false | Gives light: always, or only while on if it is switchable. |
| `edible` | false | Can be eaten (it disappears). |
| `drinkable` | false | Can be drunk (it disappears unless fixed). |
| `tags` | none | Words for grouping; rules can match `"#tag"`. |
| `props` | none | Your own properties ([section 10.1](#101-variables-and-properties)). |

Examples:

```json
"locker": { "name": "storage locker", "nouns": ["locker"], "adjectives": ["storage"],
  "location": "quarters", "scenery": true, "container": true, "openable": true },
"case": { "name": "glass case", "nouns": ["case"], "adjectives": ["glass"],
  "location": "attic", "fixed": true, "container": true, "transparent": true,
  "openable": true, "locked": true, "key": "iron-key" },
"study-door": { "name": "study door", "nouns": ["door"], "adjectives": ["study"],
  "door": true, "locked": true, "key": "brass-key", "foundIn": ["hall", "study"] },
"torch": { "name": "hand torch", "nouns": ["torch", "light"], "adjectives": ["hand"],
  "location": "locker", "switchable": true, "light": true, "props": { "battery": 60 } }
```

**Every portable object must be obtainable.** The validator reports objects
that start nowhere and are never moved anywhere the player can reach. If an
object is not meant to be taken, make it `fixed` or `scenery`.

## 8. Characters and conversation

Characters take all the object fields, though they can never be taken, plus:

| Field | Meaning |
|---|---|
| `pronoun` | `"him"`, `"her"`, `"them"` or `"it"`. Lets the player say `ask her about the mare`. Default `"them"`. |
| `initial` | *Text* that introduces them in a room description. Default: "The sheriff is here." |
| `talk` | *Text* for `talk to`. If the character has a conversation menu, `talk to` opens that instead, and this text is used only when none of the menu's `entry` nodes applies. |
| `topics` | List of topics for `ask X about ...` and `tell X about ...` (below). |
| `noTopic` | *Text* when no topic matches. |
| `wander` | `{"rooms": [ids], "chance": 0.3}`: each turn, with that probability, the character walks through an exit to one of those rooms. Closed doors stop them; exit conditions do not. A character who is `following` does not wander. |
| `following` | `true` to start following the player. Usually set later: `{"set": "dog.following", "to": true}`. A following character walks with the player through exits. |
| `arrive`, `depart` | *Text* when a wandering character comes in or leaves. |

Characters with a capitalised `name` are treated as proper names ("Ada
Pruitt", not "the Ada Pruitt"). Things a character holds (`"location":
"ada"`) are visible but cannot be taken.

### Topics

```json
"topics": [
  { "keys": ["shed"], "if": { "act": "morning" }, "text": "\"Shut till evening,\" he says." },
  { "keys": ["shed"], "text": "\"It's open now,\" he says." },
  { "id": "secret", "keys": ["secret", "ring"], "once": true,
    "text": "He leans close. \"The ring is in the attic.\"", "do": [{ "set": "knows-ring", "to": true }] }
]
```

| Field | Meaning |
|---|---|
| `keys` | Required. Words or phrases. A key matches if all of its words appear in what the player asked about: key `"rose"` matches `ask about the rose bed`. Articles (`a`, `an`, `the`) are ignored on both sides. |
| `text` | Required. *Text* of the answer. |
| `if` | Condition for this topic to be available. |
| `do` | Effects run after the answer. |
| `once` | Answer only once; afterwards the next matching topic (or `noTopic`) answers. |
| `id` | Optional name, for your own reference. Ids belong to their character, so two characters can both have a topic `secret`. |

The **first** matching topic in the list answers, so put conditional topics
before their general fallback. A matching topic counts as success, so
after-rules on `ask` and `tell` run.

**Answers.** The standard verb `answer` covers `answer X with Y`,
`answer Y to X`, `reply Y`, and a bare `yes` or `no`. Outside a menu it goes
to rules (`"on": "answer"`) and then to the character's topics, so a key
`"yes"` answers a question the character asked in its `talk` text. A bare
answer goes to the last character who spoke, if they are still here, or else
to the only character in the room.

### Conversation menus

A conversation menu gives a character numbered things the player can say.
It goes in the `dialogues` section, keyed by the character's id, and can sit
in a file of its own:

```json
"dialogues": {
  "hale": {
    "entry": [
      { "if": { "act": "departure" }, "node": "paid" },
      { "node": "start" }
    ],
    "leave": "Mrs Hale goes back to polishing glasses.",
    "nodes": {
      "start": {
        "say": "\"Well?\" says Mrs Hale.",
        "options": [
          { "id": "bill", "text": "\"What do I owe you?\"", "keys": ["bill"], "once": true,
            "reply": "\"Two shillings. Your bag stays with me until it's paid.\"" },
          { "id": "letter", "text": "\"My sister has written. I must go home.\"",
            "if": { "has": "letter" }, "locked": "(if you had news to tell her)",
            "reply": "Her face softens. \"Then pay up and go.\"", "then": "end" }
        ]
      },
      "paid": { "say": "\"Off you go,\" says Mrs Hale." }
    }
  }
}
```

`talk to hale` then shows:

```
"Well?" says Mrs Hale.
  1. "What do I owe you?"
     "My sister has written. I must go home." (if you had news to tell her)
  0. Leave
```

A dialogue is a set of **nodes**, each a point in the conversation with
something the character says and a list of **options** for the player.

| Dialogue field | Meaning |
|---|---|
| `nodes` | Required. Object of node id → node. |
| `entry` | Where `talk to` starts: a list of `{"if": condition, "node": id}`, first match wins. Without `entry`, or if none applies, the node called `start`. If there is no such node either, `talk to` falls back to the character's `talk` text. |
| `leave` | *Text* when the player leaves the conversation with `0` or a leave word. |
| `resume` | `false` to start from `entry` every time, instead of resuming an interrupted conversation (below). Default `true`. |
| `resumeText` | *Text* when an interrupted conversation resumes, unless the node it resumes at has its own. Default: "Mrs Hale picks up where you left off." (message `resumeConversation`). |

| Node field | Meaning |
|---|---|
| `say` | *Text* the character says on arriving at this node. |
| `do` | Effects run on arriving at this node. |
| `options` | List of options, shown in this order. |
| `resumeText` | *Text* when an interrupted conversation resumes at this node, instead of the dialogue's. Useful on a node that asks a question: `"\"Well? Have you seen her or not?\""` reads better than "Where were we?". |
| `noLeave` | `true` to drop `0. Leave`: the player must choose. Commands other than meta commands (`save`, `undo`, `score`...) get "Choose one of the numbered options." Use it for a moment that demands an answer, and give such a node at least one option that is always shown. |

| Option field | Meaning |
|---|---|
| `id` | Required. Unique within this dialogue. Used by `said` and by walkthroughs. |
| `text` | Required. *Text* of the option as listed. |
| `if` | Condition for the option to be offered. |
| `locked` | *Text* shown, unnumbered, after the option's text while its `if` is false. Without it, an unavailable option is hidden. Showing a locked option tells the player a door exists. |
| `once` | Offer it only until it has been chosen. |
| `keys` | Words the player can type to choose it, as well as its number: `["yes"]`, `["no", "nope"]`. |
| `line` | *Text* printed when chosen, if it should differ from `text`: `"You hold out your purse."` Default: `text`. |
| `reply` | *Text* of the character's answer. |
| `do` | Effects run after the reply. |
| `then` | Node to go to next, or `"end"` to close the conversation. Without it the conversation stays at this node and lists its options again. |

**How it plays.**

- The player types a number, or an option's `keys`, or `answer hale with
  bill`, or `say bill`. On the web page they can also click an option.
- Choosing an option is one game turn: undo goes back one choice, and timed
  events and wandering characters carry on while people talk, so an event can
  interrupt a conversation.
- `0`, `leave`, `bye`, `goodbye` or `farewell` leaves it, with the `leave`
  text.
- Any other command closes the menu quietly and runs as usual: `north` walks
  away, `look` looks, `ask hale about coach` asks. The character remembers
  where the conversation stopped, and the next `talk to` picks up there with
  the `resumeText` line, without repeating the node's `say` or `do`. Leaving
  properly, or reaching `"then": "end"`, forgets it, so the next `talk to`
  starts from `entry`.
- Meta commands (`save`, `restore`, `undo`, `score`) and typing mistakes keep
  the menu open. `talk to` the same character shows it again.
- If the character leaves the room, or the player does, the conversation is
  interrupted in the same way.

**Memory and relationships.** Every option chosen is remembered: the
condition `{"said": "hale.bill"}` is true once the player has chosen option
`bill` in Mrs Hale's dialogue, so later options, topics, descriptions and
rules can refer back to it. For how a character feels about the player, give
the character a property (`"props": {"trust": 0}`), change it in options'
`do` (`{"inc": "hale.trust"}`), and test it in `if` and `entry`
(`{"var": "hale.trust", "gte": 2}`). The western demo pack does this with Ada.

**Opening a conversation from a rule.** The effect `{"converse": "hale"}`
opens Mrs Hale's menu just as `talk to hale` would: where an interrupted
conversation left off, or else from `entry`. `{"converse": "hale", "node":
"paid"}` opens it at that node, whatever was interrupted. Put it in an
`arrive` rule to have a character speak first. Think about what happens when
the player walks out and comes back:

- `"once": true` makes the character speak only the first time. Afterwards
  they stand there until the player thinks to `talk to` them, which players
  read as the conversation having vanished.
- Without `once`, they speak on every arrival, which suits a question they
  are waiting for an answer to. Stop it when the answer is given: set a
  property in each answering option's `do`, and test it in the rule's `if`.
  The western's Ada works this way; see its `world/talk.json`.
- A question node with its own `resumeText` re-asks the question in the
  character's words when the player comes back mid-question.

**Walkthroughs** choose options by id, not number, so adding an option above
one does not break them: a line `@hale.bill` chooses option `bill` of Mrs
Hale's menu, and fails the walkthrough if it is not on screen
([section 13](#walkthroughs)).

## 9. Story structure: acts, regions, events, scores, endings

### Acts

```json
"acts": [
  { "id": "arrival", "title": "Chapter One: The Inn" },
  { "id": "departure", "title": "Chapter Two: The Road", "intro": "@departure",
    "do": [{ "schedule": "coach-leaves", "in": 4 }] }
]
```

| Field | Meaning |
|---|---|
| `id` | Required. |
| `title` | Shown as a heading when the act starts. |
| `intro` | *Text* shown after the title. |
| `do` | Effects run when the act starts: move characters, change descriptions, start timers. |

The first act starts by itself when the game begins (after the pack's
`intro`). Later acts start when an effect runs `{"act": "id"}`. The conditions
`{"act": "id"}` (exactly this act) and `{"actAtLeast": "id"}` (this act or
any later one in the list) let you make anything depend on how far the story
has got.

### Regions

```json
"regions": {
  "road": {
    "if": { "actAtLeast": "departure" },
    "else": "Mrs Hale has your bag behind the bar. You won't get far without it."
  }
}
```

| Field | Meaning |
|---|---|
| `name` | Optional display name, for your own reference. |
| `if` | Condition for entering the region from outside it. |
| `else` | *Text* shown when the player is stopped. Default: "You can't go that way." |

A room joins a region with `"region": "road"`. When the player tries to walk
into a region from outside it and the region's `if` is false, they are
stopped with its `else` text. A region also works as a place in conditions
(`{"region": "road"}`) and in a rule's `in` matcher. Regions used only for
grouping need no entry in `regions`.

### Events (timers)

```json
"events": {
  "coach-leaves": {
    "if": { "not": { "at": "road-north" } },
    "say": "Out on the road, a horn sounds twice. The coach is gone.",
    "do": [{ "end": "stranded" }]
  }
}
```

An effect `{"schedule": "coach-leaves", "in": 4}` makes the event happen at
the end of the fourth turn after the current one: scheduled during turn 10,
it fires at the end of turn 14. Scheduling an event that is already
waiting restarts its count; `{"cancel": "coach-leaves"}` stops it. When it
fires, its `if` is checked; if it holds, `say` is printed and `do` runs. If
the `if` does not hold, the event is used up all the same: schedule it again
from its `do` or from a rule if it should try later. For something that
should be checked every turn, use an `everyTurn` rule
([section 10.4](#104-rules)) instead.

### Scores

```json
"scores": { "paid": 5, "caught-coach": { "points": 10, "note": "Reaching the coach" } }
```

An effect `{"award": "paid"}` adds the points once: awarding the same item
again does nothing, so you can award from more than one rule safely. The
maximum score is the total of the positive score items; an item with negative
points is a penalty. The `score` command reports the score. A pack with no
score items is unscored, and its endings show no final score.

### Endings

```json
"endings": {
  "on-the-road": { "title": "You are on the road", "text": "@ending-road", "win": true },
  "stranded": { "title": "You missed the coach", "text": "Another week at the inn, then." }
}
```

| Field | Meaning |
|---|---|
| `title` | Required. Shown as `*** title ***`. |
| `text` | *Text* of the epilogue. |
| `win` | `true` for a winning ending. |

`{"end": "stranded"}` ends the game at once: nothing after it runs. The
player sees `*** title ***`, the text, the final score, and an invitation to
restart, restore, undo or quit. Mark the winning ending(s) with `"win": true`.

## 10. Logic: variables, conditions, effects, rules

### 10.1 Variables and properties

**Variables** are named values (a number, a string, true/false or null) that
you declare with their starting value:

```json
"vars": { "knocks": 0, "warned-about-wolves": false, "password": "" }
```

**Properties** are values attached to a room, object or character, written
`id.property`. Every object and room has these standard properties:

| Property | Meaning |
|---|---|
| `open`, `locked`, `on`, `worn` | As described in [section 7](#7-objects). |
| `moved` | True once the player has had it in hand, by taking it or because an effect moved it to `"player"` (its `initial` text then stops). |
| `visited` | For rooms: the player has seen it. |
| `dark` | For rooms. |
| `following` | For characters. |

Declare your own properties, with starting values, in the object's or room's
`props`: `"props": { "fuel": 8, "aligned": false }`, then use them as
`lamp.fuel`. Using an undeclared variable or property is an error, which
catches typos.

Read-only built-in variables: `turns`, `score`, `maxScore`, `room` (the
player's room id) and `act` (the current act id).

### 10.2 Conditions

A condition is a small JSON object. Each has exactly one form:

| Condition | True when |
|---|---|
| `{"var": "x"}` | variable or property `x` is true, non-zero and non-empty |
| `{"var": "x", "eq": v}` | equals `v`. Also `ne`, and for numbers `gt`, `gte`, `lt`, `lte`. One comparison per condition. |
| `{"has": "id"}` | the player carries it (also inside something carried) |
| `{"wearing": "id"}` | the player is wearing it |
| `{"at": "room"}` or `{"at": ["a", "b"]}` | the player is in that room (or one of them) |
| `{"region": "id"}` | the player is in a room of that region |
| `{"here": "id"}` | the thing is in the player's room (anywhere in it, carried included, lit or not) |
| `{"obj": "id", "in": "place"}` | the thing's direct location is `place`: a room, container, surface, character, `"player"` or `"nowhere"` |
| `{"visited": "room"}` | the player has seen that room |
| `{"said": "hale.bill"}` | the player has chosen option `bill` in that character's conversation menu ([section 8](#conversation-menus)) |
| `{"act": "id"}` | the current act is this one |
| `{"actAtLeast": "id"}` | the current act is this one or a later one |
| `{"light": true}` | the player's room is lit (`false`: dark) |
| `{"chance": 0.25}` | a 25% chance, from the game's seeded random generator |
| `{"all": [conditions]}` | all are true |
| `{"any": [conditions]}` | at least one is true |
| `{"not": condition}` | it is false |
| `{"script": "name", "args": ...}` | a script condition returns true ([section 12](#12-script-modules)) |

### 10.3 Effects

Effects are lists of small JSON objects, run in order:

| Effect | Does |
|---|---|
| `{"say": text}` | prints text |
| `{"sayRandom": [text, text, ...]}` | prints one of them, chosen by the seeded random generator |
| `{"set": "x", "to": value}` | sets a variable or property |
| `{"inc": "x"}`, `{"inc": "x", "by": 5}` | adds 1 (or `by`) |
| `{"dec": "x"}`, `{"dec": "x", "by": 5}` | subtracts 1 (or `by`) |
| `{"move": "id", "to": "place"}` | moves an object or character to a room, container, surface, character, `"player"` (into the player's hands), `"here"` (the player's room) or `"nowhere"` (out of the game). Nothing is printed; say what happened yourself. |
| `{"movePlayer": "room"}` | moves the player, describes the room and runs its `arrive` rules (followers do not come along) |
| `{"award": "score-id"}` | awards a score item, once |
| `{"act": "id"}` | starts an act |
| `{"schedule": "event-id", "in": n}` | the event happens at the end of the nth turn after this one |
| `{"cancel": "event-id"}` | stops a scheduled event |
| `{"end": "ending-id"}` | ends the game |
| `{"if": condition, "then": [effects], "else": [effects]}` | runs one branch |
| `{"look": true}` | describes the player's room in full |
| `{"converse": "hale"}`, `{"converse": "hale", "node": "paid"}` | opens that character's conversation menu as `talk to` would (resuming an interrupted conversation, or from its `entry`), or at a given node ([section 8](#conversation-menus)). Nothing happens if they are not in the room. |
| `{"script": "name", "args": ...}` | runs a script effect |

### 10.4 Rules

Rules are how a pack changes what happens. A rule says: when the player tries
*this action*, on *these things*, *here*, *if this is true*, then *say this and
do that*.

```json
"rules": [
  {
    "id": "give-sugar",
    "on": "give", "object": "sugar", "with": "mare",
    "if": { "has": "sugar" },
    "say": "She crunches the sugar. Some of the white goes out of her eye.",
    "do": [{ "move": "sugar", "to": "nowhere" }, { "set": "mare.calm", "to": true }, { "award": "calmed" }]
  }
]
```

| Field | Meaning |
|---|---|
| `on` | Required. A verb id or a list of them ([Appendix A](#appendix-a-standard-verbs) and your own verbs), or a pseudo-action: `start`, `arrive`, `everyTurn`. |
| `when` | `"before"` (default) or `"after"`. |
| `object` | Matches the command's first object: an id, a list of ids, `"#tag"` for any thing with that tag, or `"*"` for any object at all. |
| `with` | Matches the second object, the same way ("give **object** to **with**"). |
| `dir` | For `go`: a direction or list of directions. |
| `topic` | For verbs with free text (`ask`, `tell`, `say`, and your own `TEXT` verbs): a word or phrase, or a list. Matches if all its words are in what the player typed. |
| `in` | Room id or region id (or a list) the player must be in when the rule runs. For an after-rule on `go`, that is the room just arrived in. |
| `if` | Condition. |
| `say` | *Text* printed when the rule runs. |
| `do` | Effects run after `say`. |
| `continue` | `true` lets the next matching rule (or, for a before-rule, the standard behaviour) run after this one. |
| `once` | The rule runs only once per game. |
| `priority` | A number; higher runs first. Default 0. |
| `id` | Optional name; shown in error messages. Recommended. |

**Before-rules** (the default) run before the standard behaviour. The first
before-rule that matches *replaces* the standard behaviour: the standard
response is not printed, and no later rules run. With `"continue": true` the
rule runs and then the next matching rule, or the standard behaviour, carries
on. Use before-rules for almost everything: puzzles, refusals, special
responses.

Before-rules also run before any of the standard checks: whether the player
holds the thing, can reach it, whether a container is closed. A before-rule
that should only work when the player holds something must test it
(`{"has": "sugar"}`).

**After-rules** run only when the standard behaviour *succeeded*, after its
response: after the player really took the thing, really opened the door,
really walked into the room. Use them to react to success: award points when
the ring is taken. As with before-rules, the first matching after-rule stops
the rest unless it has `"continue": true`. Many standard verbs never succeed by default (`push`,
`pull`, `turn`, `attack`, `give`, `show`, `use`, `climb`, `say`, and pack
verbs that only have a default response), so **after-rules on those verbs
never run: use before-rules for them.** [Appendix A](#appendix-a-standard-verbs)
says which verbs succeed.

**Pseudo-actions** let rules join the turn loop. For these, *every* matching
rule runs, whatever `continue` says, and `when` does not matter:

- `start`: once, when the game begins (after the intro and first act, before
  the first room description).
- `arrive`: whenever the player arrives in a room, after it is described. Use
  `in` to choose the room.
- `everyTurn`: at the end of every turn. Use `if` and `in` to limit it. This is
  how background processes work: a lamp burning oil, air running out. (Not to
  be confused with the standard verb `turn`, as in "turn the wheel".)

**Order.** Rules are tried by `priority` (highest first), then by
specificity, then in load order (file path, then position in the file).
Specificity is a score: `object` and `with` naming ids count 8 each (6 for a
`#tag`, 1 for `"*"`), `dir` and `topic` 4 each, `in` 2, and `if` 1. So a rule
naming an object beats one naming only a room and a condition, and you can
write a specific rule and a general fallback for the same verb in any order.
When that is not the order you want, set `priority`.

**One turn.** Every command that is understood takes one turn, even one that
fails ("It seems to be locked."), except the meta commands (score, save,
restore, undo, help, about, verbose, brief, restart, quit). `again` repeats
the last command, which takes its turn as usual. At the end of each turn: due
events fire, `everyTurn` rules run, wandering characters move, and if the
light in the player's room changed, the player is told.

**What the player types.** Input is split into separate commands at `.`, `;`,
`!`, `?` and the word `then`; apostrophes are removed and `a`, `an`, `the`
dropped. So a password or code for a `TEXT` verb must be one plain word or
number, or a phrase without those characters.

## 11. Verbs, directions and messages

### Verbs

The standard verbs are listed in [Appendix A](#appendix-a-standard-verbs). Add
your own:

```json
"verbs": {
  "lasso": {
    "patterns": ["lasso/rope OBJ", "throw lariat/rope/lasso/loop at/over/on OBJ"],
    "default": "You shake out a loop and drop it over {the:noun}. Nothing comes of it."
  },
  "type": { "patterns": ["type/key TEXT", "type/key TEXT on/into OBJ"], "default": "Nothing happens." },
  "whistle": { "patterns": ["whistle"] }
}
```

| Field | Meaning |
|---|---|
| `patterns` | Required for a new verb. What the player can type. |
| `default` | *Text* shown when no rule handles the verb. This counts as failure, so after-rules do not run. |
| `multi` | `true` lets the player use `all` and lists ("lasso all"). |
| `meta` | `true` for a command that takes no game time. |

A **pattern** is a sequence of words and slots:

- Lower-case words must be typed as they are. `a/b/c` means any one of them.
- `OBJ` is an object or character in reach; `OBJ2` is a second one.
- `TEXT` is any free text (passwords, topics, numbers). Rules match it with
  `topic`.
- `DIR` is a direction word.

The articles `a`, `an` and `the` are removed from what the player types before
matching, so do not put them in patterns. When several patterns fit, the one
with the most literal words wins: `throw lariat at OBJ` beats the standard
`throw OBJ at OBJ2`. Give every verb the synonyms a player might try.

To add phrasings to a **standard** verb, use its id and give only
`patterns`. Your patterns are added to the standard ones (a `default` there is
ignored, with a warning: change a standard response with a rule or a message):

```json
"verbs": { "give": { "patterns": ["feed OBJ to OBJ2", "feed OBJ2 OBJ"] } }
```

What a new verb *does* is written in rules (`"on": "lasso"`), or in a script
action ([section 12](#12-script-modules)). The validator warns when one of
your patterns is shadowed by, or shadows, a pattern of a different verb.

### Directions

```json
"directions": {
  "upstream": { "words": ["upstream"], "opposite": "downstream" },
  "downstream": { "words": ["downstream"], "opposite": "upstream" }
}
```

| Field | Meaning |
|---|---|
| `words` | Required. What the player can type for it. Each word may belong to only one direction. |
| `opposite` | The id of the opposite direction. Recorded for consistency; the engine does not use it yet. |

A new direction can then be used in exits and typed by the player. Giving the
id of a standard direction adds words to it: `"up": {"words": ["upstairs"]}`.

### Messages

Every standard response can be replaced to suit the story's voice:

```json
"messages": {
  "cantGo": "There's no trail that way.",
  "taken": "You take {it:noun}.",
  "dark": "It's black as the inside of a boot."
}
```

An empty string suppresses a message. [Appendix B](#appendix-b-standard-messages)
lists every key with its default text and the templates it uses.

## 12. Script modules

Use a script only when rules cannot express what you need: arithmetic over
several things, searching the map, a mechanic with many cases. A script is an
ES module in `scripts/` that registers named conditions, effects and verb
handlers:

```js
// scripts/whistle.js
export default function register(api) {
  api.action('whistle', (ctx) => {
    const here = ctx.room();
    const mare = ctx.locationOf('mare');
    const neighbours = Object.values(ctx.exits(here));
    if (ctx.get('mare.calm') && neighbours.includes(mare)) {
      ctx.move('mare', here);
      ctx.say('A moment later the mare trots up, looking for more sugar.');
      return true;
    }
    ctx.say('Your whistle carries down the street. Nothing comes of it.');
    return false;
  });

  api.condition('carrying-many', (ctx) => ctx.contents('player').length >= ctx.args.n);
  api.effect('tally', (ctx) => ctx.say(`You count ${ctx.contents('player').length} things.`));
}
```

- `api.action(verbId, fn)` handles one of *your* verbs (not a standard verb)
  when no before-rule stopped it. Return `false` if the action failed; any
  other return value (or none) counts as success, so after-rules run.
- `api.condition(name, fn)` is used as `{"script": "carrying-many", "args": {"n": 3}}`.
- `api.effect(name, fn)` is used as `{"script": "tally"}`.

The `ctx` object passed to each function:

| Member | Meaning |
|---|---|
| `action`, `noun`, `second`, `topic`, `dir` | The current command. |
| `args` | The `args` value from the rule. |
| `turns`, `score` | Current turn and score. |
| `say(text)` | Print text (passage references and templates work). |
| `passage(key)` | The text of a passage. |
| `get(ref)`, `set(ref, value)` | Read and write variables and properties (`"gold"`, `"lamp.fuel"`). |
| `locationOf(id)` | Where something is: room, container, character, `"player"`, or null. |
| `move(id, to)` | Move something: to a room or thing id, `"player"`, `"here"`, or `"nowhere"` (or null) to remove it. |
| `movePlayer(room)` | Move the player and describe the room. |
| `room()` | The player's room. |
| `exits(room)` | That room's exits as `{direction: room}` (ignores conditions and doors). |
| `contents(id)` | Ids directly inside a room, container, character or `"player"`. |
| `isHeld(id)`, `isVisible(id)`, `isLit()` | Questions about the world. |
| `name(id)`, `the(id)`, `a(id)` | Names for text. |
| `random()`, `randomInt(n)` | The game's seeded random numbers. |
| `test(condition)`, `run(effects)` | Use declarative conditions and effects. |
| `award(id)`, `end(id)`, `schedule(id, turns)`, `cancel(id)` | As the effects of the same names. |

**Three rules for scripts**, or saving, undo and replay break:

1. Keep all state in variables and properties (`ctx.set`). Never keep values
   in module-level variables between calls.
2. Use only `ctx.random()` and `ctx.randomInt()` for chance. Never
   `Math.random()` or the clock.
3. A script must be one self-contained file: it cannot import other files.

The validator plays each walkthrough twice and reports an error if the two
runs differ, which catches most breaches of rules 1 and 2. Scripts are
trusted code: they run with full access to the page or the process, so only
load packs from people you trust.

## 13. Tools: validate, play, walkthrough

Run these from the story-engine repository (Node.js 22.18 or later). `<pack>`
is the path to your pack directory, wherever it is.

```sh
node src/cli/main.ts validate <pack>         # check everything, play the walkthroughs
node src/cli/main.ts play <pack> --seed 1    # play it yourself
node src/cli/main.ts walkthrough <pack>      # print full walkthrough transcripts
node src/cli/main.ts walkthrough <pack> win  # just walkthroughs/win.txt
node src/cli/main.ts bundle <pack> -o x.json # one-file version for the web page
```

You can also open the web page (`npm run build`, then `site/index.html`) and
use **Open folder…** to play your pack directory in a browser.

### What validate checks

- **Shape**: unknown fields (with "did you mean"), wrong types, bad ids,
  missing required fields, duplicate ids across files, malformed conditions
  and effects, text outside passages.
- **References**: every id used anywhere (exits, doors, keys, locations, rule
  matchers, conditions, effects, `@passages`, `{the:id}` templates, verbs in
  `on`, script names) must exist; variables and properties must be declared.
- **Reachability**: every room must be reachable from the start by exits or a
  `movePlayer` effect. Exit conditions are ignored here, so this finds rooms
  you forgot to connect, not puzzles that are too hard.
- **Obtainability**: every portable object must start somewhere reachable or
  be moved there by some effect.
- **Vocabulary**: objects with exactly the same words but different names,
  parser keywords used as words, objects with no usable words, verb patterns
  that clash.
- **Conversation menus**: every `entry`, `then` and `converse` node exists;
  every `said` names a real option; option ids are unique in each dialogue;
  every node can be reached from `entry`, `start`, a `then` or a `converse`
  effect; a `noLeave` node has options. (An unreachable node is a warning,
  not an error, if the pack has scripts, since a script can open it.)
- **Unused content** (warnings): passages, endings, score items, events and
  acts that nothing uses.
- **Walkthroughs**: each one is played; it must reach its declared ending with
  no command misunderstood ("I don't know the word...", "You can't see any such
  thing.", "Which do you mean...?"). Each is played twice to check the game is
  deterministic.

The validator cannot see inside scripts. If a script makes a room reachable or
an object obtainable, or is the only thing that uses a passage, ending, score
item, event or act, list those ids in the `validator` section so the checks
and warnings take it into account:

```json
"validator": {
  "assumeReachable": ["secret-garden"],
  "assumeObtainable": ["silver-key"],
  "assumeUsed": ["ending-by-script", "passage-by-script"]
}
```

Templates in passages are checked like any other text.

### Walkthroughs

One file per ending in `walkthroughs/`:

```
# expect: on-the-road
# score: 15
# seed: 1
e
take letter
give purse to hale
w
n
```

- `# expect:` (required) is the ending id the walkthrough must reach.
- `# score:` (optional) is the final score it must have. Use it on the winning
  walkthrough with the maximum score.
- `# seed:` (optional, default 1) fixes the random generator, so wandering
  characters and `chance` behave the same every time.
- One command per line. Other lines starting with `#` are comments.
- `@hale.bill` chooses option `bill` in Mrs Hale's conversation menu,
  whatever its number. The walkthrough fails if that option is not on
  screen. The transcript shows the number it stood for: `> 1 (@hale.bill)`.
- Every command must be complete and understood. A command that makes the
  parser ask a question ("Which do you mean...?", "What do you want to
  take?") fails the walkthrough even if the next line answers it: write
  `take brass key`, not `take key` then `brass`.
- The game must not end before the last command.

### Debugging tips

- `save` in `play` writes `<pack-id>-<slot>.sav.json` into the current
  directory; use `--saves <dir>` to keep save files out of your pack and the
  repository.
- `play` with `--seed` and the same commands always gives the same game.
  Pipe commands in to reproduce a problem:
  `printf 'e\ntake rope\n' | node src/cli/main.ts play <pack> --seed 1`.
- If a rule does not fire: check `on` (is the action the one you think? `put X
  in Y` is `putIn`, `take off X` is `takeOff`), check `object`/`with` order,
  check `in`, check the `if`, and check whether a more specific or higher
  priority rule fires first.
- If an after-rule never runs, the standard behaviour probably failed or never
  succeeds. Use a before-rule.
- If the parser says "You can't see any such thing", the object is not in reach
  (another room, a closed container, darkness) or the words do not match its
  nouns and adjectives.

## 14. Recipes

**A locked door with a key.** Door object with `"door": true, "locked": true,
"key": "brass-key", "foundIn": [both rooms]`; exits on both sides with
`"door": "study-door"`. No rules needed: `unlock door` (using the key the
player holds), `open door`, `north` all work.

**A door opened by a code.** Make the door `"locked": true` with no `key`, add
a `TEXT` verb (`type`), and a rule with `"topic": "4471"` that sets
`door.locked` false and `door.open` true. Add a fallback rule for wrong codes,
and a rule on `open`/`unlock` that tells the player how this door works
(without one, `unlock door` says "There is no keyhole in the door.").

**Something hidden until searched.** Leave the object with no `location`. A
before-rule on `search` (or `lookUnder`) for the hiding place, `"once": true`,
says "You find a key." and does `{"move": "key", "to": "here"}`.

**A character who wants something.** A before-rule `"on": "give", "object":
"apple", "with": "gardener"` that moves the apple to `nowhere` (or to the
gardener), says thanks, awards points and perhaps starts the next act.

**A light source that runs out.** Give it `"props": {"fuel": 40}`. An
`everyTurn` rule with `"if": {"var": "lamp.on"}` that decrements `lamp.fuel`, warns at a
low value, and at zero sets `lamp.on` false. A before-rule on `switchOn` that
refuses when fuel is zero.

**Two ways past an obstacle (a soft gate).** The western's mare: sugar
calms her (the best route), or standing still for three turns settles her
(the worse one). Give the obstacle properties (`"props": {"calm": false,
"patience": 0, "settled": false}`). A rule on `wait` in that room increments
`patience`, with a different line for each step so the player can see it
working, and sets `settled` at 3. A `"continue": true` rule on `go` there
resets both, and so does the failed attempt (`lasso` while neither is
true). The success rule accepts either property and says which way it went.
Make the routes cost differently: the best one awards points and teaches a
later trick the other doesn't, and the ending text notices which way the
player took. Clue each route separately: Ada says "don't go crowding her",
the mare is "ready to bolt if you crowd her", and the failed lasso adds "She
won't be rushed."

**Time pressure.** At the moment the pressure starts, schedule the deadline
event, and schedule a warning event a few turns earlier. Cancel both when the
player succeeds.

**Something that happens on arrival, once.** `"on": "arrive", "in": "room",
"once": true, "say": "..."`. Or use the room's `firstVisit`.

**A region that opens later.** Put its rooms in a region with an `if` such as
`{"actAtLeast": "act-three"}` and an `else` that explains why the player
cannot go yet.

**A character who appears in a later act.** Leave out their `location`, and
in the act's `do`: `{"move": "lassiter", "to": "main-street"}`.

**A companion.** `{"set": "weena.following", "to": true}` when the player
befriends them; `false` when they part.

**A death.** A before-rule that says what happens and does `{"end": "eaten"}`
with an ending that is not a win.

**Entering a building or a vehicle.** `enter X` walks through X only when X is
a door used by one of the room's exits. For anything else (a tent, a cave
mouth, a coach) add a before-rule on `enter` for that object that does
`{"movePlayer": "inside-room"}`, or make the way in an ordinary exit
(`"in": "tent-inside"`) and mention it in the description.

## 15. Definition of done

A pack is done when all of these are true:

- [ ] `validate` reports **0 errors and 0 warnings** (content used only by
      scripts is listed in `validator.assumeUsed`).
- [ ] There is a walkthrough for **every ending**, and each passes.
- [ ] The winning walkthrough has `# score:` equal to the maximum score.
- [ ] Every room description names its exits, and directions are consistent.
- [ ] Every object a player is told about can be examined.
- [ ] Every puzzle's obvious wrong attempts get a helpful response.
- [ ] No state makes the game unwinnable without ending it.
- [ ] `pack.json` has title, version, author, source, licence and credits, and
      `about` reads correctly.
- [ ] `LICENSE` holds the pack's licence text.
- [ ] `NOTES.md` records the adaptation decisions (spine, acts, map, puzzles).
- [ ] Anything the engine could not do is written up in `ENGINE-REQUESTS.md`,
      with the workaround used.
- [ ] You have played it yourself from start to finish with `play`, trying
      things a real player would try, and fixed what read badly.

## 16. Licences and credits

- **Your pack has its own licence**, set in `pack.json` (`licence`) with the
  full text in `LICENSE`. Use the licence you have been asked to use. If you
  have not been told, use `CC0-1.0`.
- **The engine's licence (MIT) does not cover packs.** A pack keeps its own
  licence wherever it is loaded.
- **Public-domain sources.** A novel in the public domain can be quoted and
  adapted freely. Record it in `source`: title, author, year of first
  publication, a URL for the edition you used, and `"licence": "Public
  domain"`. Public-domain status depends on the country; note in `source.note`
  where you know it holds (for example, "Public domain in the United States").
- **Project Gutenberg editions.** The novels are public domain, but Project
  Gutenberg's own licence and trademark cover their eBook files. Quote the
  novel's text, not Project Gutenberg's headers and footers, and do not use
  their name in a way that suggests they endorse the pack. Crediting the
  edition you used, with its URL, is fine.
- **Never include text from other games**, or from copyrighted works that are
  not yours to use.
- **Fonts and images in a theme keep their own licences.** A font under the
  SIL Open Font Licence can ship inside a pack under any licence, with its
  licence text next to it in `theme/` and a line in `credits`. The demo packs
  are CC0 apart from their fonts, which are OFL.

## 17. A complete example pack

This small pack shows the pieces working together: a source and credits, two
acts, a region that opens with the second act, a character whose answers
change, a short conversation menu, a passage file with a quoted letter, a
timed event, two endings and their walkthroughs. It validates with no errors or warnings, and both
walkthroughs pass. (The engine's tests check that this copy is still valid.)

`pack.json`:

```json
{
  "format": 1,
  "id": "salt-road",
  "title": "The Salt Road (example)",
  "version": "1.0.0",
  "author": "A. Adapter",
  "licence": "CC0-1.0",
  "description": "A three-room example of a novel adaptation.",
  "source": {
    "title": "The Salt Road",
    "author": "An Imaginary Novelist",
    "year": 1901,
    "licence": "Public domain",
    "note": "The novel is invented for this example."
  },
  "credits": ["Adapted for the story-engine pack guide."],
  "start": "yard",
  "intro": "@intro"
}
```

`world/places.json`:

```json
{
  "regions": {
    "road": {
      "if": { "actAtLeast": "departure" },
      "else": "Mrs Hale has your bag behind the bar. You won't get far without it."
    }
  },
  "rooms": {
    "yard": {
      "name": "Inn Yard",
      "description": "@yard",
      "exits": { "in": "parlour", "east": "parlour", "north": "road-north" }
    },
    "parlour": {
      "name": "Parlour",
      "description": [
        "A low room with a fire. The yard is back out to the west.",
        { "if": { "act": "departure" }, "text": "The fire has burned down to embers." }
      ],
      "exits": { "west": "yard", "out": "yard" }
    },
    "road-north": {
      "name": "The North Road",
      "region": "road",
      "description": "@road",
      "exits": { "south": "yard" }
    }
  },
  "objects": {
    "purse": {
      "name": "purse", "location": "player",
      "description": "Your purse. Three shillings, which is all you have."
    },
    "bag": {
      "name": "travelling bag", "nouns": ["bag"], "adjectives": ["travelling"],
      "location": "hale",
      "description": "Your bag, with everything you own in it."
    },
    "letter": {
      "name": "letter", "location": "parlour",
      "initial": "A letter addressed to you lies on the parlour table.",
      "read": "@letter"
    }
  },
  "characters": {
    "hale": {
      "name": "Mrs Hale", "nouns": ["hale", "innkeeper", "woman"], "pronoun": "her",
      "location": "parlour",
      "description": "The innkeeper, broad and watchful.",
      "initial": "Mrs Hale stands behind the bar.",
      "noTopic": "\"I wouldn't know about that,\" says Mrs Hale.",
      "topics": [
        { "keys": ["bag", "luggage"], "if": { "act": "arrival" },
          "text": "\"Your bag stays with me until the bill is paid,\" she says." },
        { "keys": ["bag", "luggage"], "text": "\"It's yours. Mind the coach.\"" },
        { "keys": ["coach", "road"], "text": "@hale-coach" }
      ]
    }
  }
}
```

`world/story.json`:

```json
{
  "acts": [
    { "id": "arrival", "title": "Chapter One: The Inn" },
    {
      "id": "departure",
      "title": "Chapter Two: The Road",
      "intro": "@departure",
      "do": [{ "schedule": "coach-leaves", "in": 4 }]
    }
  ],
  "scores": { "paid": 5, "caught-coach": 10 },
  "events": {
    "coach-leaves": {
      "if": { "not": { "at": "road-north" } },
      "say": "Out on the road, a horn sounds twice. The coach is gone.",
      "do": [{ "end": "stranded" }]
    }
  },
  "endings": {
    "on-the-road": { "title": "You are on the road", "text": "@ending-road", "win": true },
    "stranded": { "title": "You missed the coach", "text": "Another week at the inn, then." }
  },
  "rules": [
    {
      "id": "pay-hale",
      "on": "give", "object": "purse", "with": "hale",
      "if": { "act": "arrival" },
      "say": "Mrs Hale counts the coins twice, then hands over your bag.",
      "do": [
        { "move": "purse", "to": "hale" },
        { "move": "bag", "to": "player" },
        { "award": "paid" },
        { "act": "departure" }
      ]
    },
    {
      "id": "board-coach",
      "on": "arrive", "in": "road-north",
      "say": "The coach is waiting, its lamps lit. You climb aboard.",
      "do": [{ "award": "caught-coach" }, { "end": "on-the-road" }]
    }
  ]
}
```

`world/talk.json`:

```json
{
  "dialogues": {
    "hale": {
      "entry": [
        { "if": { "act": "departure" }, "node": "paid" },
        { "node": "start" }
      ],
      "leave": "Mrs Hale goes back to polishing glasses.",
      "nodes": {
        "start": {
          "say": "\"Well?\" says Mrs Hale.",
          "options": [
            { "id": "bill", "text": "\"What do I owe you?\"", "keys": ["bill"], "once": true,
              "reply": "\"Two shillings. Your bag stays with me until it's paid.\"" },
            { "id": "coach", "text": "\"When does the coach leave?\"", "reply": "@hale-coach" },
            { "id": "letter", "text": "\"My sister has written. I must go home.\"",
              "if": { "has": "letter" }, "locked": "(if you had news to tell her)",
              "reply": "Her face softens. \"Then pay up and go, and quick about it.\"", "then": "end" }
          ]
        },
        "paid": {
          "say": "\"Off you go,\" says Mrs Hale.",
          "options": [
            { "id": "thanks", "text": "\"Thank you for everything.\"", "reply": "She flaps a cloth at you.", "then": "end" }
          ]
        }
      }
    }
  }
}
```

`text/passages.txt`:

```text
== intro ==
The coach north leaves at first light, and you mean to be on it.

== yard ==
A cobbled yard, wet with the night's rain. The inn door stands open to the
east. The north road runs off between dark hedges.

== road ==
The road runs north towards the hills.

== letter ==
The letter is in your sister's hand:
| "Come home. Come quickly.
| Father is asking for you."

== hale-coach ==
"Leaves when the horn goes," says Mrs Hale, "and it doesn't wait for anyone."

== departure ==
Grey light is coming up behind the hedges. Somewhere a horse stamps and blows.

== ending-road ==
The coach lurches forward. The inn shrinks behind you, and the hills come up
to meet you.
```

`walkthroughs/win.txt`:

```text
# expect: on-the-road
# score: 15
e
talk to hale
@hale.bill
take letter
read letter
talk to hale
@hale.letter
give purse to hale
w
n
```

`walkthroughs/stranded.txt`:

```text
# expect: stranded
e
give purse to hale
z
z
z
z
```

Playing the winning walkthrough gives:

```
The coach north leaves at first light, and you mean to be on it.
Chapter One: The Inn
Inn Yard
A cobbled yard, wet with the night's rain. The inn door stands open to the east. The north road runs off between dark hedges.
> e
Parlour
A low room with a fire. The yard is back out to the west.
A letter addressed to you lies on the parlour table.
Mrs Hale stands behind the bar.
> talk to hale
"Well?" says Mrs Hale.
  1. "What do I owe you?"
  2. "When does the coach leave?"
     "My sister has written. I must go home." (if you had news to tell her)
  0. Leave
> 1 (@hale.bill)
"What do I owe you?"
"Two shillings. Your bag stays with me until it's paid."
  1. "When does the coach leave?"
     "My sister has written. I must go home." (if you had news to tell her)
  0. Leave
> take letter
Taken.
> read letter
The letter is in your sister's hand:
"Come home. Come quickly.
Father is asking for you."
> talk to hale
Mrs Hale picks up where you left off.
  1. "When does the coach leave?"
  2. "My sister has written. I must go home."
  0. Leave
> 2 (@hale.letter)
"My sister has written. I must go home."
Her face softens. "Then pay up and go, and quick about it."
> give purse to hale
Mrs Hale counts the coins twice, then hands over your bag.
[Your score has gone up by 5.]
Chapter Two: The Road
Grey light is coming up behind the hedges. Somewhere a horse stamps and blows.
> w
Inn Yard
A cobbled yard, wet with the night's rain. The inn door stands open to the east. The north road runs off between dark hedges.
> n
The North Road
The road runs north towards the hills.
The coach is waiting, its lamps lit. You climb aboard.
[Your score has gone up by 10.]
*** You are on the road ***
The coach lurches forward. The inn shrinks behind you, and the hills come up to meet you.
In 10 turns you scored 15 out of a possible 15.
The game is over. Type RESTART, RESTORE, UNDO or QUIT.
```

## Appendix A: standard verbs

Use these ids in a rule's `on`. The patterns show what the player can type:
`a/b` means either word, `OBJ` and `OBJ2` are things, `TEXT` is free text and
`DIR` a direction. The last column says when the standard behaviour counts as
success, which is when after-rules run.

| Verb id | Patterns | Standard behaviour succeeds (after-rules run) |
|---|---|---|
| `score` | `score` | meta: no time passes, rules do not apply |
| `save` | `save`, `save TEXT` | meta: no time passes, rules do not apply |
| `restore` | `restore/load`, `restore/load TEXT` | meta: no time passes, rules do not apply |
| `restart` | `restart` | meta: no time passes, rules do not apply |
| `quit` | `quit/q` | meta: no time passes, rules do not apply |
| `undo` | `undo` | meta: no time passes, rules do not apply |
| `again` | `again/g` | repeats the last command, which then takes its turn and runs its rules as usual |
| `help` | `help/hint/hints` | meta: no time passes, rules do not apply |
| `about` | `about/credits/info/version` | meta: no time passes, rules do not apply |
| `verbose` | `verbose` | meta: no time passes, rules do not apply |
| `brief` | `brief` | meta: no time passes, rules do not apply |
| `look` | `look/l` | yes |
| `inventory` | `inventory/i/inv` | yes |
| `wait` | `wait/z` | yes |
| `examine` | `examine/x/inspect/check/describe OBJ`, `look/l at OBJ` | yes, if lit |
| `examineSelf` | `examine/x/inspect/check/describe me/myself/self`, `look/l at me/myself/self` | yes |
| `read` | `read OBJ` | yes, if lit |
| `search` | `search OBJ`, `look/l in/inside/into OBJ` | if lit, and not a closed container |
| `lookUnder` | `look/l under/behind/beneath OBJ` | yes |
| `go` | `DIR`, `go/walk/run/head/climb DIR` | if the player moves |
| `enter` | `enter`, `enter OBJ`, `go/walk in/into/through OBJ`, `get in/into OBJ`, `climb in/into/through OBJ` | if the player moves |
| `exit` | `exit/leave`, `get out` | if the player moves |
| `take` | `take/get/grab/carry OBJ`, `pick up OBJ`, `pick OBJ up`, `take/get/remove OBJ from/off OBJ2`, `take/get OBJ out of OBJ2` | if taken |
| `drop` | `drop/discard OBJ`, `put/set OBJ down`, `put/set down OBJ` | if dropped |
| `putIn` | `put/place/insert/stick/drop OBJ in/into/inside OBJ2` | if put |
| `putOn` | `put/place/set/drop OBJ on/onto OBJ2` | if put |
| `open` | `open OBJ`, `open OBJ with OBJ2` | if opened |
| `close` | `close/shut OBJ` | if closed |
| `lock` | `lock OBJ`, `lock OBJ with OBJ2` | if locked |
| `unlock` | `unlock OBJ`, `unlock OBJ with OBJ2` | if unlocked |
| `wear` | `wear/don OBJ`, `put on OBJ`, `put OBJ on` | if worn |
| `takeOff` | `take off OBJ`, `take OBJ off`, `doff/remove OBJ` | if taken off |
| `switchOn` | `turn/switch on OBJ`, `turn/switch OBJ on`, `light/activate OBJ` | if switched |
| `switchOff` | `turn/switch off OBJ`, `turn/switch OBJ off`, `extinguish/douse/deactivate OBJ` | if switched |
| `eat` | `eat OBJ` | if eaten |
| `drink` | `drink/sip OBJ` | if drunk |
| `push` | `push/press/shove/move OBJ` | never |
| `pull` | `pull/drag/tug OBJ` | never |
| `turn` | `turn/rotate/twist/spin OBJ` | never |
| `touch` | `touch/feel/rub/pat OBJ` | yes |
| `smell` | `smell/sniff`, `smell/sniff OBJ` | yes |
| `listen` | `listen`, `listen to OBJ` | yes |
| `taste` | `taste/lick OBJ` | yes |
| `attack` | `attack/hit/kill/fight/strike/punch/kick OBJ`, `attack/hit/kill/fight/strike OBJ with OBJ2` | never |
| `throw` | `throw/toss/hurl OBJ`, `throw/toss/hurl OBJ at/to OBJ2` | never |
| `climb` | `climb`, `climb/scale OBJ`, `climb up/down/over OBJ` | never |
| `jump` | `jump/leap/hop` | yes |
| `sleep` | `sleep/nap/rest` | yes |
| `yell` | `yell/shout/scream/holler` | yes |
| `use` | `use OBJ`, `use OBJ on/with OBJ2` | never |
| `give` | `give/offer/hand OBJ to OBJ2`, `give/offer/hand OBJ2 OBJ` | never |
| `show` | `show/display OBJ to OBJ2`, `show OBJ2 OBJ` | never |
| `ask` | `ask/question OBJ about TEXT` | if a topic matched |
| `tell` | `tell/inform OBJ about TEXT` | if a topic matched |
| `talk` | `talk/speak to/with OBJ`, `greet OBJ` | if it is a character |
| `say` | `say/utter TEXT`, `say/utter TEXT to OBJ` | never |
| `answer` | `answer/reply/respond TEXT`, `answer/reply/respond OBJ with TEXT`, `answer/reply/respond TEXT to OBJ`, `answer/reply/respond to OBJ with TEXT`, `yes/yeah/yep/aye`, `no/nope` | if a topic matched |

## Appendix B: standard messages

Override any of these in a `messages` section. Templates are explained in
[section 5](#5-text); `{list}`, `{word}`, `{verb}`, `{n}`, `{title}`,
`{reason}` and `{directions}` (every direction the pack knows, for `help`)
are filled in by the engine for the messages that use them.

| Key | Default text |
|---|---|
| `emptyCommand` | I beg your pardon? |
| `unknownWord` | I don't know the word "{word}". |
| `notUnderstood` | I didn't understand that sentence. |
| `cantSeeThat` | You can't see any such thing. |
| `noPronoun` | I'm not sure what "{word}" refers to. |
| `pronounGone` | You can't see {the:noun} any more. |
| `which` | Which do you mean, {list}? |
| `whatToVerb` | What do you want to {verb}? |
| `whatToVerbWith` | What do you want to {verb} {the:noun} with? |
| `noMultiples` | You can't use more than one object with that verb. |
| `nothingForAll` | There is nothing to {verb}. |
| `notCarryingAnything` | You are not carrying anything. |
| `gameOver` | The game is over. Type RESTART, RESTORE, UNDO or QUIT. |
| `scoreReport` | You have scored {score} out of a possible {max}, in {turnCount}. |
| `noScore` | This story is not scored. You have taken {turnCount}. |
| `scoreUp` | [Your score has gone up by {n}.] |
| `scoreDown` | [Your score has gone down by {n}.] |
| `saved` | Saved. |
| `saveFailed` | Save failed. |
| `restored` | Restored. |
| `restoreFailed` | Restore failed: {reason}. |
| `undone` | Previous turn undone. |
| `cantUndo` | There is nothing to undo. |
| `noAgain` | There is no command to repeat. |
| `restarting` | Starting again. |
| `goodbye` | Goodbye. |
| `verboseOn` | Full room descriptions from now on. |
| `briefOn` | Full descriptions only for rooms you have not seen before. |
| `help` | Type short commands: LOOK, INVENTORY, TAKE something, PUT something IN something, OPEN something, TALK TO someone, ASK someone ABOUT something.<br><br>To move, type a direction: {directions}.<br><br>Other commands: SCORE, SAVE, RESTORE, UNDO, AGAIN, RESTART, QUIT, ABOUT. |
| `endingTitle` | *** {title} *** |
| `finalScore` | In {turnCount} you scored {score} out of a possible {max}. |
| `darkTitle` | Darkness |
| `dark` | It is pitch dark. You cannot see a thing. |
| `nowDark` | It is now pitch dark. |
| `tooDark` | It is too dark to see. |
| `youSee` | You can see {list} here. |
| `onSurface` | On {the:noun} you can see {list}. |
| `inContainer` | In {the:noun} you can see {list}. |
| `characterHere` | {The:noun} {is:noun} here. |
| `nothingSpecial` | You see nothing special about {the:noun}. |
| `examineSelf` | You look as you always do. |
| `isOpen` | {It:noun} {is:noun} open. |
| `isClosed` | {It:noun} {is:noun} closed. |
| `isOn` | {It:noun} {is:noun} switched on. |
| `isOff` | {It:noun} {is:noun} switched off. |
| `isEmpty` | {The:noun} {is:noun} empty. |
| `nothingOn` | There is nothing on {the:noun}. |
| `nothingFound` | You find nothing of interest. |
| `carrying` | You are carrying: |
| `emptyHanded` | You are empty-handed. |
| `beingWorn` | (being worn) |
| `providingLight` | (providing light) |
| `waited` | Time passes. |
| `cantGo` | You can't go that way. |
| `doorClosed` | {The:noun} {is:noun} closed. |
| `doorLocked` | {The:noun} {is:noun} locked. |
| `cantEnter` | That's not something you can enter. |
| `characterArrives` | {The:noun} arrives. |
| `characterDeparts` | {The:noun} leaves. |
| `taken` | Taken. |
| `dropped` | Dropped. |
| `alreadyHave` | You already have {that:noun}. |
| `notHeld` | You aren't carrying {that:noun}. |
| `fixed` | {That:noun} {is:noun} fixed in place. |
| `scenery` | That's hardly portable. |
| `takeCharacter` | {The:noun} would not appreciate that. |
| `belongsTo` | {That:noun} seem{s:noun} to belong to {the:second}. |
| `notInside` | {The:noun} {is:noun} not there. |
| `carryingTooMuch` | You're carrying too many things already. |
| `takeSelf` | You are always self-possessed. |
| `firstTaking` | (first taking {the:noun}) |
| `wornFirst` | You'll have to take {it:noun} off first. |
| `containerClosed` | {The:noun} {is:noun} closed. |
| `putIn` | You put {the:noun} in {the:second}. |
| `putOn` | You put {the:noun} on {the:second}. |
| `cantPutIn` | You can't put things in {the:second}. |
| `cantPutOn` | You can't put things on {the:second}. |
| `putInSelf` | You can't put something inside itself. |
| `noRoom` | There is no more room in {the:second}. |
| `notOpenable` | You can't open {that:noun}. |
| `notCloseable` | You can't close {that:noun}. |
| `alreadyOpen` | {It:noun} {is:noun} already open. |
| `alreadyClosed` | {It:noun} {is:noun} already closed. |
| `opened` | You open {the:noun}. |
| `openReveals` | Opening {the:noun} reveals {list}. |
| `closed` | You close {the:noun}. |
| `locked` | {It:noun} seems to be locked. |
| `notLockable` | {That:noun} do{es:noun}n't have a lock. |
| `alreadyLocked` | {It:noun} {is:noun} already locked. |
| `alreadyUnlocked` | {It:noun} {is:noun} not locked. |
| `closeFirst` | You'll have to close {it:noun} first. |
| `wrongKey` | {The:second} won't fit {the:noun}. |
| `noKeyhole` | There is no keyhole in {the:noun}. |
| `withKey` | (with {the:second}) |
| `lockedIt` | You lock {the:noun}. |
| `unlockedIt` | You unlock {the:noun}. |
| `notWearable` | You can't wear {that:noun}. |
| `alreadyWearing` | You're already wearing {it:noun}. |
| `notWearing` | You aren't wearing {that:noun}. |
| `wearing` | You put on {the:noun}. |
| `takenOff` | You take off {the:noun}. |
| `notSwitchable` | You can't switch {that:noun} on or off. |
| `alreadyOn` | {It:noun} {is:noun} already on. |
| `alreadyOff` | {It:noun} {is:noun} already off. |
| `switchedOn` | You switch on {the:noun}. |
| `switchedOff` | You switch off {the:noun}. |
| `eaten` | You eat {the:noun}. |
| `drunk` | You drink {the:noun}. |
| `notEdible` | You can't eat {that:noun}. |
| `notDrinkable` | You can't drink {that:noun}. |
| `nothingHappens` | Nothing obvious happens. |
| `touched` | You feel nothing unexpected. |
| `smelled` | You smell nothing unexpected. |
| `heard` | You hear nothing unexpected. |
| `tasted` | You taste nothing unexpected. |
| `attackPointless` | Fighting won't help here. |
| `throwPointless` | Throwing {the:noun} would achieve nothing. |
| `cantClimb` | You can't climb {that:noun}. |
| `nothingToClimb` | There is nothing obvious to climb. |
| `jumped` | You jump on the spot. Nothing changes. |
| `slept` | This is no time for sleeping. |
| `yelled` | You shout. Nobody answers. |
| `useVague` | Try a more specific verb with {the:noun}. |
| `giveNotCharacter` | You can't give things to {the:second}. |
| `notInterested` | {The:second} do{es:second}n't seem interested. |
| `shown` | {The:second} glance{s:second} at {the:noun} without interest. |
| `notCharacter` | You can't talk to {that:noun}. |
| `noTopic` | {The:noun} {has:noun} nothing to say about that. |
| `talkDefault` | {The:noun} wait{s:noun} for you to ask about something. |
| `saidNothing` | Nothing happens. |
| `saidToNobody` | {The:noun} do{es:noun}n't respond. |
| `noDialogue` | {The:noun} {has:noun} nothing to say to you. |
| `noAnswer` | {The:noun} {has:noun} no reply to that. |
| `answerWho` | Say who you are answering: ANSWER someone WITH something. |
| `nobodyToAnswer` | There is nobody here to answer. |
| `leaveConversation` | Leave |
| `notAnOption` | There is no option {n}. |
| `chooseOption` | Choose one of the numbered options. |
| `resumeConversation` | {The:noun} pick{s:noun} up where you left off. |
