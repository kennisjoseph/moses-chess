import { Chess } from 'chess.js';

function sideToMove(fen) {
  return fen.split(' ')[1]; // 'w' or 'b'
}

// UCI scores are always from the perspective of whoever is to move
// in that exact position. Flip everything onto White's perspective
// so consecutive positions can be compared directly.
function toWhiteCp({ scoreCp, scoreMate }, movingSide) {
  let raw;
  if (scoreMate !== null && scoreMate !== undefined) {
    raw = scoreMate > 0 ? 10000 : -10000;
  } else {
    raw = scoreCp ?? 0;
  }
  return movingSide === 'w' ? raw : -raw;
}

const BLUNDER_THRESHOLD = 300;
const MISTAKE_THRESHOLD = 100;

export async function findBlundersInGame(engine, pgn, { depth = 10, maxPlies = 60 } = {}) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });

  const flagged = [];
  let prevEvalWhite = null;

  for (let i = 0; i < history.length && i < maxPlies; i++) {
    const move = history[i];

    if (prevEvalWhite === null) {
      const beforeResult = await engine.evaluatePosition(move.before, depth);
      prevEvalWhite = toWhiteCp(beforeResult, sideToMove(move.before));
    }

    const afterResult = await engine.evaluatePosition(move.after, depth);
    const afterEvalWhite = toWhiteCp(afterResult, sideToMove(move.after));

    const mover = move.color; // 'w' or 'b'
    const delta = afterEvalWhite - prevEvalWhite;
    const playerLoss = mover === 'w' ? Math.max(0, -delta) : Math.max(0, delta);

    let severity = null;
    if (playerLoss >= BLUNDER_THRESHOLD) severity = 'blunder';
    else if (playerLoss >= MISTAKE_THRESHOLD) severity = 'mistake';

    if (severity) {
      flagged.push({
        moveNumber: Math.ceil((i + 1) / 2),
        side: mover,
        san: move.san,
        severity,
        evalSwing: Math.round(playerLoss),
      });
    }

    prevEvalWhite = afterEvalWhite;
  }

  return flagged;
}

export async function analyzeGamesForBlunders(
  engine,
  games,
  username,
  { depth = 10, maxPlies = 50, onProgress, shouldCancel } = {}
) {
  const perGame = [];
  let skipped = 0;

  for (let i = 0; i < games.length; i++) {
    if (shouldCancel && shouldCancel()) break;

    const game = games[i];
    if (onProgress) onProgress(i + 1, games.length);

    try {
      const isWhite = game.white.username.toLowerCase() === username.toLowerCase();
      const mySide = isWhite ? 'w' : 'b';

      const flagged = await findBlundersInGame(engine, game.pgn, { depth, maxPlies });
      const myFlagged = flagged.filter((f) => f.side === mySide);

      perGame.push({
        url: game.url,
        blunders: myFlagged.filter((f) => f.severity === 'blunder').length,
        mistakes: myFlagged.filter((f) => f.severity === 'mistake').length,
      });
    } catch (err) {
      skipped += 1; // a PGN we can't parse shouldn't sink the whole run
    }
  }

  const analyzed = perGame.length;
  const totalBlunders = perGame.reduce((sum, g) => sum + g.blunders, 0);
  const totalMistakes = perGame.reduce((sum, g) => sum + g.mistakes, 0);

  return {
    perGame,
    totalGames: analyzed,
    skipped,
    totalBlunders,
    totalMistakes,
    avgBlundersPerGame: analyzed > 0 ? totalBlunders / analyzed : 0,
  };
}