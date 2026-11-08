import { USER_ID } from './http.js';

/** Returns the user's watchlists, creating "My Watchlist" on first run so the app is never empty. */
export async function listWatchlists(db) {
  const query = () =>
    db.prepare('SELECT id, name, position FROM watchlists WHERE user_id = ? ORDER BY position, id').bind(USER_ID).all();
  let { results } = await query();
  if (results.length === 0) {
    // Guarded insert so two first-run requests can't both create a default list.
    await db
      .prepare(
        `INSERT INTO watchlists (user_id, name, position)
         SELECT ?, 'My Watchlist', 0 WHERE NOT EXISTS (SELECT 1 FROM watchlists WHERE user_id = ?)`
      )
      .bind(USER_ID, USER_ID)
      .run();
    ({ results } = await query());
  }
  return results;
}

export async function getOwnedWatchlist(db, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  return db.prepare('SELECT id, name, position FROM watchlists WHERE id = ? AND user_id = ?').bind(n, USER_ID).first();
}
