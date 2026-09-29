const MIN_OPENING_GAMES = 3;

// "Normal" baseline rates by time control — scores measure how far *above*
// this baseline an account is, not the raw rate. Bullet naturally runs
// hotter on both of these than rapid does.
const TIME_TROUBLE_BASELINE = { bullet: 0.45, blitz: 0.2, default: 0.1 };
const MATE_BASELINE = { bullet: 0.5, blitz: 0.4, default: 0.3 };

function baselineFor(map, timeClass) {
  return map[timeClass] ?? map.default;
}

function severityFromScore(score) {
  if (score >= 45) return 'major';
  if (score >= 20) return 'moderate';
  return 'minor';
}

function scoreTimeManagement(diagnostics, timeClass) {
  if (diagnostics.losses === 0) return null;

  const baseline = baselineFor(TIME_TROUBLE_BASELINE, timeClass);
  const rate = diagnostics.timeTroubleLossRate;
  const score = Math.max(0, Math.min(100, ((rate - baseline) / (1 - baseline)) * 100));
  const timeoutCount = diagnostics.terminationCounts.timeout || 0;

  return {
    id: 'time-management',
    score,
    title: 'Time management',
    detail:
      `${diagnostics.timeTroubleLosses} of your ${diagnostics.losses} losses ` +
      `(${Math.round(rate * 100)}%) happened with very little time left` +
      (timeoutCount > 0 ? `, and ${timeoutCount} ended in an outright time forfeit.` : '.'),
    fix: 'When your clock gets low, play the first safe legal move you see instead of hunting for the best one. A time forfeit throws away a position you may well have been winning — practice moving faster earlier in the game so you bank time for the moments that actually need it.',
    strengthDetail: `You rarely run into time trouble — only ${Math.round(rate * 100)}% of losses happened with the clock low.`,
  };
}

function scoreWorstOpening(diagnostics) {
  const candidates = diagnostics.openingStats.filter((o) => o.total >= MIN_OPENING_GAMES);
  if (candidates.length === 0) return null;

  const worst = candidates[0]; // openingStats is already sorted worst-first
  const confidence = Math.min(1, worst.total / 6); // dampen small samples
  const score = Math.min(100, worst.lossRate * 100 * confidence);

  return {
    id: 'worst-opening',
    score,
    title: `Results in the ${worst.opening}`,
    detail: `You're ${worst.win}W–${worst.loss}L–${worst.draw}D in this line over your recent games — a ${Math.round(
      worst.lossRate * 100
    )}% loss rate against your overall ${Math.round(diagnostics.winRate * 100)}% win rate.`,
    fix: 'Either study this specific line 10-15 moves deep so you actually know the resulting plans, or sidestep it with a different response until you have time to prepare it properly. Repeating a losing line without reviewing why it loses just repeats the loss.',
    strengthDetail: null,
  };
}

function scoreTermination(diagnostics, timeClass, engineStats) {
  if (diagnostics.losses < 4) return null;

  const mateCount = diagnostics.terminationCounts.checkmated || 0;
  const mateShare = mateCount / diagnostics.losses;
  const baseline = baselineFor(MATE_BASELINE, timeClass);
  const score = Math.max(0, ((mateShare - baseline) / (1 - baseline)) * 100);

  if (score <= 0) {
    return {
      id: 'checkmate-pattern',
      score: 0,
      title: 'Games ending in checkmate',
      detail: null,
      fix: null,
      strengthDetail: `Your losses rarely end in checkmate (${Math.round(
        mateShare * 100
      )}%) — you're good at recognizing when a position is gone.`,
    };
  }

  let corroboration = '';
  if (engineStats && engineStats.totalGames > 0) {
    corroboration = ` Across the games we ran deep analysis on, you averaged ${engineStats.avgBlundersPerGame.toFixed(
      1
    )} blunders per game, which lines up with this.`;
  }

  return {
    id: 'checkmate-pattern',
    score,
    title: 'Games ending in checkmate',
    detail: `${mateCount} of your ${diagnostics.losses} losses (${Math.round(
      mateShare * 100
    )}%) ended in checkmate rather than resignation or time.${corroboration}`,
    fix: "This isn't automatically a mistake — some players deliberately play on for endgame practice instead of resigning. If that's not a deliberate choice, it usually points to king safety being neglected in the middlegame, or mating nets being spotted too late. Running deep analysis on a few of these games will show whether they were genuinely lost early or decided by one late slip.",
    strengthDetail: null,
  };
}

function scoreRatingTrend(diagnostics) {
  if (diagnostics.ratingChange === null) return null;

  if (diagnostics.ratingChange >= 0) {
    return {
      id: 'rating-trend',
      score: 0,
      title: 'Rating trend',
      detail: null,
      fix: null,
      strengthDetail: `Your rating is trending up across this sample: ${diagnostics.firstRating} → ${diagnostics.lastRating} (+${diagnostics.ratingChange}).`,
    };
  }

  const drop = -diagnostics.ratingChange;
  return {
    id: 'rating-trend',
    score: Math.min(100, drop),
    title: 'Rating trend',
    detail: `You went from ${diagnostics.firstRating} to ${diagnostics.lastRating} over these ${diagnostics.total} games, a drop of ${drop} points.`,
    fix: 'A downward stretch is often tilt-driven — a loss or two leading to faster, worse decisions right after. If you drop two in a row, it is worth ending the session there instead of pushing for a third.',
    strengthDetail: null,
  };
}

