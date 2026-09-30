'use client';

import { useState, useRef } from 'react';
import { classifyResult, parsePgnMoves, getOpeningName } from '../lib/pgn';
import { buildGameAnalyses, computeDiagnostics, getTimeTroubleThresholdFor } from '../lib/diagnostics';
import { rankTopIssues } from '../lib/issues';
import { EnginePool } from '../lib/engine';
import { analyzeGamesForBlunders, DEPTH_PRESETS, hashGameUrls } from '../lib/blunders';

const TIME_CLASSES = ['bullet', 'blitz', 'rapid', 'daily'];

function getClassCounts(stats) {
  const counts = {};
  for (const key of TIME_CLASSES) {
    const s = stats[`chess_${key}`];
    counts[key] =
      s && s.record ? (s.record.win || 0) + (s.record.loss || 0) + (s.record.draw || 0) : 0;
  }
  return counts;
}

function getMostPlayedTimeClass(counts) {
  let best = null;
  let bestCount = 0;
  for (const key of TIME_CLASSES) {
    if (counts[key] > bestCount) {
      bestCount = counts[key];
      best = key;
    }
  }
  return best;
}

function analyzeGame(game, username) {
  const isWhite = game.white.username.toLowerCase() === username.toLowerCase();
  const mine = isWhite ? game.white : game.black;
  const theirs = isWhite ? game.black : game.white;

  let result;
  if (mine.result === 'win') result = 'win';
  else if (theirs.result === 'win') result = 'loss';
  else result = 'draw';

  const moves = parsePgnMoves(game.pgn);
  const mySide = isWhite ? 'white' : 'black';
  const myMoves = moves.filter((m) => m.side === mySide);
  const finalOwnClock = myMoves.length > 0 ? myMoves[myMoves.length - 1].clockSeconds : null;

  return {
    result,
    color: mySide,
    opponent: theirs.username,
    opponentRating: theirs.rating,
    terminationLabel: classifyResult(result === 'loss' ? mine.result : theirs.result),
    opening: getOpeningName(game.eco),
    endTime: game.end_time,
    finalOwnClock,
    clockLowThreshold: getTimeTroubleThresholdFor(game.time_control),
  };
}

function formatClock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function ProfileSkeleton() {
  return (
    <div className="profile-card">
      <div className="skeleton skeleton-avatar" />
      <div className="profile-info" style={{ flex: 1 }}>
        <div
          className="skeleton"
          style={{ width: '140px', height: '20px', marginBottom: '8px' }}
        />
        <div
          className="skeleton"
          style={{ width: '100px', height: '14px', marginBottom: '14px' }}
        />
        <div style={{ display: 'flex', gap: '16px' }}>
          <div className="skeleton" style={{ width: '50px', height: '30px' }} />
          <div className="skeleton" style={{ width: '50px', height: '30px' }} />
          <div className="skeleton" style={{ width: '50px', height: '30px' }} />
        </div>
      </div>
    </div>
  );
}

