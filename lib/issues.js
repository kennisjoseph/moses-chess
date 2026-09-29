const MIN_OPENING_GAMES = 3;
const OPENING_LOSS_RATE_THRESHOLD = 0.6;
const RESIGN_SHARE_THRESHOLD = 0.5;
const BLUNDER_RATE_THRESHOLD = 0.4;

// Bullet games naturally end with a near-empty clock and see more checkmates
// than slower time controls — that's normal bullet chess, not necessarily a
// leak. Require a stronger signal before calling it out specifically there.
const TIME_TROUBLE_LOSS_RATE_THRESHOLD = { bullet: 0.45, default: 0.25 };
const CHECKMATE_SHARE_THRESHOLD = { bullet: 0.55, default: 0.35 };

function thresholdFor(map, timeClass) {
  return map[timeClass] ?? map.default;
}

export function rankTopIssues(diagnostics, engineStats = null, timeClass = null) {
  const candidates = [];

  // 1. Time management
  if (diagnostics.losses > 0) {
    const shareOfLosses = diagnostics.timeTroubleLossRate;
    const shareOfAllGames = diagnostics.timeTroubleLosses / diagnostics.total;
    const timeoutCount = diagnostics.terminationCounts.timeout || 0;
    const threshold = thresholdFor(TIME_TROUBLE_LOSS_RATE_THRESHOLD, timeClass);

    if (shareOfLosses >= threshold && diagnostics.timeTroubleLosses >= 2) {
      candidates.push({
        id: 'time-management',
        title: 'You are losing games on the clock, not the board',
        score: shareOfAllGames * 100 + timeoutCount * 2,
        detail:
          `${diagnostics.timeTroubleLosses} of your ${diagnostics.losses} losses ` +
          `(${Math.round(shareOfLosses * 100)}%) happened with very little time left` +
          (timeoutCount > 0 ? `, and ${timeoutCount} ended in an outright time forfeit.` : '.'),
        fix: 'When your clock gets low, play the first safe legal move you see instead of hunting for the best one. A time forfeit throws away a position you may well have been winning — practice moving faster earlier in the game so you bank time for the moments that actually need it.',
      });
    }
  }

  // 2. Problem openings (up to 2)
  const problemOpenings = diagnostics.openingStats.filter(
    (o) => o.total >= MIN_OPENING_GAMES && o.lossRate >= OPENING_LOSS_RATE_THRESHOLD
  );

  problemOpenings.slice(0, 2).forEach((o, idx) => {
    candidates.push({
      id: `opening-${idx}`,
      title: `Your results in the ${o.opening} are dragging your rating down`,
      score: o.lossRate * 100 + o.total * 3,
      detail: `You're ${o.win}W–${o.loss}L–${o.draw}D in this line over your recent games — a ${Math.round(
        o.lossRate * 100
      )}% loss rate against your overall ${Math.round(diagnostics.winRate * 100)}% win rate.`,
      fix: 'Either study this specific line 10-15 moves deep so you actually know the resulting plans, or sidestep it with a different response until you have time to prepare it properly. Repeating a losing line without reviewing why it loses just repeats the loss.',
    });
  });

  // 3. Termination pattern
  if (diagnostics.losses >= 4) {
    const resignCount = diagnostics.terminationCounts.resigned || 0;
    const mateCount = diagnostics.terminationCounts.checkmated || 0;
    const resignShare = resignCount / diagnostics.losses;
    const mateShare = mateCount / diagnostics.losses;
    const mateThreshold = thresholdFor(CHECKMATE_SHARE_THRESHOLD, timeClass);

    if (mateShare >= mateThreshold) {
      candidates.push({
        id: 'checkmate-pattern',
        title: 'You are getting checkmated more than expected',
        score: mateShare * 80,
        detail: `${mateCount} of your ${diagnostics.losses} losses (${Math.round(
          mateShare * 100
        )}%) ended in checkmate rather than resignation or time.`,
        fix: 'This usually means king safety is being neglected in the middlegame, or mating nets are being spotted too late. After a loss like this, spend two minutes rewinding to the move where your king safety first cracked.',
      });
    } else if (resignShare >= RESIGN_SHARE_THRESHOLD) {
      candidates.push({
        id: 'resign-pattern',
        title: 'You resign the large majority of your lost games',
        score: resignShare * 40,
        detail: `${resignCount} of your ${diagnostics.losses} losses (${Math.round(
          resignShare * 100
        )}%) ended in resignation.`,
        fix: "Worth checking a few of these positions again after the game — it's common to resign positions that were still fighting, especially against opponents who may not convert cleanly. Play on longer in genuinely unclear spots.",
      });
    }
  }

  // 4. Rating trend fallback
  if (diagnostics.ratingChange !== null && diagnostics.ratingChange < 0) {
    candidates.push({
      id: 'rating-trend',
      title: 'Your rating has been trending down across this sample',
      score: Math.min(Math.abs(diagnostics.ratingChange), 60),
      detail: `You went from ${diagnostics.firstRating} to ${diagnostics.lastRating} over these ${diagnostics.total} games, a drop of ${Math.abs(
        diagnostics.ratingChange
      )} points.`,
      fix: 'A downward stretch is often tilt-driven — a loss or two leading to faster, worse decisions right after. If you drop two in a row, it is worth ending the session there instead of pushing for a third.',
    });
  }

  // 5. Engine-detected blunder rate (only present once deep analysis has run)
  if (engineStats && engineStats.totalGames > 0 && engineStats.avgBlundersPerGame >= BLUNDER_RATE_THRESHOLD) {
    candidates.push({
      id: 'engine-blunders',
      title: 'You are blundering material at a high rate',
      score: engineStats.avgBlundersPerGame * 120 + engineStats.totalMistakes * 3,
      detail: `Across the ${engineStats.totalGames} games we ran engine analysis on, you made ${engineStats.totalBlunders} outright blunders (300+ centipawn swings) and ${engineStats.totalMistakes} smaller mistakes — averaging ${engineStats.avgBlundersPerGame.toFixed(
        1
      )} blunders per game.`,
      fix: 'Before playing a move, do a final safety check: is anything I\'m about to move, or leave behind, hanging to a capture? This single habit eliminates most blunders at every level below master.',
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, 3);

  if (top.length === 0) {
    return [
      {
        id: 'no-clear-issue',
        title: 'Nothing glaring in this sample',
        detail: `Across your last ${diagnostics.total} games you're ${diagnostics.wins}W-${diagnostics.losses}L-${diagnostics.draws}D with no strong recurring pattern in time, openings, or how games ended.`,
        fix: 'Worth analyzing a larger sample, or these games are simply a solid run. Check back after your next batch for emerging patterns.',
      },
    ];
  }

  return top;
}