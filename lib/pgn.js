export function parsePgnMoves(pgn) {
  if (!pgn) return [];

  // PGN headers end with a blank line before the movetext starts.
  const separatorIndex = pgn.indexOf('\n\n');
  const moveText = separatorIndex !== -1 ? pgn.slice(separatorIndex + 2) : pgn;

  const clockPattern = /(\S+)\s*\{\[%clk\s+([0-9:.]+)\]\}/g;
  const moves = [];
  let match;
  let ply = 0;

  while ((match = clockPattern.exec(moveText)) !== null) {
    ply += 1;
    moves.push({
      ply,
      side: ply % 2 === 1 ? 'white' : 'black',
      san: match[1],
      clockSeconds: parseClockToSeconds(match[2]),
    });
  }

  return moves;
}

function parseClockToSeconds(clockStr) {
  const parts = clockStr.split(':').map(Number);
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return m * 60 + s;
  }
  return Number(clockStr) || 0;
}

export function getOpeningName(ecoUrl) {
  if (!ecoUrl) return 'Unknown opening';
  const slug = ecoUrl.split('/').pop();
  if (!slug) return 'Unknown opening';
  return decodeURIComponent(slug).replace(/-/g, ' ');
}

const RESULT_LABELS = {
  win: 'Win',
  checkmated: 'Checkmated',
  agreed: 'Draw agreed',
  repetition: 'Draw by repetition',
  timeout: 'Lost on time',
  resigned: 'Resigned',
  stalemate: 'Draw by stalemate',
  lose: 'Lost',
  insufficient: 'Draw (insufficient material)',
  '50move': 'Draw (50-move rule)',
  abandoned: 'Abandoned',
  timevsinsufficient: 'Draw (time vs insufficient material)',
  kingofthehill: 'King of the hill',
  threecheck: 'Three-check',
  bughousepartnerlose: 'Bughouse partner lost',
};

export function classifyResult(resultCode) {
  return RESULT_LABELS[resultCode] || resultCode;
}