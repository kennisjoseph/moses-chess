'use client';

import { useState } from 'react';
import { StockfishEngine } from '../../lib/engine';
import { findBlundersInGame } from '../../lib/blunders';

export default function EngineTestPage() {
  const [log, setLog] = useState([]);
  const [status, setStatus] = useState('idle');

  function addLog(line) {
    setLog((prev) => [...prev, line]);
  }

  async function runTest() {
    setStatus('running');
    setLog([]);

    const engine = new StockfishEngine('/engine/stockfish-19-lite-single.js');
    await engine.ready;
    addLog('Engine ready.');

    // Swap in your own username here:
    const res = await fetch('/api/games/kennisjoseph?timeClass=rapid&count=1');
    const { games } = await res.json();

    if (!games || games.length === 0) {
      addLog('No games found.');
      engine.terminate();
      setStatus('done');
      return;
    }

    addLog(`Analyzing: ${games[0].white.username} vs ${games[0].black.username}`);

    const blunders = await findBlundersInGame(engine, games[0].pgn, {
      depth: 10,
      maxPlies: 40,
    });

    if (blunders.length === 0) {
      addLog('No blunders/mistakes found in the first 40 plies.');
    } else {
      blunders.forEach((b) => {
        addLog(
          `Move ${b.moveNumber} (${b.side === 'w' ? 'White' : 'Black'}): ${b.san} — ${b.severity} (${b.evalSwing}cp swing)`
        );
      });
    }

    engine.terminate();
    setStatus('done');
  }

  return (
    <div style={{ padding: 24 }}>
      <button
        onClick={runTest}
        disabled={status === 'running'}
        style={{
          padding: '10px 20px',
          background: '#81b64c',
          border: 'none',
          borderRadius: 6,
          color: '#17210d',
          fontWeight: 700,
          marginBottom: 16,
          cursor: 'pointer',
        }}
      >
        {status === 'running' ? 'Running…' : 'Run blunder test'}
      </button>
      <pre style={{ color: '#eee', whiteSpace: 'pre-wrap' }}>{log.join('\n')}</pre>
    </div>
  );
}