function GamesSkeleton() {
  return (
    <div className="games-section">
      <div className="skeleton" style={{ width: '160px', height: '14px', marginBottom: '8px' }} />
      <div className="games-list">
        {Array.from({ length: 5 }).map((_, i) => (
          <div className="game-row" key={i}>
            <div className="skeleton" style={{ width: '100%', height: '16px' }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function TimeClassPicker({ counts, selected, onSelect, disabled }) {
  return (
    <div className="class-picker">
      {TIME_CLASSES.map((key) => {
        const count = counts[key];
        return (
          <button
            key={key}
            type="button"
            className={`class-chip ${selected === key ? 'class-chip-active' : ''}`}
            disabled={disabled || count === 0}
            onClick={() => onSelect(key)}
          >
            <span className="class-chip-name">{key}</span>
            <span className="class-chip-count">{count.toLocaleString()} games</span>
          </button>
        );
      })}
    </div>
  );
}

const SAMPLE_SIZES = [30, 100, 200];

function SampleSizePicker({ selected, onSelect, disabled }) {
  return (
    <div className="sample-picker">
      <span className="sample-picker-label">Sample size:</span>
      {SAMPLE_SIZES.map((size) => (
        <button
          key={size}
          type="button"
          className={`sample-chip ${selected === size ? 'sample-chip-active' : ''}`}
          disabled={disabled}
          onClick={() => onSelect(size)}
        >
          {size}
        </button>
      ))}
    </div>
  );
}

function getLastPlayedTimestamp(stats, timeClass) {
  const s = stats[`chess_${timeClass}`];
  return s?.last?.date ?? null;
}

const DEPTH_PRESET_KEYS = ['quick', 'standard', 'deep'];

function DepthPresetPicker({ selected, onSelect, disabled }) {
  return (
    <div className="sample-picker">
      <span className="sample-picker-label">Analysis depth:</span>
      {DEPTH_PRESET_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          className={`sample-chip ${selected === key ? 'sample-chip-active' : ''}`}
          disabled={disabled}
          onClick={() => onSelect(key)}
        >
          {DEPTH_PRESETS[key].label}
        </button>
      ))}
    </div>
  );
}

function readAnalysisCache(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function writeAnalysisCache(key, stats) {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), stats }));
  } catch (err) {
    // storage full or unavailable — analysis still works, just won't be cached
  }
}
export default function HomePage() {
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [classCounts, setClassCounts] = useState(null);

  const [gamesLoading, setGamesLoading] = useState(false);
  const [gamesError, setGamesError] = useState(null);
  const [games, setGames] = useState(null);
  const [timeClassUsed, setTimeClassUsed] = useState(null);

  const [engineLoading, setEngineLoading] = useState(false);
  const [engineProgress, setEngineProgress] = useState(null);
  const [engineStats, setEngineStats] = useState(null);

  const [sampleSize, setSampleSize] = useState(30);
  const [fetchProgress, setFetchProgress] = useState(null);

  const [depthPreset, setDepthPreset] = useState('standard');
  const [engineCached, setEngineCached] = useState(false);

  const requestId = useRef(0);
  const loadGamesTimer = useRef(null);

  async function loadGames(uname, timeClass, statsForLastPlayed, count = 30) {
    const myRequest = ++requestId.current;

    setTimeClassUsed(timeClass);
    setGames(null);
    setGamesError(null);
    setEngineStats(null);
    setEngineProgress(null);
    setGamesLoading(true);
    setFetchProgress(null);

    const lastPlayed = statsForLastPlayed
      ? getLastPlayedTimestamp(statsForLastPlayed, timeClass)
      : null;
    const url =
      `/api/games/${encodeURIComponent(uname)}?timeClass=${timeClass}&count=${count}` +
      (lastPlayed ? `&startBefore=${lastPlayed}` : '');

    try {
      const res = await fetch(url);
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        if (myRequest === requestId.current) {
          setGamesError(json.error || 'Could not load games.');
          setGamesLoading(false);
        }
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        if (myRequest !== requestId.current) {
          reader.cancel();
          return;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep the last, possibly incomplete line

        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line);

          if (msg.type === 'progress') {
            if (myRequest === requestId.current) {
              setFetchProgress({
                monthsSearched: msg.monthsSearched,
                gamesFound: msg.gamesFound,
                targetCount: msg.targetCount,
              });
            }
          } else if (msg.type === 'error') {
            if (myRequest === requestId.current) {
              setGamesError(msg.message);
              setGamesLoading(false);
            }
            return;
          } else if (msg.type === 'done') {
            if (myRequest === requestId.current) {
              setGames(msg.games);
              setGamesLoading(false);
              setFetchProgress(null);
            }
            return;
          }
        }
      }
        } catch (err) {
      if (myRequest === requestId.current) {
        setGamesError('Could not reach the server.');
        setGamesLoading(false);
      }
    }
  }

  // Debounces picker changes so clicking two chips in quick succession
  // (e.g. time control, then sample size) fires one fetch, not two.
  function scheduleGamesLoad(nextTimeClass, nextSampleSize) {
    setTimeClassUsed(nextTimeClass);
    setSampleSize(nextSampleSize);

    if (loadGamesTimer.current) clearTimeout(loadGamesTimer.current);
    loadGamesTimer.current = setTimeout(() => {
      loadGames(data.profile.username, nextTimeClass, data.stats, nextSampleSize);
    }, 800);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const uname = username.trim();
    if (!uname) return;

    requestId.current += 1; // abandon anything still in flight
    setLoading(true);
    setError(null);
    setData(null);
    setClassCounts(null);
    setGames(null);
    setGamesError(null);
    setGamesLoading(false);
    setTimeClassUsed(null);
    setEngineStats(null);
    setEngineProgress(null);
    setEngineLoading(false);
    setFetchProgress(null);

    try {
      const res = await fetch(`/api/profile/${encodeURIComponent(uname)}`);
      const json = await res.json();

      if (!res.ok) {
        setError(json.error || 'Something went wrong.');
        setLoading(false);
        return;
      }

      setData(json);
      setLoading(false);

      const counts = getClassCounts(json.stats);
      setClassCounts(counts);

      const best = getMostPlayedTimeClass(counts);
      if (best) {
        await loadGames(json.profile.username, best, json.stats, sampleSize);
      }
    } catch (err) {
      setError('Could not reach the server.');
      setLoading(false);
    }
  }

    async function runDeepAnalysis(forceRerun = false) {
    if (!games || games.length === 0 || !data) return;

    const myRequest = requestId.current;
    const sample = games.slice(0, 6);
    const preset = DEPTH_PRESETS[depthPreset];
    const cacheKey = `sf-cache:${data.profile.username}:${timeClassUsed}:${depthPreset}:${hashGameUrls(
      sample
    )}`;

    if (!forceRerun) {
      const cached = readAnalysisCache(cacheKey);
      if (cached) {
        setEngineStats(cached.stats);
        setEngineCached(true);
        return;
      }
    }

    setEngineLoading(true);
    setEngineStats(null);
    setEngineCached(false);
    setEngineProgress({ current: 0, total: sample.length });

    const poolSize = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));
    const pool = new EnginePool(poolSize, '/engine/stockfish-19-lite-single.js');

    try {
      await pool.ready();

      const stats = await analyzeGamesForBlunders(pool, sample, data.profile.username, {
        depth: preset.depth,
        maxPlies: preset.maxPlies,
        onProgress: (current, total) => setEngineProgress({ current, total }),
        shouldCancel: () => myRequest !== requestId.current,
      });

      if (myRequest === requestId.current) {
        setEngineStats(stats);
        writeAnalysisCache(cacheKey, stats);
      }
    } catch (err) {
      // engine failed to run; leave the stats empty
    } finally {
      pool.terminate();
      if (myRequest === requestId.current) setEngineLoading(false);
    }
  }

  const hasAnyGames = classCounts && Object.values(classCounts).some((n) => n > 0);
  const hasGames = games && games.length > 0;
  const analyses = hasGames && data ? buildGameAnalyses(games, data.profile.username) : null;
  const diagnostics = analyses ? computeDiagnostics(analyses) : null;
  const verdictResult = diagnostics ? rankTopIssues(diagnostics, engineStats, timeClassUsed) : null;
  const topIssues = verdictResult?.issues ?? null;
  const strength = verdictResult?.strength ?? null;

  return (
    <div className="hero">
      <h1>Find out what's actually capping your rating.</h1>
      <p className="subtitle">
        Enter your chess.com username. We'll pull your recent games and tell you
        the 3 fixable things costing you the most rating points.
      </p>
      <form className="search-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="chess.com username"
          className="username-input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <button type="submit" className="analyze-btn" disabled={loading}>
          {loading ? 'Loading…' : 'Analyze'}
        </button>
      </form>

      {error && <p className="error-text">{error}</p>}

      {loading && <ProfileSkeleton />}

      {data && (
        <div className="profile-card">
          {data.profile.avatar ? (
            <img src={data.profile.avatar} alt="" className="avatar" />
          ) : (
            <div className="avatar avatar-fallback">
              {data.profile.username[0].toUpperCase()}
            </div>
          )}
          <div className="profile-info">
            <h2>{data.profile.username}</h2>
            <p className="profile-name">{data.profile.name || ''}</p>
            <div className="rating-grid">
              {data.stats.chess_rapid && (
                <div className="rating-box">
                  <span className="rating-label">Rapid</span>
                  <span className="rating-value">{data.stats.chess_rapid.last.rating}</span>
                </div>
              )}
              {data.stats.chess_blitz && (
                <div className="rating-box">
                  <span className="rating-label">Blitz</span>
                  <span className="rating-value">{data.stats.chess_blitz.last.rating}</span>
                </div>
              )}
              {data.stats.chess_bullet && (
                <div className="rating-box">
                  <span className="rating-label">Bullet</span>
                  <span className="rating-value">{data.stats.chess_bullet.last.rating}</span>
                </div>
              )}
              {data.stats.chess_daily && (
                <div className="rating-box">
                  <span className="rating-label">Daily</span>
                  <span className="rating-value">{data.stats.chess_daily.last.rating}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

            {classCounts &&
        (hasAnyGames ? (
          <>
            <TimeClassPicker
              counts={classCounts}
              selected={timeClassUsed}
              disabled={engineLoading || gamesLoading}
              onSelect={(key) => scheduleGamesLoad(key, sampleSize)}
            />
            <SampleSizePicker
              selected={sampleSize}
              disabled={engineLoading || gamesLoading}
              onSelect={(size) => scheduleGamesLoad(timeClassUsed, size)}
            />
          </>
        ) : (
          <p className="empty-state">No rated games found on this account yet.</p>
        ))}

      {gamesLoading && (
        <>
          <p className="engine-note">
            {fetchProgress
              ? `Checked ${fetchProgress.monthsSearched} month${
                  fetchProgress.monthsSearched === 1 ? '' : 's'
                } — found ${fetchProgress.gamesFound} of ${fetchProgress.targetCount} games so far…`
              : 'Fetching games…'}
          </p>
          <GamesSkeleton />
        </>
      )}

      {gamesError && <p className="error-text">{gamesError}</p>}

      {games && games.length === 0 && (
        <p className="empty-state">
          No recent {timeClassUsed} games found (we look back about two years).
        </p>
      )}

      {topIssues && diagnostics && (
        <div className="verdict-section">
          <h3 className="verdict-heading">
            Your top {topIssues.length === 1 ? 'issue' : 'issues'}
          </h3>
          <p className="verdict-subheading">
            Based on your last {diagnostics.total} {timeClassUsed} games
          </p>
          {diagnostics.total < 10 && (
            <p className="sample-note">
              Small sample ({diagnostics.total} games) — this may shift as you play more.
            </p>
          )}
                    {topIssues.map((issue, idx) => (
            <div className="issue-card" key={issue.id}>
              <div className="issue-number">{idx + 1}</div>
              <div className="issue-body">
                <div className="issue-title-row">
                  <span className="issue-title">{issue.title}</span>
                  <span className={`severity-badge severity-${issue.severity}`}>
                    {issue.severity}
                  </span>
                </div>
                <div className="issue-detail">{issue.detail}</div>
                <div className="issue-fix">
                  <span className="issue-fix-label">Fix:</span>
                  {issue.fix}
                </div>
              </div>
            </div>
          ))}

          {strength && (
            <div className="strength-card">
              <span className="strength-label">✓ Doing well</span>
              <div className="strength-title">{strength.title}</div>
              <div className="strength-detail">{strength.detail}</div>
            </div>
          )}
        </div>
      )}

      {diagnostics && (
        <div className="diagnostics-section">
          <h3 className="games-heading">The numbers behind it</h3>

          <div className="stat-cards">
            <div className="stat-card">
              <span className="stat-label">Record</span>
              <span className="stat-value">
                {diagnostics.wins}W {diagnostics.losses}L {diagnostics.draws}D
              </span>
              <span className="stat-sub">{Math.round(diagnostics.winRate * 100)}% win rate</span>
            </div>

            <div className="stat-card">
              <span className="stat-label">Rating trend (this sample)</span>
              <span className="stat-value">
                {diagnostics.firstRating} → {diagnostics.lastRating}
              </span>
              <span
                className={`stat-sub ${
                  diagnostics.ratingChange > 0
                    ? 'stat-positive'
                    : diagnostics.ratingChange < 0
                    ? 'stat-negative'
                    : ''
                }`}
              >
                {diagnostics.ratingChange > 0 ? '+' : ''}
                {diagnostics.ratingChange}
              </span>
            </div>

            {timeClassUsed !== 'daily' && (
              <div className="stat-card">
                <span className="stat-label">Time trouble losses</span>
                <span className="stat-value">
                  {diagnostics.timeTroubleLosses} / {diagnostics.losses}
                </span>
                <span className="stat-sub">
                  {Math.round(diagnostics.timeTroubleLossRate * 100)}% of losses, clock nearly out
                </span>
              </div>
            )}
          </div>

          <div className="termination-breakdown">
            <span className="games-heading">How losses ended</span>
            <div className="termination-list">
              {Object.entries(diagnostics.terminationCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([code, count]) => (
                  <div className="termination-row" key={code}>
                    <span>{classifyResult(code)}</span>
                    <span className="termination-count">{count}</span>
                  </div>
                ))}
            </div>
          </div>

          <div className="opening-problems">
            <span className="games-heading">Problem openings</span>
            {diagnostics.openingStats.length === 0 ? (
              <p className="subtitle" style={{ fontSize: '14px', marginBottom: 0 }}>
                Not enough repeated openings yet to spot a pattern.
              </p>
            ) : (
              <div className="opening-list">
                {diagnostics.openingStats.slice(0, 3).map((o) => (
                  <div className="opening-row" key={o.opening}>
                    <span className="opening-name">{o.opening}</span>
                    <span className="opening-record">
                      {o.win}W {o.loss}L {o.draw}D
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {hasGames && (
        <div className="deep-analysis-section">
          <h3 className="games-heading">Deep engine analysis</h3>
          <p className="engine-note">
            Runs Stockfish directly in your browser on your {Math.min(games.length, 6)} most
            recent games to find actual blunders, not just outcome patterns. Takes a minute
            or two.
          </p>
          <DepthPresetPicker
            selected={depthPreset}
            disabled={engineLoading}
            onSelect={setDepthPreset}
          />
          <button
            className="secondary-btn"
            style={{ marginTop: '10px' }}
            onClick={() => runDeepAnalysis(false)}
            disabled={engineLoading}
          >
            {engineLoading ? 'Analyzing…' : 'Run deep analysis (Stockfish)'}
          </button>
          {engineLoading && engineProgress && (
            <p className="engine-progress">
              Analyzed {engineProgress.current} of {engineProgress.total} games…
            </p>
          )}
          {engineStats && !engineLoading && (
            <>
              <div className="stat-cards" style={{ marginTop: '16px' }}>
                <div className="stat-card">
                  <span className="stat-label">Games analyzed</span>
                  <span className="stat-value">{engineStats.totalGames}</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Blunders found</span>
                  <span className="stat-value">{engineStats.totalBlunders}</span>
                </div>
                                <div className="stat-card">
                  <span className="stat-label">Avg. blunders / game</span>
                  <span className="stat-value">{engineStats.avgBlundersPerGame.toFixed(1)}</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Blown advantages</span>
                  <span className="stat-value">{engineStats.blownAdvantages}</span>
                </div>
              </div>
              {engineStats.worstTurningPoint && (
                <a
                  className="turning-point-card"
                  href={engineStats.worstTurningPoint.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="turning-point-label">Biggest single moment</span>
                  <span className="turning-point-detail">
                    Move {engineStats.worstTurningPoint.moveNumber}:{' '}
                    {engineStats.worstTurningPoint.san} in the{' '}
                    {engineStats.worstTurningPoint.phase} — a{' '}
                    {engineStats.worstTurningPoint.evalSwing}cp swing. Tap to see the game.
                  </span>
                </a>
              )}
                            {engineStats.skipped > 0 && (
                <p className="engine-note">
                  {engineStats.skipped} game(s) couldn't be read and were skipped.
                </p>
              )}
              {engineCached && (
                <p className="engine-note">
                  Loaded from a saved run.{' '}
                  <button className="link-btn" onClick={() => runDeepAnalysis(true)}>
                    Re-run fresh
                  </button>
                </p>
              )}
            </>
          )}
        </div>
      )}

      {hasGames && (
        <div className="games-section">
          <h3 className="games-heading">
            Last {games.length} {timeClassUsed} games
          </h3>
          <div className="games-list">
            {games.map((game) => {
              const g = analyzeGame(game, data.profile.username);
              return (
                <div className="game-row" key={game.url}>
                  <div className="game-row-top">
                    <span className={`result-badge result-${g.result}`}>
                      {g.result === 'win' ? 'W' : g.result === 'loss' ? 'L' : 'D'}
                    </span>
                    <span className="game-opponent">
                      vs {g.opponent} ({g.opponentRating})
                    </span>
                    <span className="game-date">
                      {new Date(g.endTime * 1000).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="game-row-bottom">
                    <span className="game-opening">{g.opening}</span>
                    {g.finalOwnClock !== null && (
                      <span
                        className={`clock-badge ${
                          g.finalOwnClock < g.clockLowThreshold ? 'clock-low' : ''
                        }`}
                      >
                        ⏱ {formatClock(g.finalOwnClock)} left
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}