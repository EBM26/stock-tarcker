import { errorResponse, json, normalizeSymbol, USER_ID } from '../../../../_lib/http.js';
import { getOwnedWatchlist } from '../../../../_lib/watchlists.js';

/** DELETE /api/watchlists/:id/items/:symbol */
export async function onRequestDelete({ env, params }) {
  const list = await getOwnedWatchlist(env.DB, params.id);
  if (!list) return errorResponse('Watchlist not found.', 404);
  const symbol = normalizeSymbol(params.symbol);
  if (!symbol) return errorResponse('Invalid ticker.');
  await env.DB
    .prepare('DELETE FROM watchlist_items WHERE watchlist_id = ? AND user_id = ? AND symbol = ?')
    .bind(list.id, USER_ID, symbol)
    .run();
  return json({ ok: true });
}
