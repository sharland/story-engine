// The game's own words for things the diagrams show: commands as a player
// would type them, conditions as short phrases, and text with its templates
// filled in as far as they can be without a game running.

import type { Comparison, Condition, TextDef, World } from '../engine/types.ts';

/** A text field as prose: passages resolved, variants joined, simple templates filled. */
export function prose(w: World, def: TextDef | null | undefined, self?: string, onlyFirst = false): string {
  if (def === null || def === undefined) return '';
  if (typeof def === 'string') {
    const text = def.startsWith('@@') ? def.slice(1) : def.startsWith('@') ? (w.texts.get(def.slice(1)) ?? '') : def;
    return fill(w, text, self);
  }
  const parts = def.map((p) => (typeof p === 'string' ? prose(w, p, self) : prose(w, p.text, self)));
  return (onlyFirst ? parts.slice(0, 1) : parts).filter((p) => p !== '').join(' ');
}

function fill(w: World, text: string, self?: string): string {
  return text
    .replace(/\{\{/g, '{')
    .replace(/\}\}/g, '}')
    .replace(/\{([A-Za-z]+):([A-Za-z0-9_.-]+)\}/g, (_m, kind: string, ref: string) => {
      const id = ref === 'noun' || ref === 'second' ? self : ref;
      const t = id ? w.things.get(id) : undefined;
      const name = t?.name ?? 'it';
      switch (kind) {
        case 'the':
          return t?.proper ? name : `the ${name}`;
        case 'The':
          return t?.proper ? name : `The ${name}`;
        case 'a':
        case 'A':
          return t?.proper ? name : `${kind === 'A' ? 'A' : 'a'} ${name}`;
        case 'name':
          return name;
        case 'it':
          return t ? pronoun(t) : 'it';
        case 'It':
        case 'That':
          return t ? cap(pronoun(t)) : 'It';
        case 'that':
          return t ? pronoun(t) : 'that';
        case 'is':
          return t?.plural ? 'are' : 'is';
        case 'has':
          return t?.plural ? 'have' : 'has';
        case 's':
          return t?.plural ? '' : 's';
        case 'es':
          return t?.plural ? '' : 'es';
        default:
          return '…';
      }
    })
    .replace(/\{[^{}]*\}/g, '…');
}

