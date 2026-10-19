# MUD structure study: tools

Readers and measures behind [docs/research/mud-structure.md](../../docs/research/mud-structure.md).

- `model.ts`: a neutral world model that holds ids and numbers only.
- `diku.ts`: the original DikuMUD files (`.wld`, `.zon`, `.mob`, `.obj`).
- `vme.ts`, `vme-tokens.ts`: DikuMUD III zone source (`.zon`).
- `packs.ts`: our own packs in the same model.
- `metrics.ts`: the measures, with their definitions.
- `report.ts`: runs everything and writes `results.json` and `tables.md`.

## Clean-room rules

- Corpora live outside this repository and are never committed.
- Only their data files are read; none of their code is built or run.
- Readers discard titles, descriptions and keywords as they parse. A
  description becomes a word count and a fingerprint, used only to find rooms
  with identical text.
- `report.ts` refuses to write output containing any word that isn't from these
  tools' own source, a label given on the command line, or an anonymous zone
  label (`A01`).
- `report.ts --check <file>` lists any corpus identifier found in a
  hand-written document, for review before committing it.
- Tests use small synthetic worlds written for them (`tests/mud-structure.test.ts`).

Only use corpora whose licence allows it. The study uses the LGPL releases of
DikuMUD (Alfa, Gamma) and DikuMUD III; the derivatives (CircleMUD, Merc,
SillyMUD) have non-commercial licences and are left out.
