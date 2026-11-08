import { errorResponse, json, USER_ID } from '../../../_lib/http.js';

/** DELETE /api/alerts/:id */
export async function onRequestDelete({ env, params }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return errorResponse('Invalid alert.');
  await env.DB.prepare('DELETE FROM alerts WHERE id = ? AND user_id = ?').bind(id, USER_ID).run();
  return json({ ok: true });
}
