import { chessComHeaders } from '../../../../lib/chesscom';
export async function GET(request, { params }) {
  const { username } = await params;

  const headers = chessComHeaders();

  try {
    const [profileRes, statsRes] = await Promise.all([
      fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username)}`, { headers }),
      fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username)}/stats`, { headers }),
    ]);

    if (!profileRes.ok) {
      return Response.json(
        { error: 'Player not found. Check the username and try again.' },
        { status: profileRes.status === 404 ? 404 : 502 }
      );
    }

    const profile = await profileRes.json();
    const stats = await statsRes.json();

    return Response.json({ profile, stats });
  } catch (err) {
    return Response.json(
      { error: 'Something went wrong reaching chess.com.' },
      { status: 500 }
    );
  }
}