import { isValidSession } from '../_lib/auth.js';
import { missingSettings } from '../_lib/config.js';
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

// Runs before the password check so a misconfigured deploy is obvious even on the login screen.
// Only setting names are revealed, never values.
async function requireConfig(context) {
  const missing = missingSettings(context.env);
  if (missing.length) {
    return errorResponse(`Server is missing required settings: ${missing.join(', ')}.`, 503, {
      code: 'config_missing',
      missing,
    });
  }
  return context.next();
}

async function requireSession(context) {
  const { request, env } = context;
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  if (PUBLIC_PATHS.has(path)) return context.next();
  if (!(await isValidSession(request, env.SESSION_SECRET))) {
    return errorResponse('Please log in.', 401);
  }
  return context.next();
}

export const onRequest = [handleErrors, requireConfig, requireSession];
