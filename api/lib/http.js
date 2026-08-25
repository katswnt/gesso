// Shared HTTP helpers for api/* — single source for the origin allowlist and body parsing
// (previously copy-pasted into six handlers).

export function allowedOrigin(origin) {
  if (!origin) return true; // same-origin fetches may omit Origin; don't hard-block
  try {
    const h = new URL(origin).hostname;
    return h === 'gesso.katswint.com' || h === 'localhost' || h.endsWith('.vercel.app');
  } catch { return false; }
}

export function parseBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  return b || {};
}

export function clientIp(req) {
  return String((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim() || 'unknown';
}
