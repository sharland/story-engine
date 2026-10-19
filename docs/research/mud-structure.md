# How the first MUDs were built: a clean-room study of their structure

**Question.** What shape were the classic DikuMUD worlds, measured rather
than remembered? In particular, where do the "corridors" (rooms you walk
through with nothing in them) and the "theme parks" (attractions bolted to a
hub) come from, how did these worlds gate progress, and what should a pack
adapted from a novel do differently?

**Answer in brief.**

- **The theme park is real, and it is the map of zones, not the rooms.** In
  both worlds studied, the zones form an almost perfect tree hanging off one
  hub zone, the city. More than half the zones join only one other zone: you
  go in, and you come back out the way you came.
- **Corridors are rarer than their reputation, and the real filler is copied
  text.** Only 10 to 17% of rooms are empty pass-through rooms, and the
  longest such run is five rooms. But 13% of rooms share their description
  word for word with another room, and that copying is concentrated in a few
  zones (forests, mazes, deserts) where nearly every room is the same.
- **Progress was gated by danger, not keys.** Locked doors are about 1.5 in
  every 100 exits. In the 1991 world 41% of placed creatures attack on sight,
  and creature level rises gently with distance from the city.
- **Detail was thinner than we now expect.** In 1991, more than half the rooms
  had nothing the player could examine beyond the room itself.

The numbers, the method and what they mean for adapting a novel follow. The
full tables are in [`research/mud-structure/tables.md`](../../research/mud-structure/tables.md)
and the raw figures in [`results.json`](../../research/mud-structure/results.json).

## Sources and licences

