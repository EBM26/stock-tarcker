import { createSessionCookie, safeEqual } from '../_lib/auth.js';
import { errorResponse, json, readJson } from '../_lib/http.js';

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!password || !(await safeEqual(password, env.APP_PASSWORD))) {
    await new Promise((r) => setTimeout(r, 600)); // Slow down guessing a little.
    return errorResponse('Wrong password.', 401);
  }
  return json({ ok: true }, 200, { 'Set-Cookie': await createSessionCookie(env.SESSION_SECRET) });
}