function pronoun(t: { plural: boolean; pronoun: string; kind: string }): string {
  if (t.plural) return 'them';
  return t.kind === 'character' ? t.pronoun : 'it';
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function thingName(w: World, id: string): string {
  return w.things.get(id)?.name ?? w.rooms.get(id)?.name ?? id;
}

function first(m: string | string[] | undefined): string | undefined {
  return Array.isArray(m) ? m[0] : m;
}

/**
 * A command a player could type for an action: the verb's first pattern with
 * the first word of each choice, and the slots filled with names.
 */
export function command(
  w: World,
  action: string,
  opts: { object?: string | string[]; with?: string | string[]; topic?: string | string[]; dir?: string | string[] } = {},
): string {
  const verb = w.verbs.get(action);
  const obj = first(opts.object);
  const second = first(opts.with);
  const topic = first(opts.topic);
  const want = (p: string) =>
    (!obj || /\bOBJ\b/.test(p)) && (!second || /\bOBJ2\b/.test(p)) && (!topic || /\bTEXT\b/.test(p)) && (!opts.dir || /\bDIR\b/.test(p));
  const pattern = verb?.patterns.find((p) => want(p) && !/^OBJ2|\bOBJ2 OBJ\b/.test(p)) ?? verb?.patterns.find(want) ?? verb?.patterns[0] ?? action;
  const words = pattern.split(/\s+/).map((tok) => {
    if (tok === 'OBJ') return obj ? named(w, obj) : 'something';
    if (tok === 'OBJ2') return second ? named(w, second) : 'something';
    if (tok === 'TEXT') return topic ?? '…';
    if (tok === 'DIR') return first(opts.dir) ?? 'somewhere';
    return tok.split('/')[0];
  });
  return words.join(' ');
}

function named(w: World, id: string): string {
  if (id === '*') return 'anything';
  if (id.startsWith('#')) return `anything ${id.slice(1)}`;
  return thingName(w, id);
}

/** Where a rule applies, in words. */
export function places(w: World, m: string | string[] | undefined): string {
  if (m === undefined) return '';
  return (Array.isArray(m) ? m : [m]).map((x) => w.rooms.get(x)?.name ?? x).join(' or ');
}

/** A state a condition names, as a short phrase ("guard bribed", "carrying crowbar"). */
export function conditionWords(w: World, c: Condition): string {
  if ('all' in c) return c.all.map((x) => conditionWords(w, x)).join(' and ');
  if ('any' in c) return c.any.map((x) => conditionWords(w, x)).join(' or ');
  if ('not' in c) {
    const inner = c.not;
    if ('var' in inner && [inner.eq, inner.ne, inner.gt, inner.gte, inner.lt, inner.lte].every((x) => x === undefined)) {
      return variableWords(w, inner.var, { eq: false });
    }
    return `not ${conditionWords(w, inner)}`;
  }
  if ('var' in c) return variableWords(w, c.var, c);
  if ('has' in c) return `carrying ${thingName(w, c.has)}`;
  if ('wearing' in c) return `wearing ${thingName(w, c.wearing)}`;
  if ('at' in c) return `in ${places(w, c.at)}`;
  if ('region' in c) return `in ${c.region}`;
  if ('here' in c) return `${thingName(w, c.here)} here`;
  if ('obj' in c) return `${thingName(w, c.obj)} in ${thingName(w, c.in)}`;
  if ('visited' in c) return `been to ${thingName(w, c.visited)}`;
  if ('act' in c) return `act ${actTitle(w, c.act)}`;
  if ('actAtLeast' in c) return `act ${actTitle(w, c.actAtLeast)} or later`;
  if ('light' in c) return c.light ? 'light' : 'dark';
  if ('chance' in c) return `${Math.round(c.chance * 100)}% chance`;
  if ('said' in c) return `said ${optionWords(w, c.said)}`;
  if ('script' in c) return `script ${c.script}`;
  return '?';
}

export function actTitle(w: World, id: string): string {
  const a = w.acts.find((x) => x.id === id);
  return a?.title ? a.title.replace(/^[IVXLC]+\.\s*/, '') : id;
}

function variableWords(w: World, name: string, cmp: Comparison): string {
  const dot = name.indexOf('.');
  const subject = dot > 0 ? `${thingName(w, name.slice(0, dot))} ${name.slice(dot + 1)}` : name;
  const negative = dot > 0 ? `${thingName(w, name.slice(0, dot))} not ${name.slice(dot + 1)}` : `not ${name}`;
  if (cmp.eq !== undefined) return cmp.eq === true ? subject : cmp.eq === false ? negative : `${subject} = ${String(cmp.eq)}`;
  if (cmp.ne !== undefined) return `${subject} ≠ ${String(cmp.ne)}`;
  if (cmp.gte !== undefined) return `${subject} ≥ ${cmp.gte}`;
  if (cmp.gt !== undefined) return `${subject} > ${cmp.gt}`;
  if (cmp.lte !== undefined) return `${subject} ≤ ${cmp.lte}`;
  if (cmp.lt !== undefined) return `${subject} < ${cmp.lt}`;
  return subject;
}

/** A dialogue option by "character.option", as the player's line. */
export function optionWords(w: World, ref: string): string {
  const [who, id] = ref.split('.');
  const d = w.dialogues.get(who);
  for (const node of Object.values(d?.nodes ?? {})) {
    const o = (node.options ?? []).find((x) => x.id === id);
    if (o) return prose(w, o.text);
  }
  return ref;
}
