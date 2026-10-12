// Standard library actions. Each handler checks, carries out and reports one
// action, and returns true if it succeeded (after-rules then run). Packs
// change these behaviours with rules, never by editing this file.

import type { ActionCtx, Game } from './game.ts';
import { matchTopic } from './text.ts';
import { isInside, PLAYER } from './world.ts';

export type Handler = (g: Game, c: ActionCtx) => boolean;

const noun = (c: ActionCtx): string => c.noun!;

function go(g: Game, dir: string): boolean {
  const room = g.world.rooms.get(g.state.location)!;
  const exit = room.exits.get(dir);
  if (!exit) {
    if (room.noExit) g.say(room.noExit);
    else g.msg('cantGo');
    return false;
  }
  if (exit.if && !g.test(exit.if)) {
    if (exit.else) g.say(exit.else);
    else g.msg('cantGo');
    return false;
  }
  if (exit.door && !g.flag(exit.door, 'open')) {
    g.msg(g.flag(exit.door, 'locked') ? 'doorLocked' : 'doorClosed', { noun: exit.door });
    return false;
  }
  if (!exit.to) {
    if (exit.say) g.say(exit.say);
    else g.msg('cantGo');
    g.run(exit.do);
    return false;
  }
  const destRegion = g.world.rooms.get(exit.to)?.region ?? null;
  if (destRegion && destRegion !== room.region) {
    const region = g.world.regions.get(destRegion);
    if (region?.if && !g.test(region.if)) {
      if (region.else) g.say(region.else);
      else g.msg('cantGo');
      return false;
    }
  }
  g.say(exit.say);
  g.run(exit.do);
  if (g.ended) return false;
  g.movePlayer(exit.to, true);
  return true;
}

function walk(g: Game, dir: string): boolean {
  return g.perform({ action: 'go', noun: null, second: null, topic: null, dir });
}

function examine(g: Game, c: ActionCtx): boolean {
  if (!g.isLit()) {
    g.msg('tooDark');
    return false;
  }
  const t = g.thing(noun(c));
  if (t.description) g.sayAbout(t.id, t.description);
  else g.msg('nothingSpecial');
  if (t.openable) g.msg(g.flag(t.id, 'open') ? 'isOpen' : 'isClosed');
  if (t.switchable) g.msg(g.flag(t.id, 'on') ? 'isOn' : 'isOff');
  if ((t.container || t.surface) && g.canSeeInto(t)) {
    const inside = g.children(t.id).filter((x) => !x.scenery).map((x) => x.id);
    if (inside.length > 0) g.msg(t.surface ? 'onSurface' : 'inContainer', { noun: t.id, list: g.listOf(inside) });
    else if (t.container && t.openable) g.msg('isEmpty');
  }
  return true;
}

function contentsOf(g: Game, id: string): string[] {
  return g.children(id).filter((x) => !x.scenery).map((x) => x.id);
}