function scoreEngineBlunders(engineStats) {
  if (!engineStats || engineStats.totalGames === 0) return null;

  const score = Math.min(100, (engineStats.avgBlundersPerGame / 2) * 100);

  return {
    id: 'engine-blunders',
    score,
    title: 'Blunder rate (engine-checked)',
    detail: `Across the ${engineStats.totalGames} games we ran engine analysis on, you made ${engineStats.totalBlunders} outright blunders (300+ centipawn swings) and ${engineStats.totalMistakes} smaller mistakes — averaging ${engineStats.avgBlundersPerGame.toFixed(
      1
    )} blunders per game.`,
    fix: "Before playing a move, do a final safety check: is anything I'm about to move, or leave behind, hanging to a capture? This single habit eliminates most blunders at every level below master.",
    strengthDetail: `Your engine-checked blunder rate is low — averaging ${engineStats.avgBlundersPerGame.toFixed(
      1
    )} per game.`,
  };
}

function scoreColorImbalance(diagnostics) {
  const { white, black } = diagnostics.colorStats;
  if (white.total < 5 || black.total < 5) return null;

  const gap = Math.abs(white.winRate - black.winRate);
  const score = Math.min(100, (gap / 0.4) * 100);
  const weakerSide = white.winRate < black.winRate ? 'White' : 'Black';
  const weakerStats = weakerSide === 'White' ? white : black;
  const strongerStats = weakerSide === 'White' ? black : white;

  return {
    id: 'color-imbalance',
    score,
    title: `Results as ${weakerSide}`,
    detail: `You're winning ${Math.round(weakerStats.winRate * 100)}% of games as ${weakerSide}, versus ${Math.round(
      strongerStats.winRate * 100
    )}% with the other color — a ${Math.round(gap * 100)}-point gap.`,
    fix: `This usually points to a repertoire gap as ${weakerSide} specifically. Check the problem-openings list above filtered to games where you played ${weakerSide}.`,
    strengthDetail: `Your results are balanced between colors — within ${Math.round(gap * 100)} points either way.`,
  };
}

function scoreEarlyLosses(diagnostics) {
  if (diagnostics.losses < 3) return null;

  const baseline = 0.15;
  const score = Math.max(
    0,
    Math.min(100, ((diagnostics.earlyLossRate - baseline) / (1 - baseline)) * 100)
  );

  return {
    id: 'early-losses',
    score,
    title: 'Early losses',
    detail: `${diagnostics.earlyLosses} of your ${diagnostics.losses} losses (${Math.round(
      diagnostics.earlyLossRate * 100
    )}%) ended within the first 10 moves.`,
    fix: 'These are worth reviewing individually rather than as a pattern — an early loss is almost always one specific identifiable mistake, like an opening trap. A few minutes per game on the games list above goes a long way.',
    strengthDetail: 'Very few of your losses happen early — most of your games at least reach a real middlegame.',
  };
}

export function rankTopIssues(diagnostics, engineStats = null, timeClass = null) {
  const raw = [
    scoreTimeManagement(diagnostics, timeClass),
    scoreWorstOpening(diagnostics),
    scoreTermination(diagnostics, timeClass, engineStats),
    scoreRatingTrend(diagnostics),
    scoreEngineBlunders(engineStats),
    scoreColorImbalance(diagnostics),
    scoreEarlyLosses(diagnostics),
  ].filter(Boolean);

  const issueCandidates = raw.filter((c) => c.detail);
  const strengthCandidates = raw.filter((c) => c.strengthDetail);

  if (issueCandidates.length === 0) {
    return {
      issues: [
        {
          id: 'no-data',
          severity: 'minor',
          title: 'Not enough data yet',
          detail: `Only ${diagnostics.total} games in this sample — play a few more for a real read.`,
          fix: 'Come back once you have a bigger batch of games and the picture will sharpen up.',
        },
      ],
      strength: null,
    };
  }

  const sorted = [...issueCandidates].sort((a, b) => b.score - a.score);
  const issues = sorted.slice(0, 3).map((c) => ({
    id: c.id,
    severity: severityFromScore(c.score),
    title: c.title,
    detail: c.detail,
    fix: c.fix,
  }));

  const strengthCandidate =
    strengthCandidates.length > 0
      ? [...strengthCandidates].sort((a, b) => a.score - b.score)[0]
      : null;

  return {
    issues,
    strength: strengthCandidate
      ? { title: strengthCandidate.title, detail: strengthCandidate.strengthDetail }
      : null,
  };
}