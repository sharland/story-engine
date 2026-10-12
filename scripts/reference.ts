// Prints the standard-verb and standard-message reference tables for
// docs/WRITING-A-PACK.md. tests/docs.test.ts checks the guide matches.
import { STANDARD_MESSAGES, STANDARD_VERBS } from '../src/engine/stdlib.ts';

const SUCCEEDS: Record<string, string> = {
  look: 'yes', examineSelf: 'yes', inventory: 'yes', wait: 'yes', examine: 'yes, if lit', read: 'yes, if lit', search: 'if lit, and not a closed container',
  lookUnder: 'yes', go: 'if the player moves', enter: 'if the player moves', exit: 'if the player moves',
  take: 'if taken', drop: 'if dropped', putIn: 'if put', putOn: 'if put', open: 'if opened', close: 'if closed',
  lock: 'if locked', unlock: 'if unlocked', wear: 'if worn', takeOff: 'if taken off', switchOn: 'if switched',
  switchOff: 'if switched', eat: 'if eaten', drink: 'if drunk', push: 'never', pull: 'never', turn: 'never',
  touch: 'yes', smell: 'yes', listen: 'yes', taste: 'yes', attack: 'never', throw: 'never', climb: 'never',
  jump: 'yes', sleep: 'yes', yell: 'yes', use: 'never', give: 'never', show: 'never',
  ask: 'if a topic matched', tell: 'if a topic matched', talk: 'if it is a character', say: 'never',
};

export function verbTable(): string {
  const rows = ['| Verb id | Patterns | Standard behaviour succeeds (after-rules run) |', '|---|---|---|'];
  for (const [id, v] of Object.entries(STANDARD_VERBS)) {
    const pats = v.patterns.map((p) => `\`${p}\``).join(', ');
    const note = id === 'again'
      ? 'repeats the last command, which then takes its turn and runs its rules as usual'
      : v.meta ? 'meta: no time passes, rules do not apply' : SUCCEEDS[id] ?? '?';
    rows.push(`| \`${id}\` | ${pats} | ${note} |`);
  }
  return rows.join('\n');
}

export function messageTable(): string {
  const rows = ['| Key | Default text |', '|---|---|'];
  for (const [k, v] of Object.entries(STANDARD_MESSAGES)) rows.push(`| \`${k}\` | ${v.replace(/\|/g, '\\|')} |`);
  return rows.join('\n');
}

if (process.argv[2] === 'verbs') console.log(verbTable());
if (process.argv[2] === 'messages') console.log(messageTable());
