import { getTimeTroubleThresholdFor } from './diagnostics';

const SEVERITY_WEIGHT = { blunder: 2, mistake: 1 };

function collectFlags(perGame) {
  const flags = [];
  for (const g of perGame) {
    const threshold = getTimeTroubleThresholdFor(g.timeControl);
    for (const f of g.flagged) {
      flags.push({
        ...f,
        gameUrl: g.url,
        lowClock: f.clockRemaining !== null ? f.clockRemaining < threshold * 2 : null,
      });
    }
  }
  return flags;
}

function weightedCount(flags) {
  return flags.reduce((sum, f) => sum + (SEVERITY_WEIGHT[f.severity] || 1), 0);
}

const PHASE_NAMES = {
  opening: { name: 'Opening Jitters', desc: 'opening' },
  middlegame: { name: 'Middlegame Collapse', desc: 'middlegame' },
  endgame: { name: 'Endgame Fade', desc: 'endgame' },
};

function findPhasePattern(flags) {
  if (flags.length < 4) return null;

  const totalWeight = weightedCount(flags);
  const byPhase = { opening: [], middlegame: [], endgame: [] };
  for (const f of flags) byPhase[f.phase]?.push(f);

  let worstPhase = null;
  let worstShare = 0;
  for (const phase of Object.keys(byPhase)) {
    const share = weightedCount(byPhase[phase]) / totalWeight;
    if (share > worstShare) {
      worstShare = share;
      worstPhase = phase;
    }
  }

  if (!worstPhase || worstShare < 0.5) return null; // no phase clearly dominates

  const info = PHASE_NAMES[worstPhase];

  return {
    id: 'phase-pattern',
    name: info.name,
    score: worstShare * 100,
    description: `${byPhase[worstPhase].length} of your ${flags.length} flagged moves (${Math.round(
      worstShare * 100
    )}% weighted) happened in the ${info.desc}, more than any other phase.`,
    examples: byPhase[worstPhase].slice(0, 3).map((f) => ({
      gameUrl: f.gameUrl,
      moveNumber: f.moveNumber,
      san: f.san,
      severity: f.severity,
    })),
  };
}

function findClockDrainPattern(flags) {
  const withClock = flags.filter((f) => f.lowClock !== null);
  if (withClock.length < 4) return null;

  const lowClockFlags = withClock.filter((f) => f.lowClock);
  const share = weightedCount(lowClockFlags) / weightedCount(withClock);
  if (share < 0.5) return null;

  return {
    id: 'clock-drain',
    name: 'Clock Drain',
    score: share * 100,
    description: `${lowClockFlags.length} of your ${withClock.length} flagged moves with clock data (${Math.round(
      share * 100
    )}% weighted) happened once your clock was already running low.`,
    examples: lowClockFlags.slice(0, 3).map((f) => ({
      gameUrl: f.gameUrl,
      moveNumber: f.moveNumber,
      san: f.san,
      severity: f.severity,
    })),
  };
}

function findRepeatedBlunderPattern(flags) {
  const blunders = flags.filter((f) => f.severity === 'blunder');
  if (blunders.length < 3) return null;

  // Same move (by SAN, e.g. "Qxd5") blundered in more than one game is a
  // concrete, checkable habit rather than a vague statistical lean.
  const bySan = {};
  for (const f of blunders) {
    bySan[f.san] = (bySan[f.san] || []).concat(f);
  }
  const repeated = Object.entries(bySan)
    .filter(([, list]) => list.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)[0];

  if (!repeated) return null;

  const [san, list] = repeated;
  return {
    id: 'repeated-blunder',
    name: 'Repeat Offender',
    score: Math.min(100, list.length * 30),
    description: `The move ${san} was a blunder in ${list.length} separate games — worth learning what makes that move look tempting and isn't.`,
    examples: list.slice(0, 3).map((f) => ({
      gameUrl: f.gameUrl,
      moveNumber: f.moveNumber,
      san: f.san,
      severity: f.severity,
    })),
  };
}

export function findPatterns(perGame) {
  const flags = collectFlags(perGame);

  return [
    findClockDrainPattern(flags),
    findPhasePattern(flags),
    findRepeatedBlunderPattern(flags),
  ]
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}