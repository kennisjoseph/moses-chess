import { chessComHeaders } from '../../../../lib/chesscom';

const ALLOWED_CLASSES = ['bullet', 'blitz', 'rapid', 'daily'];
const MAX_MONTHS_TO_SEARCH = 36;

function monthKey(date) {
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function GET(request, { params }) {
  const { username } = await params;
  const { searchParams } = new URL(request.url);
  const timeClass = searchParams.get('timeClass') || 'rapid';
  const count = Math.min(Number(searchParams.get('count')) || 30, 200);
  const startBefore = searchParams.get('startBefore'); // unix seconds, optional

  if (!ALLOWED_CLASSES.includes(timeClass)) {
    return Response.json({ error: 'Unknown time control.' }, { status: 400 });
  }

  const headers = chessComHeaders();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(obj) {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      }

      try {
        const archivesRes = await fetch(
          `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`,
          { headers }
        );

        if (archivesRes.status === 429) {
          send({ type: 'error', message: 'Chess.com is asking us to slow down. Wait a minute and try again.' });
          controller.close();
          return;
        }
        if (!archivesRes.ok) {
          send({ type: 'error', message: 'Could not load game archives.' });
          controller.close();
          return;
        }

        const { archives } = await archivesRes.json();
        if (!archives || archives.length === 0) {
          send({ type: 'done', games: [], monthsSearched: 0, exhaustedArchive: true });
          controller.close();
          return;
        }

        // If we know this account's last game in this specific time class,
        // jump straight to that month instead of walking through recent
        // months we already know are empty for this class.
        let startIndex = archives.length - 1;
        if (startBefore) {
          const cutoffKey = monthKey(new Date(Number(startBefore) * 1000));
          const foundIndex = archives.findIndex((url) => {
            const parts = url.split('/');
            return `${parts[parts.length - 2]}/${parts[parts.length - 1]}` === cutoffKey;
          });
          if (foundIndex !== -1) startIndex = foundIndex;
        }

        const collected = [];
        let monthsSearched = 0;
        let exhaustedArchive = false;
        let rateLimited = false;

        for (let i = startIndex; i >= 0 && collected.length < count; i--) {
          if (monthsSearched >= MAX_MONTHS_TO_SEARCH) break;
          monthsSearched += 1;

          try {
            const monthRes = await fetch(archives[i], { headers });

            if (monthRes.status === 429) {
              rateLimited = true;
              break;
            }
            if (!monthRes.ok) continue;

            const { games } = await monthRes.json();

            for (let j = games.length - 1; j >= 0 && collected.length < count; j--) {
              const g = games[j];
              if (
                g.time_class === timeClass &&
                g.rules === 'chess' &&
                g.pgn &&
                g.white &&
                g.black
              ) {
                collected.push(g);
              }
            }
          } catch (monthErr) {
            continue; // one bad month shouldn't sink the whole request
          }

          if (i === 0) exhaustedArchive = true;
          send({ type: 'progress', monthsSearched, gamesFound: collected.length, targetCount: count });
        }

        if (rateLimited && collected.length === 0) {
          send({ type: 'error', message: 'Chess.com is asking us to slow down. Wait a minute and try again.' });
        } else {
          send({ type: 'done', games: collected, monthsSearched, exhaustedArchive });
        }
        controller.close();
      } catch (err) {
        send({ type: 'error', message: 'Something went wrong reaching chess.com.' });
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } });
}