| Corpus | What it is | Licence | Used |
|---|---|---|---|
| DikuMUD Alfa | The original 1991 release by its five authors | LGPL 2.1, by the authors' re-release of February 2020 ([licence note in the repository](https://github.com/Seifert69/DikuMUD)) | Yes |
| DikuMUD Gamma | The earlier 1991 release; its world is an earlier cut of Alfa's | LGPL 2.1 ([repository](https://github.com/Seifert69/DikuMUD-Gamma)) | Parsed (505 rooms), not reported separately |
| DikuMUD III | The same team's later engine and world, released in 2020 | LGPL 2.1 ([repository](https://github.com/Seifert69/DikuMUD3)) | Yes |
| CircleMUD and tbaMUD, Merc, SillyMUD | Derivatives of DikuMUD | Their own licences, which forbid using them "to make money or be compensated in any way" ([tbaMUD's licence](https://github.com/tbamud/tbamud)) | No |

The Alfa repository's licence note is explicit that the 2020 re-release does
not cover derivatives: "derivative work isn't automatically under LGPL. It
would need to be re-released by its respective authors." Aggregate numbers
are facts, not copied expression, but CircleMUD's licence claims any use "in
any way". Because a pack made from your novels may be sold, I left the
derivatives out. See [the decision at the end](#a-decision-for-you).

Both worlds come from the same authors, so this is one design tradition at two
points in time (1991, and its descendant maintained up to 2020), not a survey
of MUDs in general.

## Method, and the clean-room rules

- **Fetched outside this repository.** The corpora were cloned read-only to a
  separate folder. Only their world data files were read; none of their code
  was built or run.
- **Formats learned from documentation.** The Diku formats were learned from
  the release's own `doc/database.doc` and the flag constants in its headers.
  The DikuMUD III format was learned from views of zone files with names
  masked, plus tests on synthetic files.
- **Text discarded at parse time.** The readers in
  [`research/mud-structure/`](../../research/mud-structure/) keep identifiers and numbers only. Titles,
  descriptions and keywords are thrown away as they are read. A description
  survives only as a word count and a fingerprint, used to spot rooms with
  identical text.
- **A guard on the output.** Before anything is written, every word in the
  output must come from the tools' own source code, a label given on the
  command line, or an anonymous zone label (A01, B07). Anything else stops the
  run. Zones are numbered by size, so no name or map survives.
- **This document was checked** with the tool's `--check` mode for any of the
  corpora's identifiers.
- **One slip, owned.** While learning the DikuMUD III format, a first masking
  attempt missed multi-line strings, and a few room descriptions from one zone
  appeared in my working view. Nothing from them is used here, and the readers
  never keep text.

**What was measured.** The definitions are in
[`metrics.ts`](../../research/mud-structure/metrics.ts):

- **Neighbours:** rooms joined either way by an exit.
- **Dead end:** a room with one neighbour.
- **Corridor:** two neighbours and nothing in the room: no creature, object,
  extra description or script.
- **Junction:** three or more neighbours. A **hub** has five or more.
- **Content room:** has something placed in it at reset, an extra description
  or a script.
- **Loops:** independent cycles in a zone's room graph, that is, the number of
  ways round rather than just there and back.
- **Gate:** a locked door. In our packs, a conditional exit counts too.
- **Hub zone:** the zone joined to the most other zones.

Zones are measured if they have at least 5 rooms and most of their rooms have
exits. That keeps 21 of Alfa's 23 zones (648 rooms) and 30 of DikuMUD III's
62. Its other zones are script libraries, holiday events, guild offices or a
few rooms each.

**How well it parsed:**

- **Alfa:** all 657 rooms. The data's own slips, an extra description without
  its marker and a stray line, are handled and counted.
- **DikuMUD III:** 1,152 rooms, with 39 of 2,486 exits unresolved and 158
  resets not placed. Creature levels and whether creatures move are set
  through macros and scripts the reader doesn't expand, so those figures are
  missing for it. Its aggression figure is a lower bound.

## What the numbers say

| Measure | Alfa (1991) | DikuMUD III |
|---|---|---|
| Rooms measured, zones | 648 in 21 | 1,108 in 30 |
| Rooms per zone, median (quartiles) | 33 (15–45) | 14.5 (8–63) |
| Exits per room | 2.3 | 2.2 |
| Dead ends | 14% | 26% |
| Corridors (empty pass-through) | 17% | 10% |
| Loops per 10 rooms, median zone | 1.3 | 0.1 |
| Rooms with content | 67% | 79% |
| Rooms sharing their description with another | 13% | 13% |
| Rooms with extra descriptions | 45% | 63% |
| Words in a room description, median zone | 33 | 52.5 |
| Locked doors per 100 exits | 1.5 | 1.5 |
| Zones: joined / links between them / loops | 23 / 23 / 1 | 25 / 25 / 1 |
| Zones joined to only one other zone | 13 | 17 |
| Aggressive creatures | 41% | at least 3% |

### 1. The theme park is the map of zones

In both worlds the graph of zones is almost a tree:

- **Alfa:** 23 linked zones, 23 links, 1 loop.
- **DikuMUD III:** 25 linked zones, 25 links, 1 loop.
- **The hub:** one zone, the city, joins 8 and 10 zones directly.
- **Leaves:** 13 of Alfa's zones and 17 of DikuMUD III's join only one other
  zone.
- **Reach:** no zone is more than 4 hops from the hub.
- **One way in:** 16 of DikuMUD III's 30 measured zones have a single entrance
  room.

That is the theme park: a central plaza with themed attractions each on its
own spur, entered and left by the same path. Each zone stands on its own; few
lead anywhere but back.

**For a novel.** A novel's places are joined by its story and its travel, not
by a plaza.

- Give regions more than one way in.
- Join regions to each other, not only to a hub, so the map has at least one
  loop.
- Bring the player back to the same places in later acts, changed: acts can
  move characters and open exits. Don't keep adding new spurs.

### 2. The corridors are copied rooms, not empty ones

By the strict measure, an empty room with two exits, corridors are a minority:

- 17% of rooms in Alfa and 10% in DikuMUD III.
- The longest run is 5 rooms in Alfa and 4 in DikuMUD III.
- Content is dense: in the median zone, the average room is less than half a
  step from something placed or described.

The filler shows up instead as copied text. 13% of rooms in both worlds share
their description with another room, and the copying clusters in a few zones:

- One Alfa zone: 30 of its 34 rooms.
- One DikuMUD III zone: all 42 rooms.
- Another DikuMUD III zone: 40 of 63.

These are the mazes, forests and deserts, where walking is the content.
Players remember them as corridors whatever is placed in them.

**For a novel.** Never repeat a description. If the book has a long journey,
make it one room, or a short chain with a timed event, rather than many
interchangeable rooms. This is a cheap check for the validator to make (see
[proposals](#what-to-carry-into-the-engine)).

### 3. Inside zones: the 1991 world looped, its successor branched

The median Alfa zone has 1.3 loops per 10 rooms. The median DikuMUD III zone
has 0.1, and 14 of its 30 zones are trees. Dead ends double, from 14% to 26%
of rooms, but they are not wasted: 86% of dead ends in Alfa and 90% in
DikuMUD III hold something. In the later world, the end of a branch is where
the reward is.

**For a novel.**

- A tree makes every visit "there and back", which is backtracking. A loop
  lets players choose a route.
- Put at least one loop in any region of eight rooms or more.
- Make every dead end a payoff: a person, a find, a view, a clue.

### 4. Progress was gated by danger, not by keys

Locked doors are rare in both worlds: 1.5 in every 100 exits, and never more
than 2 between a zone's entrance and any room in it. Their keys tell two
different stories:

- **Alfa:** 6 of the 12 keys are loaded into storage rooms that no exit
  reaches, so walking can't get them. Of the 6 that can be reached, the median
  key is in the doorway itself (0 steps), usually carried by whoever guards it.
  The puzzle is "get past the guard".
- **DikuMUD III:** 11 of 12 keys can be reached without passing their door,
  at a median of 1.5 steps and up to 8. Eleven of the 12 are carried by
  creatures. Doors became small find-the-key quests.

The real gate in 1991 was danger:

- 41% of placed creatures attack on sight.
- 45% of rooms are dark.
- There are 6 death traps.
- Creature level rises gently with distance from the city: a median of about
  4 one hop out (6 zones), 5 at two hops (9 zones) and 6 at three (3 zones).
  The city itself scores higher because of its guards. The sample is small,
  but the direction is what you'd expect of a world gated by risk.

That is a soft gate: nothing stops you walking into a hard zone, but you may
not walk out.

**For a novel.**

- A story without combat needs other soft gates: people who don't yet trust
  you, things you don't yet know, places that change with the acts.
- Each gate needs a second, costlier way through, as with the patience route
  to the mare.
- Locks with keys should be rare, as they were here.

### 5. Detail: the 1991 rooms were bare

Less than half of Alfa's rooms (45%) had any extra description, at 0.8 per
room. DikuMUD III raised that to 63% and 1.7 per room, with longer
descriptions (median 52.5 words against 33).

**For a novel.** Every noun a room's description makes the player curious
about should be examinable. The Halcyon ladder, found in play-testing, was
this problem: the text named a ladder that the pack never defined.

### 6. Sizes

- **Zones:** a median of 33 rooms in 1991 (quartiles 15–45) and 14.5 later
  (8–63).
- **Diameter:** the longest shortest walk across a zone has a median of 10
  and 7 steps.
- **Exits per room:** 2.2 to 2.3 in every world, including both of our demos.

**For a novel.** These are measured from two worlds, not rules. They suggest
regions of roughly 8 to 20 rooms, each crossable in about 6 steps, one region
per major setting or act.

### Our demos on the same yardstick

Sorrow Creek (4 rooms) and the Halcyon Relay (11) are too small to compare
structurally. On detail they are already richer: no corridors, no copied
text, 75 to 100% of rooms with something to examine and 1.5 to 2.4 details
per room. But the Halcyon Relay's main region is spoke-shaped, a hub with
dead ends around it. That is the theme-park pattern in miniature: fine for an
11-room demo, and a warning for a novel-sized pack.

## What to carry into the engine

These are proposals; none of them is built.

1. **Shape advisories in `validate`**, as notes rather than warnings, since
   they are matters of judgement:
   - rooms with identical descriptions;
   - runs of three or more empty pass-through rooms;
   - regions with a single entrance;
   - regions of eight rooms or more with no loop;
   - dead ends with nothing in them;
   - nouns named in a room's description that no object answers to. This one
     is a heuristic, and the most useful, given the ladder.
2. **A `shape` command** that prints this study's table for any pack, so a
   writer can compare a draft with these figures.
3. **A section in the pack guide** turning sections 1 to 6 into a checklist
   for mapping a novel: places as regions, journeys as single rooms with
   time, people and knowledge as gates, each with a costlier second way.

## Limits

- **Two worlds, one tradition.** Both come from the same authors. A survey of
  Circle, Merc and Silly worlds would test whether the patterns hold more
  widely.
- **The shape names and thresholds are mine.** The raw counts are in the
  tables for anyone to recut.
- **DikuMUD III's reader has blind spots:** exits written through macros, and
  creature levels.
- **"Content" counts things placed, not whether they matter.** No number here
  measures whether a place is any fun.

## A decision for you

**Should the study include the non-commercial derivatives?** That means
CircleMUD/tbaMUD, Merc and SillyMUD.

- **The upside:** they would broaden the sample beyond one design tradition.
- **The cost:** their licences forbid using them to make money "in any way",
  and your packs may be commercial.
- **My recommendation:** leave them out. The two LGPL worlds already answer
  the questions you asked, and the derivatives descend from the same 1991
  world, so they would add less independent evidence than their size
  suggests. If you want them anyway, I'll add them as a separate,
  clearly-labelled cross-check once you've decided you're comfortable with
  their terms.

## Re-running it

```sh
# Corpora cloned anywhere outside this repository, for example:
#   https://github.com/Seifert69/DikuMUD   (lib files in dm-dist-alfa/lib)
#   https://github.com/Seifert69/DikuMUD3  (zone files in vme/zone)
node research/mud-structure/report.ts \
  --diku "DikuMUD Alfa 1991=<path>/dm-dist-alfa/lib" \
  --vme "DikuMUD III=<path>/vme/zone" \
  --pack "Sorrow Creek=packs/sorrow-creek" --pack "Halcyon Relay=packs/halcyon-relay" \
  --json research/mud-structure/results.json --md research/mud-structure/tables.md

# Check a hand-written document for the corpora's identifiers:
node research/mud-structure/report.ts --diku ... --vme ... --check docs/research/mud-structure.md
```
