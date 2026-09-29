import { chessComHeaders } from '../../../../lib/chesscom';

const ALLOWED_CLASSES = ['bullet', 'blitz', 'rapid', 'daily'];
const MAX_MONTHS_TO_SEARCH = 24; // don't dig back more than ~2 years

export async function GET(request, { params }) {
  const startedAt = Date.now();
  const { username } = await params;
  const { searchParams } = new URL(request.url);
  const timeClass = searchParams.get('timeClass') || 'rapid';
  const count = Math.min(Number(searchParams.get('count')) || 30, 100);

  if (!ALLOWED_CLASSES.includes(timeClass)) {
    return Response.json({ error: 'Unknown time control.' }, { status: 400 });
  }

  const headers = chessComHeaders();

  try {
    const archivesRes = await fetch(
      `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`,
      { headers }
    );

    if (archivesRes.status === 429) {
      return Response.json(
        { error: 'Chess.com is asking us to slow down. Wait a minute and try again.' },
        { status: 429 }
      );
    }

    if (!archivesRes.ok) {
      return Response.json(
        { error: 'Could not load game archives.' },
        { status: archivesRes.status === 404 ? 404 : 502 }
      );
    }

    const { archives } = await archivesRes.json();
    if (!archives || archives.length === 0) {
      return Response.json({ games: [] });
    }

    const collected = [];
    let monthsTried = 0;
    let rateLimited = false;

    // Walk backwards from the most recent month. Sequential on purpose:
    // chess.com asks API consumers not to hammer them with parallel requests.
    for (let i = archives.length - 1; i >= 0 && collected.length < count; i--) {
      if (monthsTried >= MAX_MONTHS_TO_SEARCH) break;
      monthsTried += 1; // counted before the request, so failed months still count

      try {
        const monthRes = await fetch(archives[i], { headers });

        if (monthRes.status === 429) {
          rateLimited = true; // chess.com wants us to slow down, so stop here
          break;
        }
        if (!monthRes.ok) continue;

        const { games } = await monthRes.json();

        for (let j = games.length - 1; j >= 0 && collected.length < count; j--) {
          const g = games[j];
          if (
            g.time_class === timeClass &&
            g.rules === 'chess' && // standard chess only, no variants
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
    }

    console.log(
      `[games] ${username} ${timeClass}: ${collected.length} games, ${monthsTried} months, ${
        Date.now() - startedAt
      }ms`
    );

    if (rateLimited && collected.length === 0) {
      return Response.json(
        { error: 'Chess.com is asking us to slow down. Wait a minute and try again.' },
        { status: 429 }
      );
    }

    return Response.json({ games: collected });
  } catch (err) {
    return Response.json(
      { error: 'Something went wrong reaching chess.com.' },
      { status: 500 }
    );
  }
}