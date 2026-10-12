// The standard library: the English command set, compass directions and
// default messages that every pack starts with. This is genre convention, not
// story content. Packs add verbs and directions and may override any message.

export interface StandardVerb {
  patterns: string[];
  multi?: boolean;
  meta?: boolean;
}

export const STANDARD_VERBS: Record<string, StandardVerb> = {
  // Meta commands: no game time passes.
  score: { patterns: ['score'], meta: true },
  save: { patterns: ['save', 'save TEXT'], meta: true },
  restore: { patterns: ['restore/load', 'restore/load TEXT'], meta: true },
  restart: { patterns: ['restart'], meta: true },
  quit: { patterns: ['quit/q'], meta: true },
  undo: { patterns: ['undo'], meta: true },
  again: { patterns: ['again/g'], meta: true },
  help: { patterns: ['help/hint/hints'], meta: true },
  about: { patterns: ['about/credits/info/version'], meta: true },
  verbose: { patterns: ['verbose'], meta: true },
  brief: { patterns: ['brief'], meta: true },

  // Looking and waiting.
  look: { patterns: ['look/l'] },
  inventory: { patterns: ['inventory/i/inv'] },
  wait: { patterns: ['wait/z'] },
  examine: { patterns: ['examine/x/inspect/check/describe OBJ', 'look/l at OBJ'] },
  examineSelf: { patterns: ['examine/x/inspect/check/describe me/myself/self', 'look/l at me/myself/self'] },
  read: { patterns: ['read OBJ'] },
  search: { patterns: ['search OBJ', 'look/l in/inside/into OBJ'] },
  lookUnder: { patterns: ['look/l under/behind/beneath OBJ'] },

  // Movement.
  go: { patterns: ['DIR', 'go/walk/run/head DIR'] },
  enter: {
    patterns: ['enter', 'enter OBJ', 'go/walk in/into/through OBJ', 'get in/into OBJ', 'climb in/into/through OBJ'],
  },
  exit: { patterns: ['exit/leave', 'get out'] },

  // Handling things.
  take: {
    patterns: [
      'take/get/grab/carry OBJ',
      'pick up OBJ',
      'pick OBJ up',
      'take/get/remove OBJ from/off OBJ2',
      'take/get OBJ out of OBJ2',
    ],
    multi: true,
  },
  drop: { patterns: ['drop/discard OBJ', 'put/set OBJ down', 'put/set down OBJ'], multi: true },
  putIn: { patterns: ['put/place/insert/stick/drop OBJ in/into/inside OBJ2'], multi: true },
  putOn: { patterns: ['put/place/set/drop OBJ on/onto OBJ2'], multi: true },
  open: { patterns: ['open OBJ', 'open OBJ with OBJ2'] },
  close: { patterns: ['close/shut OBJ'] },
  lock: { patterns: ['lock OBJ', 'lock OBJ with OBJ2'] },
  unlock: { patterns: ['unlock OBJ', 'unlock OBJ with OBJ2'] },
  wear: { patterns: ['wear/don OBJ', 'put on OBJ', 'put OBJ on'] },
  takeOff: { patterns: ['take off OBJ', 'take OBJ off', 'doff/remove OBJ'] },
  switchOn: { patterns: ['turn/switch on OBJ', 'turn/switch OBJ on', 'light/activate OBJ'] },
  switchOff: { patterns: ['turn/switch off OBJ', 'turn/switch OBJ off', 'extinguish/douse/deactivate OBJ'] },
  eat: { patterns: ['eat OBJ'] },
  drink: { patterns: ['drink/sip OBJ'] },
  push: { patterns: ['push/press/shove/move OBJ'] },
  pull: { patterns: ['pull/drag/tug OBJ'] },
  turn: { patterns: ['turn/rotate/twist/spin OBJ'] },
  touch: { patterns: ['touch/feel/rub/pat OBJ'] },
  smell: { patterns: ['smell/sniff', 'smell/sniff OBJ'] },
  listen: { patterns: ['listen', 'listen to OBJ'] },
  taste: { patterns: ['taste/lick OBJ'] },
  attack: { patterns: ['attack/hit/kill/fight/strike/punch/kick OBJ', 'attack/hit/kill/fight/strike OBJ with OBJ2'] },
  throw: { patterns: ['throw/toss/hurl OBJ', 'throw/toss/hurl OBJ at/to OBJ2'] },
  climb: { patterns: ['climb', 'climb/scale OBJ', 'climb up/down/over OBJ'] },
  jump: { patterns: ['jump/leap/hop'] },
  sleep: { patterns: ['sleep/nap/rest'] },
  yell: { patterns: ['yell/shout/scream/holler'] },
  use: { patterns: ['use OBJ', 'use OBJ on/with OBJ2'] },

  // People.
  give: { patterns: ['give/offer/hand OBJ to OBJ2', 'give/offer/hand OBJ2 OBJ'] },
  show: { patterns: ['show/display OBJ to OBJ2', 'show OBJ2 OBJ'] },
  ask: { patterns: ['ask/question OBJ about TEXT'] },
  tell: { patterns: ['tell/inform OBJ about TEXT'] },
  talk: { patterns: ['talk/speak to/with OBJ', 'greet OBJ'] },
  say: { patterns: ['say/utter TEXT', 'say/utter TEXT to OBJ'] },
};

