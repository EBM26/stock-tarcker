import { HOLDING_COLUMNS, parseHoldingNumbers } from '../../../_lib/holdings.js';
import { errorResponse, json, readJson, USER_ID } from '../../../_lib/http.js';

function parseId(params) {
  const id = Number(params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** PATCH /api/holdings/:id { shares, avg_cost } */
export async function onRequestPatch({ request, env, params }) {
  const id = parseId(params);
  if (!id) return errorResponse('Invalid holding.');
  const nums = parseHoldingNumbers(await readJson(request));
  if (nums.error) return errorResponse(nums.error);
  const holding = await env.DB
    .prepare(
      `UPDATE holdings SET shares = ?, avg_cost = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND user_id = ? RETURNING ${HOLDING_COLUMNS}`
    )
    .bind(nums.shares, nums.avgCost, id, USER_ID)
    .first();
  if (!holding) return errorResponse('Holding not found.', 404);
  return json({ holding });
}

/** DELETE /api/holdings/:id */
export async function onRequestDelete({ env, params }) {
  const id = parseId(params);
  if (!id) return errorResponse('Invalid holding.');
  await env.DB.prepare('DELETE FROM holdings WHERE id = ? AND user_id = ?').bind(id, USER_ID).run();
  return json({ ok: true });
}
