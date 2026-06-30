# Design brief — "My Gallery" (save the art)

**Goal:** let players save artworks they love so they can revisit them, instead of screenshotting.
**Name:** "My Gallery". (Distinct from the existing curated **Collections** page.)
**Voice:** museum-catalog / "record filed" tone, matching the rest of Gesso.

## Context & constraints (so designs reuse what exists)
- A saved item is just a work **id** — the gallery re-renders title/image/artist/notes/pins from `POOL`/`CUES`. No snapshots.
- Storage: Supabase, keyed by the anonymous **device id** (same identity model as the leaderboard). Cross-device for the same device id; upgrades to a real account later with no migration.
- Reuse existing primitives: dab avatars, `lb-glass-*` card classes, `paintBurst` micro-interaction, the reveal/study renderer (image + look-closer pins + numbered notes), `ICONS`.
- **Save is only available on a FILED / revealed work** (after a round is submitted, in infinite/training reveals, and the `?qa=` study view) — never on the live guess screen, so it can't leak the answer.

## Screens to design

### 1. Save toggle (on every reveal)
- Bookmark icon, two states: **unsaved** (outline) / **saved** (filled).
- Placement: top-right of the artwork plate, or inline by the work title — pick one, show both states.
- Tap feedback: reuse `paintBurst`; consider a tiny "Filed to your gallery ✓" confirmation (toast or inline, auto-dismiss).
- Accessible label ("Save to My Gallery" / "Remove from My Gallery").

### 2. My Gallery page
- Grid of saved works: thumbnail + title + artist (+ optional region/era chip).
- Header: title + **count** ("12 works filed").
- **Sort control**: Recent / Region / Era (recent default).
- **Empty state**: "Nothing filed yet — tap the bookmark on any artwork you want to keep."
- Per-card **remove** (×) affordance.
- Responsive (mobile-first; it'll be opened on phones a lot).

### 3. Saved-work detail
- Tapping a card reopens the full **study view** (image + pins + notes), read-only — reuse the reveal/`qaView` renderer.
- Modal vs full page (recommend full page for mobile). Back affordance. Save/remove toggle present here too.

### 4. Account/profile integration (entry point)
- "My Gallery" surfaces in the **account area**: section header + count + a small thumbnail preview row + "View all →".

### 5. States
- Loading (fetching saves), offline (localStorage-only mirror still works), sync error (non-blocking).

## Out of scope for v1
- Folders/tags, sharing a gallery publicly, reordering. (Possible later.)

## What's already being built in parallel (engineering)
- `api/saves.js` (GET/POST/DELETE) + Supabase `saves` table.
- Client `savedIds` set with localStorage mirror + optimistic sync.
- A bare, functional save toggle + gallery page + account entry — to be **skinned** to these designs.
