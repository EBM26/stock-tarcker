// Settings the core app can't run without. If any is missing, every /api request
// returns code "config_missing" and the page shows a full-screen message naming them.
// (Gemini settings are optional here: only the risk summary needs them.)

const REQUIRED_SECRETS = ['APP_PASSWORD', 'SESSION_SECRET', 'FINNHUB_API_KEY', 'TWELVEDATA_API_KEY'];

export function missingSettings(env) {
  const missing = REQUIRED_SECRETS.filter((name) => !String(env[name] ?? '').trim());
  if (!env.DB) missing.push('DB (D1 database binding)');
  return missing;
}
