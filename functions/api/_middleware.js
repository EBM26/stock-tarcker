import { isValidSession } from '../_lib/auth.js';
import { errorResponse } from '../_lib/http.js';

const PUBLIC_PATHS = new Set(['/api/login', '/api/logout']);

async function handleErrors(context) {
  try {
    return await context.next();
  } catch (err) {
    console.error('Unhandled error:', err?.stack || err);
    return errorResponse('Something went wrong on the server. Please try again.', 500);
  }
}

async function requireSession(context) {
  const { request, env } = context;
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (PUBLIC_PATHS.has(path)) return context.next();
  if (!env.SESSION_SECRET || !env.APP_PASSWORD) {
    return errorResponse('Server is missing APP_PASSWORD or SESSION_SECRET.', 500);
  }
  if (!(await isValidSession(request, env.SESSION_SECRET))) {
    return errorResponse('Please log in.', 401);
  }
  return context.next();
}

export const onRequest = [handleErrors, requireSession];
