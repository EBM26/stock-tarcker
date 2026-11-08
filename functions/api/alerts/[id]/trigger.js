import { errorResponse, json, readJson, USER_ID } from '../../../_lib/http.js';

/**
 * POST /api/alerts/:id/trigger { price }
 * Marks the alert triggered ONLY if it is still active, and reports whether this request
 * was the one that did it. Only that browser shows the notification, so two open devices
 * never both alert.
 */
export async function onRequestPost({ request, env, params }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return errorResponse('Invalid alert.');
  const price = Number((await readJson(request))?.price);
  const result = await env.DB
    .prepare(
      `UPDATE alerts
       SET status = 'triggered', triggered_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), triggered_price = ?
       WHERE id = ? AND user_id = ? AND status = 'active'`
    )
    .bind(Number.isFinite(price) ? price : null, id, USER_ID)
    .run();
  return json({ triggered: result.meta.changes === 1 });
}
