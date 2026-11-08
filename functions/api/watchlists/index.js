import { cleanName, errorResponse, json, readJson, USER_ID } from '../../_lib/http.js';
import { listWatchlists } from '../../_lib/watchlists.js';

const MAX_LISTS = 30;

export async function onRequestGet({ env }) {
  return json({ watchlists: await listWatchlists(env.DB) });
}

export async function onRequestPost({ request, env }) {
  const name = cleanName((await readJson(request))?.name);
  if (!name) return errorResponse('Please enter a name (up to 50 characters).');
  const lists = await listWatchlists(env.DB);
  if (lists.length >= MAX_LISTS) return errorResponse(`You can have up to ${MAX_LISTS} watchlists.`);
  const position = lists.reduce((m, l) => Math.max(m, l.position), 0) + 1;
  const row = await env.DB
    .prepare('INSERT INTO watchlists (user_id, name, position) VALUES (?, ?, ?) RETURNING id, name, position')
    .bind(USER_ID, name, position)
    .first();
  return json({ watchlist: row }, 201);
}
