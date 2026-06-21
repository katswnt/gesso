# Auth / Account / Cross-Device-Sync UX Audit (READ-ONLY)

Scope: `index.html` (auth client, refreshAuth/syncAccount/onAuthApplied/openLogin/renderAccount) + `api/{claim,sync,profile,score,delete-account}.js`.
Context: custom SMTP delivers all emails; "Confirm email" is OFF in Supabase. No code was changed.

Severity key: 🔴 broken · 🟡 confusing · 🟢 fine

---

## 1. First load / anonymous identity

- 🟢 **Identity is assigned lazily and persists.** `loadIdentity()` (index.html:1156) reads `gesso.identity`; if empty it falls back to `defaultName()` (1189, hash of deviceId → famous artist) and `defaultColor()` (1185). `deviceId()` (1155) is persisted to `localStorage("gesso.device")`, so both name and color are stable across reloads even before the user ever opens the profile modal. Header avatar (1099), account page (1657), and leaderboard (1230) all call `loadIdentity()`, so the anon identity shows consistently.

- 🟡 **The default name is never persisted, only derived.** `loadIdentity()` returns the default but `saveIdentity` is only called on explicit edit (1219) or sync (1321). The server only learns the name once a score is submitted (score.js) or the profile modal is saved (profile.js). So a brand-new player who looks at the leaderboard before playing sees their auto-name locally, but the server row may not exist yet — minor, self-heals on first score. Where: index.html:1156. Fix: optional — none strictly needed.

