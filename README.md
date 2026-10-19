# story-engine

A story-agnostic text adventure engine that loads worlds as content packs.

It plays like the late-1970s mainframe adventures: you type commands, move
between rooms, carry and use objects, solve puzzles and earn a score. The
engine contains no story. Rooms, objects, characters, prose, vocabulary and
puzzle logic all come from a content pack loaded at start-up, from any
directory.

- Design: [docs/DESIGN.md](docs/DESIGN.md)
- Writing a pack: [docs/WRITING-A-PACK.md](docs/WRITING-A-PACK.md)

## Requirements

Node.js 22.18 or later. The sources are TypeScript that Node runs directly;
there is no build step for playing or testing. There are no runtime
dependencies.

```sh
npm install
npm test
```

## Playing

```sh
npm run play -- packs/halcyon-relay            # any pack directory, anywhere on disk
npm run play -- ../my-private-packs/my-novel --seed 42
```

Or open the web page: `npm run build`, then open `site/index.html` in a
browser (it works straight from disk, no server needed), or use the GitHub
Pages deployment.

## Command line

```
node src/cli/main.ts play <pack> [--seed N] [--saves DIR] [--width N]
node src/cli/main.ts validate <pack> [--no-play] [--json]
node src/cli/main.ts shape <pack>
node src/cli/main.ts walkthrough <pack> [file...]
node src/cli/main.ts bundle <pack> [-o FILE]
```

`<pack>` is a pack directory or a bundle file. `play` reads from the keyboard
or from a pipe (`printf 'look\nnorth\n' | node src/cli/main.ts play <pack> --seed 1`),
so a session can be replayed exactly from its seed and its commands.
`npm run build` also writes a single-file CLI to `dist/story-engine.js`.

## Repository layout

```
src/engine/   the engine: platform-free, no Node or browser APIs
src/node/     loading packs from disk
src/cli/      command-line runner
src/web/      the static web page
packs/        two demo packs (CC0): halcyon-relay (science fiction), sorrow-creek (western)
tests/        node:test suites, transcript files, fixture packs
scripts/      build script for the site and the bundled CLI
```

## Tests

`npm test` runs everything: transcript tests (exact output for every parser
form and world-model feature), each demo pack's walkthroughs to their
endings, validator tests on deliberately broken packs, loading packs from
outside the repository, the CLI, a check that engine source mentions nothing
from any pack, and the web page in headless Chromium. The browser tests skip
if no browser can be launched, unless `REQUIRE_BROWSER=1` (as in CI). Locally,
`npx playwright-core install chromium` installs one.

`UPDATE_TRANSCRIPTS=1 npm test` rewrites the transcript files from the
engine's current output. Read the diff before committing it.

## GitHub Pages

`.github/workflows/pages.yml` builds the site and deploys it on every push to
`main`. It needs one setting: **Settings → Pages → Build and deployment →
Source: GitHub Actions**. Until that is set, the deploy job fails.

## Licences

- Engine code (everything outside `packs/`): MIT, see [LICENSE](LICENSE).
- Demo packs in `packs/`: CC0 1.0, see the `LICENSE` file in each pack, except
  the fonts in `packs/*/theme/fonts/`, which are under the SIL Open Font
  Licence 1.1 (each licence text is next to its font).
- **Third-party packs carry their own licences.** Loading a pack into this
  engine does not change its licence, and the engine's licence says nothing
  about the content of packs you load.