/** Pseudo-actions that rules can hook but players cannot type. */
export const PSEUDO_ACTIONS = ['start', 'arrive', 'turn'] as const;

export interface StandardDirection {
  words: string[];
  opposite: string;
}

export const STANDARD_DIRECTIONS: Record<string, StandardDirection> = {
  north: { words: ['north', 'n'], opposite: 'south' },
  south: { words: ['south', 's'], opposite: 'north' },
  east: { words: ['east', 'e'], opposite: 'west' },
  west: { words: ['west', 'w'], opposite: 'east' },
  northeast: { words: ['northeast', 'ne'], opposite: 'southwest' },
  northwest: { words: ['northwest', 'nw'], opposite: 'southeast' },
  southeast: { words: ['southeast', 'se'], opposite: 'northwest' },
  southwest: { words: ['southwest', 'sw'], opposite: 'northeast' },
  up: { words: ['up', 'u'], opposite: 'down' },
  down: { words: ['down', 'd'], opposite: 'up' },
  in: { words: ['in', 'inside'], opposite: 'out' },
  out: { words: ['out', 'outside'], opposite: 'in' },
};

/** Words the parser reserves. Object vocabulary must not use them. */
export const RESERVED_WORDS = [
  'a', 'an', 'the', 'all', 'everything', 'but', 'except', 'and', 'then',
  'it', 'them', 'him', 'her',
];

/** Read-only variables every pack can test. */
export const BUILTIN_VARS = ['turns', 'score', 'maxScore', 'room', 'act'];

/** Entity properties the engine itself reads and writes. */
export const STANDARD_PROPS = ['open', 'locked', 'on', 'worn', 'moved', 'visited', 'dark', 'following'];

