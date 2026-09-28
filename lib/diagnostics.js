import { parsePgnMoves, getOpeningName } from './pgn';

const TIME_TROUBLE_THRESHOLD_SECONDS = 30;

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

    return {
      result,
      terminationCode,
      opening: getOpeningName(game.eco),
      ownRating: mine.rating,
      finalOwnClock,
      wasTimeTrouble: finalOwnClock !== null && finalOwnClock < TIME_TROUBLE_THRESHOLD_SECONDS,
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

  // Games arrive newest-first, so reverse for a chronological (oldest → newest) trend.
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