// SINGLE SOURCE OF TRUTH for what production may serve statically (G-02). `build-public.mjs` copies exactly
// this allowlist into the deploy output dir; `check-public-output.mjs` proves the copy is complete, leak-free,
// and that `vercel.json` matches; `tests/routes.test.mjs` proves every allowlisted SPA route actually restores.
//
// Deny-by-default: anything NOT named here (all of docs/ db/ tasks/ tests/ server/ scripts/ .github/, the root
// README.md/package.json/vercel.json, and every data/*.json build input) is simply never in the static output,
// so production returns a real 404 for it. api/** + server/api/** stay at the project root as FUNCTION source —
// Vercel bundles them independently of outputDirectory; they are never part of the static output.

// ---- static asset allowlist ----
export const PUBLIC_FILES = ['index.html', 'styles.css', 'favicon.ico', 'favicon.png', 'apple-touch-icon.png'];
export const PUBLIC_DIRS = ['assets', 'data/notes'];            // copied recursively (data/notes/* are generated shards)
export const PUBLIC_DATA_SCRIPTS = [                            // the <script src="data/*.js"> tags index.html loads
  'countries', 'cues-ext', 'cues', 'daily-history', 'daily-order', 'fame', 'hotspots',
  'movement-artists', 'movement-wiki', 'museums', 'pool', 'regions', 'vision',
].map(n => `data/${n}.js`);

// Every repo-relative file/dir prefix that is allowed to appear in the output.
export const PUBLIC_ENTRIES = [...PUBLIC_FILES, ...PUBLIC_DATA_SCRIPTS, ...PUBLIC_DIRS];

// A referenced local asset (repo-relative, no query) is covered iff it is an explicit file, a listed data script,
// or lives under a public dir.
export function isCovered(rel) {
  if (PUBLIC_FILES.includes(rel) || PUBLIC_DATA_SCRIPTS.includes(rel)) return true;
  return PUBLIC_DIRS.some(d => rel === d || rel.startsWith(d + '/'));
}

// Platform-owned path injected by Vercel Web Analytics — NOT a repo file, always excused from the closure check.
export const PLATFORM_EXCEPTIONS = ['_vercel/insights/script.js'];

