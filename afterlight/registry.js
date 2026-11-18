// Games share input, audio, and navigation. Each owns its simulation and artwork.
'use strict';
const arcadeGames = [];
function registerGame(game) {
  if (arcadeGames.some(entry => entry.id === game.id)) throw new Error('Duplicate game: ' + game.id);
  arcadeGames.push(game);
}