- 🟡 **`defaultName` can collide with a real registered player's reserved name.** The pool is 60 real artist surnames; two devices hash to the same handle, or a device's auto-name equals a name another *account* reserved. On score submit the server silently drops the name (score.js:62, `useName=''`) and the row shows blank/initials, but the local UI still shows the auto-name. Where: score.js:55-63 vs index.html header/account. User sees their name on their own screen but blank on the board. Fix: when `/api/score` returns a dropped name (it currently doesn't signal this), reflect it; or de-conflict auto-names.

---

## 2. Sign UP (openLogin `#signup`, index.html:1364-1369)

- 🟡 **signUp → signInWithPassword fallback works but the success path doesn't re-render the underlying view.** On success it calls `await refreshAuth()` then `setTimeout(close,500)`. `refreshAuth` sets `authUser` and runs sync, but **nothing re-renders the page underneath the modal** (see Finding 4). If the user signed up from the account page, after the modal closes they still see "Sign in to save across devices" until they navigate away and back. Where: 1368. Fix: call a re-render of the current view after `refreshAuth()` (see §4 fix).

- 🟢 **Existing-email edge case handled.** With confirm-email OFF, `signUp` on an existing email returns no session (or an "already registered" path); the code then attempts `signInWithPassword` (1367). If the password matches, they're signed in. If it doesn't, `signUp` itself usually returns an error and we `msg(error.message)` (1364) — acceptable.

- 🟡 **"Already signed in" not guarded for signup/signin.** If a user is already `authUser` but opens the modal via a stale path, the signed-in branch of the modal renders instead (1331), so the signup inputs aren't shown — OK. But there is no guard inside the handlers; not reachable in practice. 🟢 effectively.

- 🟡 **No profiles row is guaranteed at signup.** A `profiles` row keyed by device is only created by sync (sync.js binds device→user and upserts name/color) which *does* run inside `refreshAuth`. So signup → refreshAuth → syncAccount → profiles row. OK as long as `/api/sync` succeeds. If sync fails it falls back to `/api/claim` (binds user_id but writes no name/color). 🟢 with caveat.

---

## 3. Sign IN (password) / OAuth / magic link

- 🟡 **Password sign-in (#signin, 1363):** `signInWithPassword` → `refreshAuth()` → `close()`. Same missing re-render problem as signup: modal closes but the page beneath is stale (account still says "playing on this device"). Where: 1363. Fix: §4.

- 🔴 **OAuth and magic link have NO post-redirect re-render and NO auth-state listener.** OAuth (`signInWithOAuth`, 1356) and magic link (`signInWithOtp`, 1362) both redirect the browser away and back to `location.origin`. On return, the client is created with `detectSessionInUrl:true` (1304) so the session is picked up — but the **only** thing that reads it is the one-shot `setTimeout(refreshAuth, 600)` at startup (2629). Because there is **no `c.auth.onAuthStateChange` listener anywhere** (grep: 0 hits), and `refreshAuth` only fires once at boot, the timing is fragile: if `detectSessionInUrl` resolves after the 600ms timer, the user lands logged-out-looking until a manual reload. Where: index.html:1304, 2629; missing listener. User experience: "I clicked the magic link / signed in with Google and it dumped me back on the home page still anonymous." Fix: register `c.auth.onAuthStateChange((event,session)=>{ authUser=session?.user||null; syncAccount().then(s=>{ if(s)onAuthApplied(s); renderCurrentView(); }); })` once when `sb()` is created.

---

## 4. refreshAuth / syncAccount / onAuthApplied — the KEY BUG

- 🔴 **Account page shows "Sign in to save across devices" / "playing on this device" even when signed in.** Root cause, precisely:
  - `renderAccount()` (1643) reads `authUser` at render time to decide the email line (1659) and the Sign-in-vs-Sign-out buttons (1679).
  - At cold load, `refreshAuth()` is not called until `setTimeout(…,600)` (2629). `renderFromPath()` (2625) renders the account page **immediately** with `authUser===null`.
  - `refreshAuth` (1306) resolves ~600ms+ later (plus the `await syncAccount()` network round-trip). It sets `authUser` correctly, but it only calls `onAuthApplied` — and **even `onAuthApplied` never re-renders**. The gating is `if(synced && !was) onAuthApplied(synced)` (1307): `onAuthApplied` (1320) only writes localStorage (saveIdentity/saveStreak); **no view re-render happens at all.**
  - Net: after auth resolves, `authUser` is set in memory but the already-rendered account page is never repainted, so it keeps the anonymous strings. Same for the header avatar — it was painted from `loadIdentity()` before sync pulled the canonical name down.
  - Compounding: the `&& !was` guard means even the localStorage apply is skipped on the *second* `refreshAuth` of a session (e.g. called from `#signin`), and `onAuthApplied` is skipped entirely when `synced` is null (sync failed / claim fallback) even though `authUser` is now truthy.

  **Cleanest fix:** decouple "auth state changed" from "sync succeeded." `refreshAuth` should re-render the current view whenever the auth state actually changed, regardless of sync result:
  ```
  async function refreshAuth(){ const c=sb(); if(!c)return null;
    const {data}=await c.auth.getSession(); const was=!!authUser;
    authUser=data?.session?.user||null;
    if(authUser){ const synced=await syncAccount(); if(synced) onAuthApplied(synced); }
    if(!!authUser!==was) renderCurrentView();   // <-- repaint header + current route
    return authUser; }
  ```
  and have the explicit handlers (#signin/#signup) rely on this rather than only `close()`. Add a `renderCurrentView()` helper that re-runs the active route (reuse `renderFromPath()` or track the current view) and re-renders the header avatar. Also register an `onAuthStateChange` listener (see §3) so OAuth/magic-link returns repaint too.

- 🔴 **Signed-in user still shows auto-name "Donatello" with 0 points (the screenshot).** Two failure modes combine:
  1. Even if `syncAccount` pulled the canonical name/color/streak down via `onAuthApplied` (saveIdentity/saveStreak), the page that's already on screen is never re-rendered (above), so it keeps the pre-sync auto-name and the pre-merge streak/points.
  2. The `if(synced && !was)` guard: if `was` was already true (any second refreshAuth) the pulled identity/streak is discarded. And points on the account page come from `loadStreak().scores` (1645) — these are only updated if `saveStreak(merged)` ran AND the view re-rendered. With no re-render, points stay at the device-local value (0 for a fresh device).
  Fix: same as above — always apply `onAuthApplied` when `synced` is present (drop `!was`), and always re-render after auth resolves.

- 🟡 **`syncAccount` adopts the device's auto-name as the canonical account name.** sync.js:48-53: if no profile on the account has a name yet, it takes `body.name` (the device's local auto-name, e.g. "Donatello"). So the *first* device that logs in stamps a random artist handle as the account's permanent canonical name, and every other device then inherits it. User who never set a name gets "Donatello" forever across devices. Where: sync.js:50-51. Fix: don't promote auto-generated names to canonical; only adopt a name the user explicitly set (track an "isCustom" flag, or pass it only from the profile modal).

---

## 5. renderAccount staleness summary (index.html:1643)

Parts that key off `authUser` and are wrong when auth resolves after render:
- Line 1659: email line shows `'playing on this device'` instead of the email.
- Line 1679: shows "Sign in to save across devices" instead of Sign out / Delete account.
- Lines 1657-1664: avatar, name, streak, all-time points all read `loadIdentity()`/`loadStreak()` captured *before* sync pulled canonical values down — stale even if localStorage was later updated, because the function already returned its HTML string.
All of these are fixed by re-rendering the account view when auth/sync completes (§4).

- 🟢 Today's-rank tile (1686-1688) is correctly async and self-updates the `#acrank` span.

---

## 6. Sign out / delete / name reservation / profile binding

- 🟡 **Sign out from the modal closes the modal but doesn't repaint the page (1359).** `#signout` does `signOut(); authUser=null; close();` with no re-render — if you were on the account page it still shows Sign out / your email until navigation. The account-page sign-out button (1683) *does* call `renderAccount(false)`, so it's inconsistent: two sign-out paths, only one repaints. Fix: route both through a re-render.

- 🟡 **Sign out does not clear the synced local identity/streak.** After logout the device keeps the account's canonical name/color/streak in localStorage (from onAuthApplied). On a shared device, the next anonymous user inherits the previous account's name and points. Where: 1359, 1683. Fix: decide product intent; if accounts should be private, reset identity/streak to device defaults on sign-out.

- 🟢 **Delete account (delete-account.js)** verifies the JWT, deletes scores+profiles for every bound device, user_state, then the auth user. UI (1690-1699) confirms, signs out, returns home. Solid. Minor: local `gesso.identity`/`gesso.streak`/`gesso.sent` are NOT cleared after delete, so the deleted user's local data lingers and `backfillScores` (1162) will re-push old scores to a fresh anonymous row on next play. 🟡 Fix: clear local game state on delete.

- 🟡 **Name reservation is case-insensitive on read but the 409 path differs across endpoints.** profile.js returns 409 "name reserved" (surfaced in the identity modal only via name-check pre-flight at index.html:1217). score.js silently drops the name (no signal to client). Inconsistent: a name change via the modal is blocked with a message, but a reserved name riding along on a score submit just vanishes from the board with no feedback. Fix: unify — have score.js return the dropped name so the client can warn, or rely solely on the modal gate.

- 🟢 **Profile binding (device→user_id)** via claim.js / sync.js upsert on `device_id` with merge-duplicates is correct and idempotent.

---

## Ranked fix list (highest impact first)

1. 🔴 **Re-render the current view + header whenever auth state changes** (in `refreshAuth`, regardless of sync result). Single fix that resolves the "still says playing on this device / still Donatello / 0 points" bug on the account page and header. (index.html:1306-1307, 1320, add `renderCurrentView()`.)
2. 🔴 **Add a `c.auth.onAuthStateChange` listener** when `sb()` is created, so OAuth and magic-link redirects (and token refreshes) reliably end signed-in with the UI updated — don't depend on the one-shot 600ms boot timer. (index.html:1304, 2629.)
3. 🔴 **Drop the `&& !was` guard / null-synced skip** so the pulled canonical identity + merged streak is always applied after login. (index.html:1307.)
4. 🟡 **Stop promoting auto-generated names to the canonical account name** in sync.js (only adopt user-set names). (sync.js:50-51.)
5. 🟡 **Route both sign-out paths and signup/signin success through the same re-render**, and clear (or intentionally keep) local identity/streak on sign-out. (index.html:1359, 1363, 1368, 1683.)
6. 🟡 **Clear local game state on account delete** so backfill doesn't resurrect deleted scores. (index.html:1697.)
7. 🟡 **Unify name-reservation feedback** between profile.js (409) and score.js (silent drop). (score.js:62.)
