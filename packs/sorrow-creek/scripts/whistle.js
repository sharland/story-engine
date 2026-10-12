// The western's script module: whistling brings a calmed mare to you from
// the next room. It shows a pack verb implemented in a script, using the
// map (ctx.exits) in a way the declarative rules cannot.

export default function register(api) {
  api.action('whistle', (ctx) => {
    const here = ctx.room();
    const mare = ctx.locationOf('mare');
    if (mare === here) {
      ctx.say('The mare swivels an ear at you. She is right here.');
      return true;
    }
    const neighbours = Object.values(ctx.exits(here));
    if (ctx.get('mare.calm') && neighbours.includes(mare)) {
      ctx.move('mare', here);
      ctx.say('You put two fingers to your lips and whistle. A moment later the mare trots up, looking for more sugar.');
      return true;
    }
    ctx.say('Your whistle carries down the street. Nothing comes of it.');
    return false;
  });
}
