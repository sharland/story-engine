# Spec: conversation menus

Status: accepted, being built. All five decisions below were accepted as
recommended, with resuming added to decision 4.

## Why

Typed conversation (`ask ada about juniper`) is a guessing game. The player
has to find the words the author thought of. That works for knowledge puzzles
but not for dialogue that carries a story. Modern story RPGs solve this with
a short menu of things the player can say, filtered by what has happened so
far. Choices change relationships, and characters remember what was said.

This spec adds that to the engine without giving up typed commands. The
player explores, takes and opens things by typing, as now. When they talk to
someone who has a dialogue, they choose from numbered lines.

The test case is Ada in the western. On first meeting she asks "You seen my
Juniper?", and the player has no good way to reply today.

## Goals

1. Restricted dialogue choices: numbered options, typed as a number on the
   command line or clicked on the web page.
2. Options appear and disappear with the state of the story, using the
   conditions packs already use.
3. Choices have consequences: they can change variables and properties, such as
   a character's trust, and run any effect.
4. Characters remember what was said: the game records every option chosen,
   and conditions can test it.
5. Characters can start a conversation themselves, such as a question on
   arrival.
6. Everything stays deterministic, serialisable, undoable and testable. A
   save made in the middle of a conversation restores into it.
7. Ask, tell and talk keep working. A pack chooses per character which style
   to use, or uses both.

Not in scope now: voiced lines or portraits, timed choices, conversations with
several characters at once, a separate "skills" system (checks use variables
and the seeded random generator, as now).

## How it plays

```
Livery Stable
The stable smells of hay and harness oil. ...
Ada Pruitt, who owns the livery, is pacing beside the empty stall.
"You seen my Juniper?" Ada asks.
  1. "Not yet. Which way did she go?"
  2. "Seen her? I'd know her if I did. What's she like?"
  3. "I'm not here about a horse."
  0. Leave

> 1
"Not yet," you say. "Which way did she go?"
"South, down into the wash. She'll come to sugar, if you can get close."
  1. "Where would I find sugar?"
  2. "I'll bring her back."
  0. Leave

> 2
"I'll bring her back."
Ada looks at you for a long moment. "See that you do."
[Ada's trust in you has grown.]
```

- The menu is a numbered list under the character's line.
- The player types a number (or clicks one on the web page).
- `0` (or `leave`, `bye`, `goodbye`) ends the conversation.
- Typing an option's keywords also chooses it, so `no` picks the option keyed
  "no". That covers players who would type an answer anyway.
- Typing anything else ends the conversation quietly and runs as a normal
  command. `north` walks away; `look` looks.
- Walking away, or the character leaving, ends the conversation.

## Data

A new top-level section, `dialogues`, keyed by character id. It can live in
any data file, so a long dialogue can have a file of its own.

```json
"dialogues": {
  "ada": {
    "entry": [
      { "if": { "not": { "var": "ada.asked" } }, "node": "juniper" },
      { "node": "hub" }
    ],
    "leave": "Ada turns back to the empty stall.",
    "nodes": {
      "juniper": {
        "say": "\"You seen my Juniper?\" Ada asks.",
        "do": [{ "set": "ada.asked", "to": true }],
        "options": [
          { "id": "not-yet", "text": "\"Not yet. Which way did she go?\"",
            "line": "\"Not yet,\" you say. \"Which way did she go?\"",
            "reply": "@ada-which-way", "then": "plan" },
          { "id": "what-like", "text": "\"Seen her? I'd know her if I did. What's she like?\"",
            "reply": "@ada-describes-juniper", "then": "plan" },
          { "id": "not-here", "text": "\"I'm not here about a horse.\"",
            "reply": "Ada's face closes like a door. \"Then you're no use to me.\"",
            "do": [{ "dec": "ada.trust" }], "then": "end" }
        ]
      },
      "plan": {
        "options": [
          { "id": "sugar", "text": "\"Where would I find sugar?\"", "reply": "@ada-sugar",
            "once": true },
          { "id": "promise", "text": "\"I'll bring her back.\"",
            "reply": "Ada looks at you for a long moment. \"See that you do.\"",
            "do": [{ "inc": "ada.trust" }, { "say": "[Ada's trust in you has grown.]" }],
            "then": "end" }
        ]
      },
      "hub": {
        "say": "Ada wipes her hands on her apron. \"Well?\"",
        "options": [
          { "id": "news", "text": "\"I've found her.\"", "if": { "var": "mare.caught" },
            "reply": "\"Then bring her in!\"" },
          { "id": "hint", "text": "\"Any idea how to get close to her?\"",
            "reply": "@ada-sugar", "keys": ["hint", "help"] },
          { "id": "trust-me", "text": "\"Lend me your good saddle.\"",
            "if": { "var": "ada.trust", "gte": 2 },
            "locked": "[Ada doesn't trust you enough yet.]",
            "reply": "\"Mind you bring it back.\"",
            "do": [{ "move": "saddle", "to": "player" }] }
        ]
      }
    }
  }
}
```

