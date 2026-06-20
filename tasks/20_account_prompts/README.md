# Handoff — Account prompts (when & how to ask people to sign up)

Where and how Gesso invites players to make an account. *Design reference* in HTML.

**Visual reference:** `Gesso Account Prompts.dc.html` (+ `support.js`) — all states, three tiers.
**Icons:** `Gesso Icon Variants.dc.html` — full flame + bookmark option sets (chosen: **F3 Chunky** flame, **B5 Pennant** glossary mark).
**Tokens:** existing `:root`. Archivo + IBM Plex Mono. Custom line icons only — **no emoji**.

---

## Two non-negotiable principles
1. **Never gate play.** Anyone can play, build a streak, see the leaderboard, and even **pick a name + dab** without an account. New devices get a **random name + random dab color** and are **already ranked** on the board.
2. **Account = permanence, not existence.** The value is: survive a **cache/cookie clear**, **sync across devices**, and **claim/lock a leaderboard name** so no one else takes it. Never imply local progress is fragile or will be lost in normal use, and never say "claim your spot" as if they're absent — they're already on the board.

Migrate, don't reset: on signup, the device's existing streak/stats/glossary/name+dab carry into the account. One soft dismiss per prompt, then back off until a **bigger** milestone.

## Tier 1 — high-intent (build these first; ~80% of conversions)
- **After the daily** (modal) — best moment. Shows today's score + day streak, chunky-flame dab. CTA **"Create free account"**, secondary "Maybe later".
- **Streak milestone** (modal) — at a meaningful streak (e.g. 3). Chunky flame + count. Copy: *"Your streak's safe on this device. An account keeps it — even if you clear your browser or pick up your phone."* CTA **"Back up my progress"**.
- **Leaderboard, signed-out** — player is **already listed** with their auto name (e.g. *quiet-heron*) + random dab, highlighted "YOU". Copy: *"You're already ranked as quiet-heron — a random name we gave this device. Make it yours so no one else takes it and it follows you everywhere."* CTA **"Make this name mine"**.

## Tier 2 — value-accrual nudges
- **Glossary unlock toast** (pennant mark) — "New movement met… Keep your collection on any device →".
- **Mastery/stats card** (eye icon) — "An account keeps this history even if your browser forgets." CTA "Back up my stats" + "Later".
- **Perfect/Masterpiece banner** — dark card, gold "Masterpiece" stamp. "Claim it on your profile and the leaderboard." CTA "Claim badge".
- **Share card footer** — "gesso.app — play & track your scores" + dab (doubles as acquisition).

## Tier 3 — ambient
- **Header avatar, signed-out** — dashed dab + "Sign in" pill; hover/tap: "Back up your progress & claim a name". Always present, never naggy.
- **Archive hint** — sync icon: "Sign in so the days you've played follow you across devices."
- **Settings sync line** — "These are saved here. Make an account to sync settings across devices."
- **Return visit / new device** — one-time banner: "Make an account so your streak & stats follow you to any device."

## Icons (custom, currentColor where possible)
- **Streak flame = F3 Chunky:** `M12 3c3.4 3.2 5.2 5.4 5.2 8.4a5.2 5.2 0 11-10.4 0c0-1.4.5-2.6 1.3-3.6.2 1.3.9 2 1.9 2.3C9.4 9 10.3 6.2 12 3z` (24×24 viewBox; stroke for line, fill for solid).
- **Glossary mark = B5 Pennant:** two paths `M6 3v18` + `M6 4h11l-3 3.6L17 11H6z` (round caps/joins).
- Also used: eye (mastery), sync arrows (archive/devices), × close. See reference file for exact paths. `Gesso Icon Variants.dc.html` holds the full option sets if you ever want to swap.

## Wiring notes
- Frequency cap per prompt (one dismiss → escalate to next milestone). Don't show Tier-1 modals on the same session as each other.
- All modals reuse the existing veil + centered-panel / bottom-sheet pattern, × + Esc to close.
- Name+dab picker = the leaderboard "pick your name & color" window (random defaults pre-filled).
