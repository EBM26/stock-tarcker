import { cleanName, errorResponse, json, readJson, USER_ID } from '../../../_lib/http.js';
import { getOwnedWatchlist } from '../../../_lib/watchlists.js';

/** PATCH /api/watchlists/:id  { name } — rename */
export async function onRequestPatch({ request, env, params }) {
  const list = await getOwnedWatchlist(env.DB, params.id);
  if (!list) return errorResponse('Watchlist not found.', 404);
  const name = cleanName((await readJson(request))?.name);
  if (!name) return errorResponse('Please enter a name (up to 50 characters).');
  await env.DB.prepare('UPDATE watchlists SET name = ? WHERE id = ? AND user_id = ?').bind(name, list.id, USER_ID).run();
  return json({ watchlist: { ...list, name } });
}

/** DELETE /api/watchlists/:id — not allowed for the last remaining list */
export async function onRequestDelete({ env, params }) {
  const list = await getOwnedWatchlist(env.DB, params.id);
  if (!list) return errorResponse('Watchlist not found.', 404);
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM watchlists WHERE user_id = ?').bind(USER_ID).first();
  if (n <= 1) return errorResponse("You can't delete your only watchlist.", 409);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM watchlist_items WHERE watchlist_id = ? AND user_id = ?').bind(list.id, USER_ID),
    env.DB.prepare('DELETE FROM watchlists WHERE id = ? AND user_id = ?').bind(list.id, USER_ID),
  ]);
  return json({ ok: true });
}
