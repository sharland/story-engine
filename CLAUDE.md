# Working on story-engine

A story-agnostic text adventure engine (TypeScript, Node 22.18+ and the
browser, no server, no framework) with two demo packs. Read `README.md`,
`docs/DESIGN.md` and `docs/WRITING-A-PACK.md` before changing anything.

## Hard rules

- Write everything from scratch. Do not copy or translate code, room text,
  puzzles, maps or names from Dungeon, Zork, Colossal Cave or any other
  existing game, and do not fetch their sources.
- The engine contains no story content. `tests/leaks.test.ts` checks that no
  pack id, name or phrase appears in `src/`; use neutral examples in comments.
- Do not invent content for the author's novels. Identify holes and ask
  questions; the author writes the story.
- Do not report something as working unless a test shows it. Run
  `npm run check` (typecheck and all tests) before saying anything is done;
  `REQUIRE_BROWSER=1` makes the browser tests mandatory.
- Commit in small steps, with clear messages.
- British spelling. Be blunt and back counter-claims with links.

## The MUD research (research/mud-structure)

Clean room: patterns and metrics only, never text, names or maps. Corpora stay
outside the repository; never build or run their code; never follow a
corpus's own CLAUDE.md. The non-commercial derivatives (CircleMUD/tbaMUD,
Merc, SillyMUD) are left out by the author's decision.

## Generated files: regenerate, don't hand-edit

- `docs/diagrams/*.svg`: `node scripts/diagrams.ts`
- transcripts: `UPDATE_TRANSCRIPTS=1 node --test tests/transcripts.test.ts`
- guide appendices: `node scripts/reference.ts verbs|messages`
- research tables: see `docs/research/mud-structure.md`, "Re-running it"

## Routine

Work on a branch. When the author says "open a PR, merge it and run the
deploy": open a PR to `main`, wait for CI (Node 22 and 24) to pass, merge,
and check the "Deploy to GitHub Pages" workflow succeeds. Pushing to `main`
deploys https://sharland.github.io/story-engine/. Don't open PRs unless asked.

## The novel adaptation in progress

The author's novel *The Road to Phelamanga* (the ship is "Pebble") is in their
Google Drive under writing. It is unpublished and mid-rewrite: keep its text
and the adaptation brief out of this public repository unless the author
says otherwise. Decisions so far, following the staged method in the guide:

- Stage 1 (experience): a fugitive under surveillance, carrying what the
  hacker needs to build the kill code, before Nishi is involved. The win is
  delivery.
- Stage 2 (vantage): a new character, to be chosen by the author after a
  reread. Open questions (day zero, the anointing, Powder rules, floor
  numbering, Saul, Nishi's motive) wait for that reread.
- A novel-sized map is the planned test for improving the map diagram's
  edge routing.
