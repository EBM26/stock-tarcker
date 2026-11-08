import { errorResponse, json, USER_ID } from '../../../_lib/http.js';
import { ALERT_COLUMNS } from '../../../_lib/alerts.js';

/** POST /api/alerts/:id/rearm — make a triggered alert active again */
export async function onRequestPost({ env, params }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return errorResponse('Invalid alert.');
  const alert = await env.DB
    .prepare(
      `UPDATE alerts SET status = 'active', triggered_at = NULL, triggered_price = NULL
       WHERE id = ? AND user_id = ? RETURNING ${ALERT_COLUMNS}`
    )
    .bind(id, USER_ID)
    .first();
  if (!alert) return errorResponse('Alert not found.', 404);
  return json({ alert });
}
