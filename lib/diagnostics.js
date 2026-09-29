import { parsePgnMoves, getOpeningName } from './pgn';

function parseBaseSeconds(timeControl) {
  if (!timeControl || timeControl.includes('/')) return null; // daily/correspondence
  const [base] = timeControl.split('+');
  const seconds = parseInt(base, 10);
  return Number.isFinite(seconds) ? seconds : null;
}

// Scales the "time trouble" cutoff to the game's own clock instead of a
// flat 30 seconds — 30s left is genuinely tight in a 10-minute rapid game,
// but it's most of the game in 1-minute bullet.
export function getTimeTroubleThresholdFor(timeControl) {
  const baseSeconds = parseBaseSeconds(timeControl);
  if (baseSeconds === null) return 30;
  return Math.max(5, Math.min(30, Math.round(baseSeconds * 0.08)));
}

export function buildGameAnalyses(games, username) {
  return games.map((game) => {
    const isWhite = game.white.username.toLowerCase() === username.toLowerCase();
    const mine = isWhite ? game.white : game.black;
    const theirs = isWhite ? game.black : game.white;

    let result;
    if (mine.result === 'win') result = 'win';
    else if (theirs.result === 'win') result = 'loss';
    else result = 'draw';

    const terminationCode = result === 'loss' ? mine.result : theirs.result;

    const moves = parsePgnMoves(game.pgn);
    const mySide = isWhite ? 'white' : 'black';
    const myMoves = moves.filter((m) => m.side === mySide);
    const finalOwnClock = myMoves.length > 0 ? myMoves[myMoves.length - 1].clockSeconds : null;

    const threshold = getTimeTroubleThresholdFor(game.time_control);

    return {
      result,
      terminationCode,
      opening: getOpeningName(game.eco),
      ownRating: mine.rating,
      finalOwnClock,
      wasTimeTrouble: finalOwnClock !== null && finalOwnClock < threshold,
      endTime: game.end_time,
    };
  });
}

export function computeDiagnostics(analyses) {
  const total = analyses.length;
  const wins = analyses.filter((a) => a.result === 'win').length;
  const losses = analyses.filter((a) => a.result === 'loss').length;
  const draws = analyses.filter((a) => a.result === 'draw').length;

  const lossAnalyses = analyses.filter((a) => a.result === 'loss');
  const timeTroubleLosses = lossAnalyses.filter((a) => a.wasTimeTrouble).length;

  const terminationCounts = {};
  for (const a of lossAnalyses) {
    terminationCounts[a.terminationCode] = (terminationCounts[a.terminationCode] || 0) + 1;
  }

  const openingMap = {};
  for (const a of analyses) {
    if (!openingMap[a.opening]) {
      openingMap[a.opening] = { opening: a.opening, win: 0, loss: 0, draw: 0 };
    }
    openingMap[a.opening][a.result] += 1;
  }
  const openingStats = Object.values(openingMap)
    .map((o) => ({
      ...o,
      total: o.win + o.loss + o.draw,
      lossRate: (o.loss + o.draw * 0.5) / (o.win + o.loss + o.draw),
    }))
    .filter((o) => o.total >= 2)
    .sort((a, b) => b.lossRate - a.lossRate || b.total - a.total);

  const chronological = [...analyses].reverse();
  const firstRating = chronological[0]?.ownRating ?? null;
  const lastRating = chronological[chronological.length - 1]?.ownRating ?? null;
  const ratingChange =
    firstRating !== null && lastRating !== null ? lastRating - firstRating : null;

  return {
    total,
    wins,
    losses,
    draws,
    winRate: total > 0 ? wins / total : 0,
    timeTroubleLosses,
    timeTroubleLossRate: losses > 0 ? timeTroubleLosses / losses : 0,
    terminationCounts,
    openingStats,
    ratingChange,
    firstRating,
    lastRating,
  };
}