Ada would declare `"props": { "trust": 0, "asked": false }`, and the pack would
add the `saddle` object and the `@ada-...` passages.

### Dialogue

| Field | Meaning |
|---|---|
| `entry` | Which node `talk to` opens: a list of `{"if": condition, "node": id}`, first match wins. Without `entry`, the node called `start`. |
| `leave` | *Text* shown when the player ends the conversation. Optional. |
| `resume` | `false` to always start from `entry` after an interrupted conversation. Default `true`: pick up where it was left. |
| `resumeText` | *Text* shown when a conversation resumes. Default: the standard message "{The:noun} picks up where you left off." |
| `nodes` | Object of node id → node. |

### Node

| Field | Meaning |
|---|---|
| `say` | *Text* the character says when the node opens. Optional (a node reached by an option often needs none, because the option's `reply` already spoke). |
| `options` | List of options, shown in this order. |
| `do` | Effects run when the node opens. |
| `noLeave` | `true` to remove the Leave choice: the player must pick an option. For confrontations. |

### Option

| Field | Meaning |
|---|---|
| `id` | Required. Unique within the dialogue. Recorded when chosen as `character.id` (`ada.not-yet`). |
| `text` | Required. *Text* of the menu line: what the player says. |
| `if` | Condition for the option to appear. |
| `locked` | With `if`: show the option even when `if` is false, unnumbered, with this text (`[Ada doesn't trust you enough yet.]`), so the player sees what they could unlock. Without `locked`, a failing option is hidden. |
| `once` | Remove the option after it has been chosen once. |
| `keys` | Words the player can type to choose it, in addition to its number: `["yes"]`, `["no", "nope"]`. |
| `line` | *Text* printed as the player's line when chosen, if it should differ from the menu label (for example with narration: `"Not yet," you say. "Which way did she go?"`). Default: `text`, printed as it is. |
| `reply` | *Text* of the character's answer. |
| `do` | Effects, run after the reply. Any effect works: change trust, award points, move things, start an act, end the game. |
| `then` | Where to go next: a node id, `"end"` to close the conversation, or leave it out to stay in the same node (its options are shown again, minus any used `once` options). |

Option ids are what make memory work, so they are required. Numbers are only
the order on screen at that moment.

### Starting a conversation from a rule

A new effect opens a dialogue at a node, from any rule or event:

```json
{ "on": "arrive", "in": "livery", "once": true,
  "if": { "here": "ada" },
  "do": [{ "converse": "ada", "node": "juniper" }] }
```

That is how Ada asks her question the moment the player walks in. The
conversation begins after the room description and arrival rules.

### Memory and relationships

- **What was said:** every chosen option is recorded. The new condition
  `{"said": "ada.not-here"}` is true once that option has been chosen.
- **Relationships:** use character properties, declared like any other:
  `"props": { "trust": 0 }` on Ada, then `inc`, `dec` and
  `{"var": "ada.trust", "gte": 2}`. There is nothing new to learn, and they
  show up in conditions, descriptions and topics alike.
- **Callbacks:** any text field can vary on `said`, so a character's
  description, a later topic or a much later reply can refer back:
  `{"if": {"said": "ada.not-here"}, "text": "Ada won't look at you."}`.

## Engine changes

- **Pack format:**
  - the `dialogues` section, with the schema checks and references above;
  - the `said` condition;
  - the `converse` effect.
- **Game state:**
  - `conversation: {with, node} | null` for the open menu;
  - `said: string[]` for what has been said;
  - `paused: {character: node}` for interrupted conversations;
  - `lastSpeaker` for bare `yes` and `no`.
  - Both are plain JSON, so save, restore and undo cover them with no special
    code.
- **Turn loop:**
  - while a conversation is open, input is first tried as a choice (number,
    keys, or a leave word);
  - a choice runs as one turn: undo snapshot, `turns + 1`, the player's line,
    the reply, the effects, then the end of turn as usual (events, background
    rules, wandering, light);
  - a timed event can therefore interrupt a conversation, which is useful for
    drama;
  - any other input closes the conversation without spending a turn, then
    runs normally.
- **`talk to X`:** opens X's dialogue if X has one. Otherwise it behaves as
  now (the `talk` text).
- **Typed answers without a menu:** `answer X with Y`, `answer Y to X`,
  `reply Y`, and a bare `yes` or `no` are added as patterns of a new standard
  verb `answer`. When a menu is open they are tried as `keys`. Otherwise they
  go to rules (`"on": "answer"`) and to the character's topics, so packs that
  only use ask/tell still get sensible typed answers. A bare answer goes to the
  last character who spoke, if still present.
- **Output:**
  - blocks get a new style, `option`, carrying the number (or none, for a
    locked line) and the text;
  - the command line prints `  1. text`;
  - the web page renders buttons that send the number, and typing still works;
  - transcripts show the printed form, so menus are covered by transcript
    tests like everything else.
- **Messages:** new standard messages `leaveConversation` (the `0. Leave`
  label), `notAnOption` ("There's no option 4."), `noDialogue` (when `talk to`
  finds nothing to say). Packs can override all of them.

## Validator

- **References:**
  - every `then` and `entry` node exists;
  - every `converse` effect names a character with a dialogue and a node in it;
  - every `said` refers to a real option (`ada.not-here`);
  - option ids are unique within a dialogue.
- **Reachability:** every node can be reached from an `entry` node or a
  `converse` effect, and an unreachable node is an error.
- **Dead ends:** a node with no options that can ever be shown, and no
  Leave, is an error, because it would trap the player.
- **Warnings:** an option whose `if` can never be true (it tests a variable no
  effect ever changes from a value that fails); and a dialogue on someone who
  isn't a character.

## Testing

- **Walkthroughs:** typed numbers would break whenever a new option appears
  above the one wanted. So walkthrough files get one new form, `@ada.promise`,
  which chooses that option by id and fails the walkthrough if it isn't on
  screen. Players never see this syntax.
- **Transcripts:** testbed scenes cover numbered choice, keys, leaving,
  locked options, `once`, `then` to another node and to `end`, `noLeave`, a
  conversation opened by a rule, a timed event during a conversation, typing
  a command mid-conversation, walking away, the character leaving, undo, and
  save and restore mid-conversation.
- **Western:** Ada gets the dialogue from the example, with a walkthrough
  through it and one that ignores it (the old route must still win).
- **Web:** a browser test that clicks options and gets the same transcript
  as typing the numbers.

## Decisions

1. **Does each choice take a game turn?** Recommendation: yes. Time passing
   in conversation lets events interrupt (the coach leaves while you argue),
   and it keeps undo simple: one choice, one turn. The alternative, talking as
   a pause in time, is less code but makes conversations a safe space,
   which flattens tension.
2. **Is Leave always offered?** Recommendation: yes, except on nodes with
   `noLeave`. A player trapped in a menu with no way out stops trusting
   the game.
3. **What happens to locked options by default?** Recommendation: hidden,
   unless the author adds `locked` text. Showing every locked line clutters
   the screen. Showing the important ones tells the player a door exists,
   which is half of what makes RPG dialogue feel like a choice.
4. **Does typing a normal command during a menu close it?** Recommendation:
   yes, quietly. The alternative, locking the player in the menu until they
   pick or leave, is what console RPGs do. But this is a typed game, and
   typing `north` and having it refused would feel broken.
   **Resuming (added):** the character remembers an interrupted
   conversation. The engine records the node the player was at. The next
   `talk to` picks up there with the `resumeText` line, without repeating
   the node's opening line or effects. Leaving properly (`0`, `bye`) clears
   it, so the next `talk` starts from `entry`. Meta commands (`save`,
   `score`, `undo`) and typing mistakes do not close the menu.
5. **Do topics and menus mix on one character?** Recommendation: yes. `talk
   to` opens the menu and `ask about` still uses topics. A novel's minor
   characters can stay ask/tell (cheap to write), while the major ones get
   menus.

## Build plan

The order of work, each step tested before the next:

1. **Format:** types, schema, references, the `said` condition, the `converse`
   effect.
2. **Engine:** conversation state, choosing, leaving, closing on other input,
   turn accounting, the `option` output style.
3. **Answering:** the `answer` verb and typed keys.
4. **Validator checks.**
5. **Walkthroughs:** the `@id` syntax.
6. **Testbed:** scenes and transcripts.
7. **Western:** Ada's dialogue, with walkthroughs.
8. **Web page:** option buttons, with a browser test.
9. **Docs:** a WRITING-A-PACK.md section, with the guide's example extended,
   and a DESIGN.md update.

This is a moderate change: one new section, one condition, one effect, one
standard verb, and a new branch in the turn loop. It touches no existing pack
behaviour, since packs without `dialogues` play exactly as now, and the
existing transcripts must keep passing unchanged to prove it.
