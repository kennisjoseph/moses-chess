const SEVERITY_COLORS = {
  major: { bar: '#8b3a3a', text: '#ff9b9b' },
  moderate: { bar: 'rgba(224,179,77,0.25)', text: '#e0b34d' },
  minor: { bar: 'rgba(255,255,255,0.1)', text: 'rgba(255,255,255,0.6)' },
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line + word + ' ';
    if (ctx.measureText(test).width > maxWidth && line !== '') {
      lines.push(line.trim());
      line = word + ' ';
      if (lines.length === maxLines - 1) break;
    } else {
      line = test;
    }
  }
  if (line.trim()) lines.push(line.trim());
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/\s*\S*$/, '') + '…';
  }
  return lines;
}

function drawWrapped(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const lines = wrapLines(ctx, text, maxWidth, maxLines);
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
  return y + lines.length * lineHeight;
}

function drawWatermark(ctx) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  ctx.font = '260px -apple-system, sans-serif';
  ctx.fillText('♞', 760, 260);
  ctx.font = '180px -apple-system, sans-serif';
  ctx.fillText('♟', 1000, 560);
  ctx.restore();
}

export function generateShareCardDataUrl({
  username,
  diagnostics,
  topIssue,
  strength,
  pattern,
  timeClass,
  siteUrl = 'https://moses-chess.vercel.app/',
}) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext('2d');
  const font = (size, weight = 'normal') =>
    `${weight} ${size}px -apple-system, "Segoe UI", Roboto, sans-serif`;

  // Base + watermark
  ctx.fillStyle = '#312e2b';
  ctx.fillRect(0, 0, 1200, 630);
  drawWatermark(ctx);

  // Header bar
  ctx.fillStyle = '#262421';
  ctx.fillRect(0, 0, 1200, 90);
  ctx.fillStyle = '#81b64c';
  ctx.font = font(30, 'bold');
  ctx.fillText('Moses Chess', 40, 57);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = font(16);
  ctx.textAlign = 'right';
  ctx.fillText('Multi-game chess.com analysis', 1160, 53);
  ctx.textAlign = 'left';

  // Avatar badge + username
  ctx.fillStyle = '#81b64c';
  ctx.beginPath();
  ctx.arc(76, 160, 38, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#17210d';
  ctx.font = font(38, 'bold');
  ctx.textAlign = 'center';
  ctx.fillText(username[0].toUpperCase(), 76, 173);
  ctx.textAlign = 'left';

  ctx.fillStyle = '#ffffff';
  ctx.font = font(42, 'bold');
  ctx.fillText(username, 132, 155);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = font(20);
  ctx.fillText(`${timeClass} · ${diagnostics.total} games analyzed`, 132, 188);

  // Record line
  ctx.fillStyle = '#81b64c';
  ctx.font = font(24, 'bold');
  ctx.fillText(
    `${diagnostics.wins}W ${diagnostics.losses}L ${diagnostics.draws}D  ·  ${Math.round(
      diagnostics.winRate * 100
    )}% win rate`,
    40,
    240
  );

  // Win/loss/draw bar
  const barX = 40;
  const barY = 258;
  const barW = 1120;
  const barH = 22;
  const total = Math.max(1, diagnostics.total);
  const winW = (diagnostics.wins / total) * barW;
  const drawW = (diagnostics.draws / total) * barW;
  const lossW = (diagnostics.losses / total) * barW;
  ctx.fillStyle = '#81b64c';
  ctx.fillRect(barX, barY, winW, barH);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(barX + winW, barY, drawW, barH);
  ctx.fillStyle = '#8b3a3a';
  ctx.fillRect(barX + winW + drawW, barY, lossW, barH);

  // Top issue card
  const sev = SEVERITY_COLORS[topIssue.severity] || SEVERITY_COLORS.minor;
  ctx.fillStyle = '#262421';
  roundRect(ctx, 40, 312, 1120, 160, 12);
  ctx.fill();
  ctx.fillStyle = '#81b64c';
  ctx.fillRect(40, 312, 6, 160);

  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = font(15, 'bold');
  ctx.fillText('TOP ISSUE', 66, 344);

  ctx.fillStyle = sev.bar;
  const badgeText = topIssue.severity.toUpperCase();
  ctx.font = font(13, 'bold');
  const badgeW = ctx.measureText(badgeText).width + 24;
  roundRect(ctx, 1120 - badgeW, 325, badgeW, 26, 13);
  ctx.fill();
  ctx.fillStyle = sev.text;
  ctx.fillText(badgeText, 1120 - badgeW + 12, 343);

  ctx.fillStyle = '#ffffff';
  ctx.font = font(28, 'bold');
  ctx.fillText(topIssue.title, 66, 378);

  if (topIssue.detail) {
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = font(18);
    drawWrapped(ctx, topIssue.detail, 66, 412, 1060, 25, 2);
  }

  // Pattern card, falling back to strength so this section is never empty
  if (pattern) {
    ctx.fillStyle = 'rgba(129,182,76,0.1)';
    roundRect(ctx, 40, 494, 1120, 110, 12);
    ctx.fill();
    ctx.fillStyle = '#81b64c';
    ctx.font = font(15, 'bold');
    ctx.fillText('PATTERN FOUND', 66, 526);
    ctx.fillStyle = '#ffffff';
    ctx.font = font(24, 'bold');
    ctx.fillText(pattern.name, 66, 555);
    if (pattern.description) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = font(15);
      drawWrapped(ctx, pattern.description, 66, 580, 1060, 20, 1);
    }
  } else if (strength) {
    ctx.fillStyle = 'rgba(129,182,76,0.1)';
    roundRect(ctx, 40, 494, 1120, 110, 12);
    ctx.fill();
    ctx.fillStyle = '#81b64c';
    ctx.font = font(15, 'bold');
    ctx.fillText('✓ DOING WELL', 66, 526);
    ctx.fillStyle = '#ffffff';
    ctx.font = font(24, 'bold');
    ctx.fillText(strength.title, 66, 555);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = font(15);
    drawWrapped(ctx, strength.detail, 66, 580, 1060, 20, 1);
  }

  // Footer bar
  ctx.fillStyle = '#81b64c';
  ctx.fillRect(0, 592, 1200, 38);
  ctx.fillStyle = '#17210d';
  ctx.font = font(18, 'bold');
  ctx.fillText(`Find your patterns at ${siteUrl}`, 40, 617);

  return canvas.toDataURL('image/png');
}