export const ACTIONS: Record<string, Handler> = {
  look(g) {
    g.describeRoom(true);
    return true;
  },

  inventory(g) {
    const lines = g.inventoryLines(PLAYER, 1);
    if (lines.length === 0) g.msg('emptyHanded');
    else g.print([g.messageText('carrying'), ...lines].join('\n'));
    return true;
  },

  wait(g) {
    g.msg('waited');
    return true;
  },

  examine,

  examineSelf(g) {
    const own = g.world.manifest.player?.description;
    if (own) g.say(own);
    else g.msg('examineSelf');
    return true;
  },

  read(g, c) {
    if (!g.isLit()) {
      g.msg('tooDark');
      return false;
    }
    const t = g.thing(noun(c));
    if (t.read) {
      g.sayAbout(t.id, t.read);
      return true;
    }
    return examine(g, c);
  },

  search(g, c) {
    if (!g.isLit()) {
      g.msg('tooDark');
      return false;
    }
    const t = g.thing(noun(c));
    if (t.container) {
      if (!g.canSeeInto(t)) {
        g.msg('containerClosed');
        return false;
      }
      const inside = contentsOf(g, t.id);
      if (inside.length > 0) g.msg('inContainer', { list: g.listOf(inside) });
      else g.msg('isEmpty');
      return true;
    }
    if (t.surface) {
      const on = contentsOf(g, t.id);
      if (on.length > 0) g.msg('onSurface', { list: g.listOf(on) });
      else g.msg('nothingOn');
      return true;
    }
    g.msg('nothingFound');
    return true;
  },

  lookUnder(g) {
    g.msg('nothingFound');
    return true;
  },

  go(g, c) {
    return go(g, c.dir!);
  },

  enter(g, c) {
    if (!c.noun) return walk(g, 'in');
    const room = g.world.rooms.get(g.state.location)!;
    for (const exit of room.exits.values()) {
      if (exit.door === c.noun) return walk(g, exit.dir);
    }
    g.msg('cantEnter');
    return false;
  },

  exit(g) {
    return walk(g, 'out');
  },

  take(g, c) {
    const id = noun(c);
    const t = g.thing(id);
    if (c.second && !isInside(g.state, id, c.second)) {
      g.msg('notInside');
      return false;
    }
    if (g.isDirectlyHeld(id)) {
      g.msg('alreadyHave');
      return false;
    }
    if (t.kind === 'character') {
      g.msg('takeCharacter');
      return false;
    }
    if (t.fixed) {
      if (t.fixedMessage) g.say(t.fixedMessage);
      else g.msg(t.scenery ? 'scenery' : 'fixed');
      return false;
    }
    const blocker = g.blockedBy(id);
    if (blocker) {
      if (g.thing(blocker).kind === 'character') g.msg('belongsTo', { second: blocker });
      else g.msg('containerClosed', { noun: blocker });
      return false;
    }
    const capacity = g.world.manifest.player?.capacity;
    if (capacity !== undefined && !g.isHeld(id)) {
      const carried = g.children(PLAYER).filter((x) => !g.flag(x.id, 'worn')).length;
      if (carried >= capacity) {
        g.msg('carryingTooMuch');
        return false;
      }
    }
    g.moveThing(id, PLAYER);
    g.setProp(id, 'moved', true);
    g.msg('taken');
    return true;
  },

  drop(g, c) {
    const id = noun(c);
    if (!g.isHeld(id)) {
      g.msg('notHeld');
      return false;
    }
    if (g.flag(id, 'worn')) {
      g.msg('wornFirst');
      return false;
    }
    g.moveThing(id, g.state.location);
    g.msg('dropped');
    return true;
  },

  putIn(g, c) {
    return put(g, c, 'in');
  },

  putOn(g, c) {
    return put(g, c, 'on');
  },

  open(g, c) {
    const t = g.thing(noun(c));
    if (!t.openable) {
      g.msg('notOpenable');
      return false;
    }
    if (g.flag(t.id, 'open')) {
      g.msg('alreadyOpen');
      return false;
    }
    if (g.flag(t.id, 'locked')) {
      if (c.second) {
        g.perform({ action: 'unlock', noun: t.id, second: c.second, topic: null, dir: null });
        if (g.flag(t.id, 'locked')) return false;
      } else {
        g.msg('locked');
        return false;
      }
    }
    g.setProp(t.id, 'open', true);
    const inside = t.container && !t.transparent && g.isLit() ? contentsOf(g, t.id) : [];
    if (inside.length > 0) g.msg('openReveals', { list: g.listOf(inside) });
    else g.msg('opened');
    return true;
  },

  close(g, c) {
    const t = g.thing(noun(c));
    if (!t.openable) {
      g.msg('notCloseable');
      return false;
    }
    if (!g.flag(t.id, 'open')) {
      g.msg('alreadyClosed');
      return false;
    }
    g.setProp(t.id, 'open', false);
    g.msg('closed');
    return true;
  },

  lock(g, c) {
    return lockOrUnlock(g, c, true);
  },

  unlock(g, c) {
    return lockOrUnlock(g, c, false);
  },

  wear(g, c) {
    const t = g.thing(noun(c));
    if (!t.wearable) {
      g.msg('notWearable');
      return false;
    }
    if (g.isHeld(t.id) && g.flag(t.id, 'worn')) {
      g.msg('alreadyWearing');
      return false;
    }
    if (!g.implicitTake(t.id)) return false;
    g.setProp(t.id, 'worn', true);
    g.msg('wearing');
    return true;
  },

  takeOff(g, c) {
    const id = noun(c);
    if (!g.isHeld(id) || !g.flag(id, 'worn')) {
      if (!g.isHeld(id)) return g.perform({ action: 'take', noun: id, second: null, topic: null, dir: null });
      g.msg('notWearing');
      return false;
    }
    g.setProp(id, 'worn', false);
    g.msg('takenOff');
    return true;
  },

  switchOn(g, c) {
    return switchIt(g, c, true);
  },

  switchOff(g, c) {
    return switchIt(g, c, false);
  },

  eat(g, c) {
    const t = g.thing(noun(c));
    if (!t.edible) {
      g.msg('notEdible');
      return false;
    }
    if (!g.implicitTake(t.id)) return false;
    g.moveThing(t.id, null);
    g.msg('eaten');
    return true;
  },

  drink(g, c) {
    const t = g.thing(noun(c));
    if (!t.drinkable) {
      g.msg('notDrinkable');
      return false;
    }
    if (!t.fixed) g.moveThing(t.id, null);
    g.msg('drunk');
    return true;
  },

  push: refuse('nothingHappens'),
  pull: refuse('nothingHappens'),
  turn: refuse('nothingHappens'),
  touch: respond('touched'),
  smell: respond('smelled'),
  listen: respond('heard'),
  taste: respond('tasted'),
  attack: refuse('attackPointless'),
  throw: refuse('throwPointless'),
  climb(g, c) {
    g.msg(c.noun ? 'cantClimb' : 'nothingToClimb');
    return false;
  },
  jump: respond('jumped'),
  sleep: respond('slept'),
  yell: respond('yelled'),
  use: refuse('useVague'),

  give(g, c) {
    const target = g.thing(c.second!);
    if (target.kind !== 'character') {
      g.msg('giveNotCharacter');
      return false;
    }
    if (!g.implicitTake(noun(c))) return false;
    g.msg('notInterested');
    return false;
  },

  show(g, c) {
    const target = g.thing(c.second!);
    if (target.kind !== 'character') {
      g.msg('notCharacter', { noun: target.id });
      return false;
    }
    g.msg('shown');
    return false;
  },

  ask: converse,
  tell: converse,

  talk(g, c) {
    const t = g.thing(noun(c));
    if (t.kind !== 'character') {
      g.msg('notCharacter');
      return false;
    }
    if (t.talk) g.sayAbout(t.id, t.talk);
    else g.msg('talkDefault');
    return true;
  },

  say(g, c) {
    if (c.noun) g.msg(g.thing(c.noun).kind === 'character' ? 'saidToNobody' : 'notCharacter');
    else g.msg('saidNothing');
    return false;
  },
};

