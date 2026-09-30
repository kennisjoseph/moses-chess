import { Chess } from 'chess.js';
import { parsePgnMoves } from './pgn';

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

function phaseForPly(ply) {
  if (ply <= 20) return 'opening';
  if (ply <= 60) return 'middlegame';
  return 'endgame';
}

const BLUNDER_THRESHOLD = 300;
const MISTAKE_THRESHOLD = 100;
const DECISIVE_ADVANTAGE = 400;
const CLEARLY_LOST = -400;
const STILL_CLOSE = -200;

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

    const mover = move.color;
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

// The richer per-game pass: tags every flagged move with phase and clock,
// finds the game's real turning point, checks whether a winning advantage
// got thrown away, and — for losses — sanity-checks the ending against the
// real engine eval instead of trusting the raw termination code.
export async function analyzeGameDeep(engine, game, username, { depth = 10, maxPlies = 50 } = {}) {
  const chess = new Chess();
  chess.loadPgn(game.pgn);
  const history = chess.history({ verbose: true });

  const clockMoves = parsePgnMoves(game.pgn);
  const clockByPly = clockMoves.map((m) => m.clockSeconds);

  const isWhite = game.white.username.toLowerCase() === username.toLowerCase();
  const mySide = isWhite ? 'w' : 'b';
  const mine = isWhite ? game.white : game.black;
  const theirs = isWhite ? game.black : game.white;

  let result;
  if (mine.result === 'win') result = 'win';
  else if (theirs.result === 'win') result = 'loss';
  else result = 'draw';
  const terminationCode = result === 'loss' ? mine.result : theirs.result;

  const flagged = [];
  let prevEvalWhite = null;
  let myPeakEval = -Infinity;

  const analyzedCount = Math.min(history.length, maxPlies);

  for (let i = 0; i < analyzedCount; i++) {
    const move = history[i];

    if (prevEvalWhite === null) {
      const beforeResult = await engine.evaluatePosition(move.before, depth);
      prevEvalWhite = toWhiteCp(beforeResult, sideToMove(move.before));
    }

    const afterResult = await engine.evaluatePosition(move.after, depth);
    const afterEvalWhite = toWhiteCp(afterResult, sideToMove(move.after));

    const mover = move.color;
    const delta = afterEvalWhite - prevEvalWhite;
    const playerLoss = mover === 'w' ? Math.max(0, -delta) : Math.max(0, delta);

    if (mover === mySide) {
      const myEval = mySide === 'w' ? afterEvalWhite : -afterEvalWhite;
      if (myEval > myPeakEval) myPeakEval = myEval;
    }

    let severity = null;
    if (playerLoss >= BLUNDER_THRESHOLD) severity = 'blunder';
    else if (playerLoss >= MISTAKE_THRESHOLD) severity = 'mistake';

    if (severity && mover === mySide) {
      flagged.push({
        moveNumber: Math.ceil((i + 1) / 2),
        san: move.san,
        severity,
        evalSwing: Math.round(playerLoss),
        phase: phaseForPly(i + 1),
        clockRemaining: clockByPly[i] ?? null,
      });
    }

    prevEvalWhite = afterEvalWhite;
  }

  const turningPoint =
    flagged.length > 0
      ? flagged.reduce((worst, m) => (m.evalSwing > worst.evalSwing ? m : worst))
      : null;

  const blownAdvantage =
    result !== 'win' && myPeakEval >= DECISIVE_ADVANTAGE
      ? { peakEval: Math.round(myPeakEval) }
      : null;

  let endingCheck = null;
  if (result === 'loss' && history.length > 0) {
    if (terminationCode === 'resigned') {
      const finalFen = history[history.length - 1].after;
      const finalResult = await engine.evaluatePosition(finalFen, depth);
      const finalEvalWhite = toWhiteCp(finalResult, sideToMove(finalFen));
      const finalEvalMine = mySide === 'w' ? finalEvalWhite : -finalEvalWhite;

      endingCheck = {
        type: 'resigned',
        finalEval: Math.round(finalEvalMine),
        justified: finalEvalMine <= CLEARLY_LOST,
      };
    } else if (terminationCode === 'checkmated') {
      // Look ~3 of my own moves before the mate, not the mate position
      // itself, since evaluating checkmate is trivially always extreme.
      const lookbackPly = Math.max(0, history.length - 7);
      const checkFen = history[lookbackPly]?.after ?? history[0].after;
      const checkResult = await engine.evaluatePosition(checkFen, depth);
      const checkEvalWhite = toWhiteCp(checkResult, sideToMove(checkFen));
      const checkEvalMine = mySide === 'w' ? checkEvalWhite : -checkEvalWhite;

      endingCheck = {
        type: 'checkmated',
        evalBeforeEnd: Math.round(checkEvalMine),
        wasSudden: checkEvalMine > STILL_CLOSE,
      };
    }
  }

  return {
    url: game.url,
    result,
    terminationCode,
    flagged,
    blunders: flagged.filter((f) => f.severity === 'blunder').length,
    mistakes: flagged.filter((f) => f.severity === 'mistake').length,
    turningPoint,
    blownAdvantage,
    endingCheck,
  };
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

  async function worker(engine) {
    while (nextIndex < games.length) {
      if (shouldCancel && shouldCancel()) return;

      const i = nextIndex;
      nextIndex += 1;
      const game = games[i];

      try {
        perGame[i] = await analyzeGameDeep(engine, game, username, { depth, maxPlies });
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
  const blownAdvantages = analyzed.filter((g) => g.blownAdvantage).length;
  const prematureResigns = analyzed.filter(
    (g) => g.endingCheck?.type === 'resigned' && !g.endingCheck.justified
  ).length;
  const suddenMates = analyzed.filter(
    (g) => g.endingCheck?.type === 'checkmated' && g.endingCheck.wasSudden
  ).length;

  const worstTurningPoint =
    analyzed
      .filter((g) => g.turningPoint)
      .sort((a, b) => b.turningPoint.evalSwing - a.turningPoint.evalSwing)[0] || null;

  return {
    perGame: analyzed,
    totalGames: analyzed.length,
    skipped,
    totalBlunders,
    totalMistakes,
    avgBlundersPerGame: analyzed.length > 0 ? totalBlunders / analyzed.length : 0,
    blownAdvantages,
    prematureResigns,
    suddenMates,
    worstTurningPoint: worstTurningPoint
      ? {
          url: worstTurningPoint.url,
          moveNumber: worstTurningPoint.turningPoint.moveNumber,
          san: worstTurningPoint.turningPoint.san,
          phase: worstTurningPoint.turningPoint.phase,
          evalSwing: worstTurningPoint.turningPoint.evalSwing,
        }
      : null,
  };
}