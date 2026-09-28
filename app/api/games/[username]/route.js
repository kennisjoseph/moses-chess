import { chessComHeaders } from '../../../../lib/chesscom';

export async function GET(request, { params }) {
  const { username } = await params;
  const { searchParams } = new URL(request.url);
  const timeClass = searchParams.get('timeClass') || 'rapid';
  const count = Number(searchParams.get('count')) || 30;

  const headers = chessComHeaders();

  try {
    const archivesRes = await fetch(
      `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`,
      { headers }
    );

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

    // Walk backwards from the most recent month. Sequential on purpose —
    // chess.com asks API consumers not to hammer them with parallel requests.
    for (let i = archives.length - 1; i >= 0 && collected.length < count; i--) {
      const monthRes = await fetch(archives[i], { headers });
      if (!monthRes.ok) continue;

      const { games } = await monthRes.json();

      for (let j = games.length - 1; j >= 0 && collected.length < count; j--) {
        if (games[j].time_class === timeClass) {
          collected.push(games[j]);
        }
      }

      if (archives.length - i > 24) break; // don't dig back more than ~2 years
    }

    return Response.json({ games: collected });
  } catch (err) {
    return Response.json(
      { error: 'Something went wrong reaching chess.com.' },
      { status: 500 }
    );
  }
}