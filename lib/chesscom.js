export function chessComHeaders() {
  const contact = process.env.CHESSCOM_CONTACT;

  if (!contact) {
    console.warn('CHESSCOM_CONTACT is not set. Chess.com asks for a contact in the User-Agent.');
  }

  return {
    'User-Agent': `chess-coach-app/1.0 (contact: ${contact || 'not-set'})`,
  };
}