// ---- closure helpers (used by the offline gate to prove the HTML/CSS can't reference an un-shipped asset) ----
const stripLocal = raw => {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s || s.includes('${') || s.startsWith('#') || /^%23/i.test(s) || s.startsWith('data:') || s.startsWith('mailto:')) return null;  // %23 = encoded '#' fragment
  if (/^https?:\/\//i.test(s) || s.startsWith('//')) return null;   // remote
  s = s.split(/[?#]/)[0];                                           // drop query / fragment
  s = s.replace(/^\.?\//, '');                                      // '/assets/x' | './assets/x' -> 'assets/x'
  if (!s || s === '/' ) return null;
  if (PLATFORM_EXCEPTIONS.includes(s)) return null;                 // _vercel/insights/script.js
  return s;
};

// Local asset paths referenced by index.html via src=/href= (scripts, css, favicons, /assets/*, data/*.js).
export function referencedLocalAssets(indexHtml) {
  const out = new Set();
  for (const m of indexHtml.matchAll(/(?:src|href)\s*=\s*"([^"]*)"/gi)) {
    const rel = stripLocal(m[1]);
    if (rel) out.add(rel);
  }
  return [...out];
}

// Local url(...) targets inside a stylesheet (excludes data: URLs and remote).
export function cssUrlRefs(cssText) {
  const out = new Set();
  for (const m of cssText.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
    const rel = stripLocal(m[2]);
    if (rel) out.add(rel);
  }
  return [...out];
}

// Quoted "/assets/..." (or "assets/...") string literals anywhere in the HTML/JS — catches runtime references
// (dynamic <img>, icon lookups) that aren't plain src=/href= attributes. Spaces inside quotes are preserved.
export function assetStringLiterals(html) {
  const out = new Set();
  for (const m of html.matchAll(/["']\/?(assets\/[^"']+)["']/gi)) out.add(m[1].split(/[?#]/)[0]);
  return [...out];
}

// ---- SPA route allowlist (exact forms — no descendant catch-alls) ----------------------------------------------
// Derived from index.html's router: pathFor() (index.html:2650) + renderFromPath() (index.html:2652). Each entry
// is (a) an exact Vercel rewrite `source` → /index.html, (b) a JS RegExp matching the same pathnames, and (c) the
// view renderFromPath() restores for that path from a COLD load (empty game state) — asserted by routes.test.mjs.
// `view: 'home'` marks a path that only falls back to home (e.g. /gallery, which pathFor emits but renderFromPath
// does not restore) — included solely to preserve today's 200→home behavior, NOT as a working deep link.
const TIER = 'easy|medium|hard|impossible';
const DATE = String.raw`\d{4}-\d{2}-\d{2}`;
export const ROUTE_PATTERNS = [
  { name: 'date',            vercelSource: `/:date(${DATE})`,                                   re: new RegExp(`^/${DATE}$`),                        view: 'renderDayView',    sample: '/2026-08-27' },
  { name: 'date/tier',       vercelSource: `/:date(${DATE})/:tier(${TIER})`,                    re: new RegExp(`^/${DATE}/(?:${TIER})$`),            view: 'startGame',        sample: '/2026-08-27/easy' },
  { name: 'date/tier/result',vercelSource: `/:date(${DATE})/:tier(${TIER})/result`,             re: new RegExp(`^/${DATE}/(?:${TIER})/result$`),     view: 'renderDayView',    sample: '/2026-08-27/easy/result' },
  { name: 'date/tier/round', vercelSource: `/:date(${DATE})/:tier(${TIER})/:round(r\\d+)`,       re: new RegExp(`^/${DATE}/(?:${TIER})/r\\d+$`),      view: 'renderDayView',    sample: '/2026-08-27/easy/r2' },
  { name: 'leaderboard',     vercelSource: `/leaderboard`,                                      re: /^\/leaderboard$/,                               view: 'renderLeaderboard',sample: '/leaderboard' },
  { name: 'leaderboard/date',vercelSource: `/leaderboard/:date(${DATE})`,                        re: new RegExp(`^/leaderboard/${DATE}$`),            view: 'renderLeaderboard',sample: '/leaderboard/2026-08-27' },
  { name: 'register',        vercelSource: `/register`,                                         re: /^\/register$/,                                  view: 'renderLeaderboard',sample: '/register' },
  { name: 'register/date',   vercelSource: `/register/:date(${DATE})`,                           re: new RegExp(`^/register/${DATE}$`),               view: 'renderLeaderboard',sample: '/register/2026-08-27' },
  { name: 'infinite/tier',   vercelSource: `/infinite/:tier(${TIER})`,                          re: new RegExp(`^/infinite/(?:${TIER})$`),           view: 'startInfinite',    sample: '/infinite/easy' },
  { name: 'movement/slug',   vercelSource: `/movement/:slug`,                                   re: /^\/movement\/[^/]+$/,                           view: 'renderMovement',   sample: '/movement/Impressionism' },
  { name: 'training',        vercelSource: `/training`,                                         re: /^\/training$/,                                  view: 'renderTraining',   sample: '/training' },
  { name: 'account',         vercelSource: `/account`,                                          re: /^\/account$/,                                   view: 'renderAccount',    sample: '/account' },
  { name: 'archive',         vercelSource: `/archive`,                                          re: /^\/archive$/,                                   view: 'route',            sample: '/archive' },
  { name: 'streak',          vercelSource: `/streak`,                                           re: /^\/streak$/,                                    view: 'route',            sample: '/streak' },
  { name: 'stats',           vercelSource: `/stats`,                                            re: /^\/stats$/,                                     view: 'route',            sample: '/stats' },
  { name: 'glossary',        vercelSource: `/glossary`,                                         re: /^\/glossary$/,                                  view: 'route',            sample: '/glossary' },
  { name: 'collections',     vercelSource: `/collections`,                                      re: /^\/collections$/,                               view: 'route',            sample: '/collections' },
  { name: 'gallery',         vercelSource: `/gallery`,                                          re: /^\/gallery$/,                                   view: 'home',             sample: '/gallery' },
  { name: 'gallery/id',      vercelSource: `/gallery/:id`,                                      re: /^\/gallery\/[^/]+$/,                            view: 'home',             sample: '/gallery/some-work-id' },
];

// Exact set of rewrite `source` strings expected in vercel.json (all → /index.html).
export const VERCEL_REWRITE_SOURCES = ROUTE_PATTERNS.map(p => p.vercelSource);