function refuse(key: string): Handler {
  return (g) => {
    g.msg(key);
    return false;
  };
}

function respond(key: string): Handler {
  return (g) => {
    g.msg(key);
    return true;
  };
}

function put(g: Game, c: ActionCtx, how: 'in' | 'on'): boolean {
  const id = noun(c);
  const dest = g.thing(c.second!);
  if (how === 'in' ? !dest.container : !dest.surface) {
    g.msg(how === 'in' ? 'cantPutIn' : 'cantPutOn');
    return false;
  }
  if (id === dest.id || isInside(g.state, dest.id, id)) {
    g.msg('putInSelf');
    return false;
  }
  if (how === 'in' && !g.flag(dest.id, 'open')) {
    g.msg('containerClosed', { noun: dest.id });
    return false;
  }
  const blocker = g.blockedBy(dest.id);
  if (blocker) {
    if (g.thing(blocker).kind === 'character') g.msg('belongsTo', { noun: dest.id, second: blocker });
    else g.msg('containerClosed', { noun: blocker });
    return false;
  }
  if (g.isHeld(id) && g.flag(id, 'worn')) {
    g.msg('wornFirst');
    return false;
  }
  if (dest.capacity !== null && g.children(dest.id).length >= dest.capacity) {
    g.msg('noRoom');
    return false;
  }
  if (!g.implicitTake(id)) return false;
  g.moveThing(id, dest.id);
  g.msg(how === 'in' ? 'putIn' : 'putOn');
  return true;
}

function lockOrUnlock(g: Game, c: ActionCtx, lock: boolean): boolean {
  const t = g.thing(noun(c));
  if (!t.lockable) {
    g.msg('notLockable');
    return false;
  }
  const locked = g.flag(t.id, 'locked');
  if (lock && locked) {
    g.msg('alreadyLocked');
    return false;
  }
  if (!lock && !locked) {
    g.msg('alreadyUnlocked');
    return false;
  }
  if (lock && t.openable && g.flag(t.id, 'open')) {
    g.msg('closeFirst');
    return false;
  }
  if (!c.second || !t.keys.includes(c.second)) {
    if (c.second) g.msg('wrongKey');
    else g.msg('locked');
    return false;
  }
  if (!g.implicitTake(c.second)) return false;
  g.setProp(t.id, 'locked', lock);
  g.msg(lock ? 'lockedIt' : 'unlockedIt');
  return true;
}

function switchIt(g: Game, c: ActionCtx, on: boolean): boolean {
  const t = g.thing(noun(c));
  if (!t.switchable) {
    g.msg('notSwitchable');
    return false;
  }
  if (g.flag(t.id, 'on') === on) {
    g.msg(on ? 'alreadyOn' : 'alreadyOff');
    return false;
  }
  g.setProp(t.id, 'on', on);
  g.msg(on ? 'switchedOn' : 'switchedOff');
  return true;
}

function converse(g: Game, c: ActionCtx): boolean {
  const t = g.thing(noun(c));
  if (t.kind !== 'character') {
    g.msg('notCharacter');
    return false;
  }
  for (const topic of t.topics) {
    if (!matchTopic(topic.keys, c.topic)) continue;
    if (topic.once && g.state.fired.includes(topic.id)) continue;
    if (topic.if && !g.test(topic.if)) continue;
    if (topic.once) g.state.fired.push(topic.id);
    g.sayAbout(t.id, topic.text);
    g.run(topic.do);
    return true;
  }
  if (t.noTopic) g.sayAbout(t.id, t.noTopic);
  else g.msg('noTopic');
  return false;
}