// Messages. Templates: {The:noun} {the:noun} {a:noun} {A:noun} {name:noun}
// {it:noun} {It:noun} {that:noun} {That:noun}, verb endings {is:noun} {has:noun}
// {s:noun} {es:noun} (singular "s"/"es", plural nothing), where the part after
// the colon is "noun", "second" or an id; {var:name}; {score} {max} {turns}
// {turnCount} ("1 turn", "5 turns");
// and named parameters such as {list}, {word} and {n}.
export const STANDARD_MESSAGES: Record<string, string> = {
  // Parser
  emptyCommand: 'I beg your pardon?',
  unknownWord: 'I don\'t know the word "{word}".',
  notUnderstood: "I didn't understand that sentence.",
  cantSeeThat: "You can't see any such thing.",
  noPronoun: 'I\'m not sure what "{word}" refers to.',
  pronounGone: "You can't see {the:noun} any more.",
  which: 'Which do you mean, {list}?',
  whatToVerb: 'What do you want to {verb}?',
  whatToVerbWith: 'What do you want to {verb} {the:noun} with?',
  noMultiples: "You can't use more than one object with that verb.",
  nothingForAll: 'There is nothing to {verb}.',
  notCarryingAnything: 'You are not carrying anything.',
  gameOver: 'The game is over. Type RESTART, RESTORE, UNDO or QUIT.',

  // Meta
  scoreReport: 'You have scored {score} out of a possible {max}, in {turnCount}.',
  noScore: 'This story is not scored. You have taken {turnCount}.',
  scoreUp: '[Your score has gone up by {n}.]',
  scoreDown: '[Your score has gone down by {n}.]',
  saved: 'Saved.',
  saveFailed: 'Save failed.',
  restored: 'Restored.',
  restoreFailed: 'Restore failed: {reason}.',
  undone: 'Previous turn undone.',
  cantUndo: 'There is nothing to undo.',
  noAgain: 'There is no command to repeat.',
  restarting: 'Starting again.',
  goodbye: 'Goodbye.',
  verboseOn: 'Full room descriptions from now on.',
  briefOn: 'Full descriptions only for rooms you have not seen before.',
  help:
    'Type short commands: LOOK, INVENTORY, a direction such as NORTH or N, TAKE something, ' +
    'PUT something IN something, OPEN something, ASK someone ABOUT something. Other ' +
    'commands: SCORE, SAVE, RESTORE, UNDO, AGAIN, RESTART, QUIT, ABOUT.',
  endingTitle: '*** {title} ***',
  finalScore: 'In {turnCount} you scored {score} out of a possible {max}.',

  // Looking
  darkTitle: 'Darkness',
  dark: 'It is pitch dark. You cannot see a thing.',
  nowDark: 'It is now pitch dark.',
  tooDark: 'It is too dark to see.',
  youSee: 'You can see {list} here.',
  onSurface: 'On {the:noun} you can see {list}.',
  inContainer: 'In {the:noun} you can see {list}.',
  characterHere: '{The:noun} {is:noun} here.',
  nothingSpecial: 'You see nothing special about {the:noun}.',
  examineSelf: 'You look as you always do.',
  isOpen: '{It:noun} {is:noun} open.',
  isClosed: '{It:noun} {is:noun} closed.',
  isOn: '{It:noun} {is:noun} switched on.',
  isOff: '{It:noun} {is:noun} switched off.',
  isEmpty: '{The:noun} {is:noun} empty.',
  nothingOn: 'There is nothing on {the:noun}.',
  nothingFound: 'You find nothing of interest.',
  carrying: 'You are carrying:',
  emptyHanded: 'You are empty-handed.',
  beingWorn: '(being worn)',
  providingLight: '(providing light)',
  waited: 'Time passes.',

  // Movement
  cantGo: "You can't go that way.",
  doorClosed: '{The:noun} {is:noun} closed.',
  doorLocked: '{The:noun} {is:noun} locked.',
  cantEnter: "That's not something you can enter.",
  characterArrives: '{The:noun} arrives.',
  characterDeparts: '{The:noun} leaves.',

  // Taking and dropping
  taken: 'Taken.',
  dropped: 'Dropped.',
  alreadyHave: 'You already have {that:noun}.',
  notHeld: "You aren't carrying {that:noun}.",
  fixed: '{That:noun} {is:noun} fixed in place.',
  scenery: "That's hardly portable.",
  takeCharacter: '{The:noun} would not appreciate that.',
  belongsTo: '{That:noun} seem{s:noun} to belong to {the:second}.',
  notInside: "{The:noun} {is:noun} not there.",
  carryingTooMuch: "You're carrying too many things already.",
  takeSelf: 'You are always self-possessed.',
  firstTaking: '(first taking {the:noun})',
  wornFirst: "You'll have to take {it:noun} off first.",
  containerClosed: '{The:noun} {is:noun} closed.',

  // Containers and surfaces
  putIn: 'You put {the:noun} in {the:second}.',
  putOn: 'You put {the:noun} on {the:second}.',
  cantPutIn: "You can't put things in {the:second}.",
  cantPutOn: "You can't put things on {the:second}.",
  putInSelf: "You can't put something inside itself.",
  noRoom: 'There is no more room in {the:second}.',

  // Opening and locking
  notOpenable: "You can't open {that:noun}.",
  notCloseable: "You can't close {that:noun}.",
  alreadyOpen: '{It:noun} {is:noun} already open.',
  alreadyClosed: '{It:noun} {is:noun} already closed.',
  opened: 'You open {the:noun}.',
  openReveals: 'Opening {the:noun} reveals {list}.',
  closed: 'You close {the:noun}.',
  locked: '{It:noun} seems to be locked.',
  notLockable: "{That:noun} do{es:noun}n't have a lock.",
  alreadyLocked: '{It:noun} {is:noun} already locked.',
  alreadyUnlocked: "{It:noun} {is:noun} not locked.",
  closeFirst: "You'll have to close {it:noun} first.",
  wrongKey: "{The:second} won't fit {the:noun}.",
  withKey: '(with {the:second})',
  lockedIt: 'You lock {the:noun}.',
  unlockedIt: 'You unlock {the:noun}.',

  // Clothing and devices
  notWearable: "You can't wear {that:noun}.",
  alreadyWearing: "You're already wearing {it:noun}.",
  notWearing: "You aren't wearing {that:noun}.",
  wearing: 'You put on {the:noun}.',
  takenOff: 'You take off {the:noun}.',
  notSwitchable: "You can't switch {that:noun} on or off.",
  alreadyOn: "{It:noun} {is:noun} already on.",
  alreadyOff: "{It:noun} {is:noun} already off.",
  switchedOn: 'You switch on {the:noun}.',
  switchedOff: 'You switch off {the:noun}.',

  // Eating, reading, senses
  eaten: 'You eat {the:noun}.',
  drunk: 'You drink {the:noun}.',
  notEdible: "You can't eat {that:noun}.",
  notDrinkable: "You can't drink {that:noun}.",
  nothingHappens: 'Nothing obvious happens.',
  touched: 'You feel nothing unexpected.',
  smelled: 'You smell nothing unexpected.',
  heard: 'You hear nothing unexpected.',
  tasted: 'You taste nothing unexpected.',
  attackPointless: "Fighting won't help here.",
  throwPointless: 'Throwing {the:noun} would achieve nothing.',
  cantClimb: "You can't climb {that:noun}.",
  nothingToClimb: 'There is nothing obvious to climb.',
  jumped: 'You jump on the spot. Nothing changes.',
  slept: 'This is no time for sleeping.',
  yelled: 'You shout. Nobody answers.',
  useVague: 'Try a more specific verb with {the:noun}.',

  // People
  giveNotCharacter: "You can't give things to {the:second}.",
  notInterested: "{The:second} do{es:second}n't seem interested.",
  shown: '{The:second} glance{s:second} at {the:noun} without interest.',
  notCharacter: "You can't talk to {that:noun}.",
  noTopic: '{The:noun} {has:noun} nothing to say about that.',
  talkDefault: '{The:noun} wait{s:noun} for you to ask about something.',
  saidNothing: 'Nothing happens.',
  saidToNobody: "{The:noun} do{es:noun}n't respond.",
};
