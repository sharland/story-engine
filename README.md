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

Node.js 22.18 or later (the sources are TypeScript run directly by Node).

```sh
npm install
npm test
```

## Licences

- Engine code (everything outside `packs/`): MIT, see [LICENSE](LICENSE).
- Demo packs in `packs/`: CC0 1.0, see the `LICENSE` file in each pack.
- **Third-party packs carry their own licences.** Loading a pack into this
  engine does not change its licence, and the engine's licence says nothing
  about the content of packs you load.
