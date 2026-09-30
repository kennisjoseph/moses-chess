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

export const DEPTH_PRESETS = {
  quick: { depth: 8, maxPlies: 30, label: 'Quick' },
  standard: { depth: 10, maxPlies: 50, label: 'Standard' },
  deep: { depth: 14, maxPlies: 60, label: 'Deep' },
};

export function hashGameUrls(games) {
  const joined = games
    .map((g) => g.url)
    .sort()
    .join('|');
  let hash = 0;
  for (let i = 0; i < joined.length; i++) {
    hash = (hash * 31 + joined.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

export async function analyzeGamesForBlunders(
  pool,
  games,
  username,
  { depth = 10, maxPlies = 50, onProgress, shouldCancel } = {}
) {
  const perGame = new Array(games.length).fill(null);
  let skipped = 0;
  let completed = 0;
  let nextIndex = 0;

  // Each engine in the pool pulls the next unclaimed game until none remain —
  // a simple work-queue so faster engines/positions don't sit idle waiting
  // for a slower one.
  async function worker(engine) {
    while (nextIndex < games.length) {
      if (shouldCancel && shouldCancel()) return;

      const i = nextIndex;
      nextIndex += 1;
      const game = games[i];

      try {
        const isWhite = game.white.username.toLowerCase() === username.toLowerCase();
        const mySide = isWhite ? 'w' : 'b';

        const flagged = await findBlundersInGame(engine, game.pgn, { depth, maxPlies });
        const myFlagged = flagged.filter((f) => f.side === mySide);

        perGame[i] = {
          url: game.url,
          blunders: myFlagged.filter((f) => f.severity === 'blunder').length,
          mistakes: myFlagged.filter((f) => f.severity === 'mistake').length,
        };
      } catch (err) {
        skipped += 1;
      }

      completed += 1;
      if (onProgress) onProgress(completed, games.length);
    }
  }

  await Promise.all(pool.engines.map((engine) => worker(engine)));

  const analyzed = perGame.filter(Boolean);
  const totalBlunders = analyzed.reduce((sum, g) => sum + g.blunders, 0);
  const totalMistakes = analyzed.reduce((sum, g) => sum + g.mistakes, 0);

  return {
    perGame: analyzed,
    totalGames: analyzed.length,
    skipped,
    totalBlunders,
    totalMistakes,
    avgBlundersPerGame: analyzed.length > 0 ? totalBlunders / analyzed.length : 0,
  };
}