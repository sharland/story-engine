// Script module for the testbed fixture: one condition, one effect and one
// action, to prove each extension point works.

export default function register(api) {
  api.condition('holding-many', (ctx) => ctx.contents('player').length >= ctx.args.n);

  api.effect('tally', (ctx) => {
    const n = ctx.contents('player').length;
    ctx.say(`You count ${n} ${n === 1 ? 'thing' : 'things'} in your hands.`);
  });

  api.action('whistle', (ctx) => {
    if (ctx.locationOf('dog') === ctx.room()) {
      ctx.set('dog.following', true);
      ctx.say('Rufus bounds over and sticks to your heels.');
      return true;
    }
    ctx.say('You whistle. Nothing comes.');
    return false;
  });
}
