# Gesso — Metrics, North Star & Funnel

## North Star: **Weekly Works Learned (WWL)**
> The number of distinct artworks per week where a user *engaged with the teaching* — opened the guide/notes or advanced a category's mastery.

Why this over DAU or streak: it captures **both** halves of the value prop — the *habit* (they came back) **and** the *learning* (they actually took something in). It's the metric no competitor (Artle, NYT Games) can claim, so it's the one worth being great at. A rising WWL means people are getting culturally literate *and* returning — the whole thesis.

Supporting guardrails: 7-day retention (don't juice WWL by burning people out) and "felt-taught rate" (don't let learning become a chore).

## Funnel (acquisition → learning → loop)
| Stage | Definition | Event |
|---|---|---|
| **Land** | First session | (pageview) |
| **Activate** | Completes a first daily | `daily_complete` (first) |
| **Learn** | Opens the guide / advances mastery in that session | `guide_open`, `mastery_up` |
| **Return** | Comes back D1 / D7 / D30 | `daily_complete` by date |
| **Habit** | Reaches a 7-day streak | `streak_milestone {days:7}` |
| **Refer** | Shares a result / copies a puzzle link | `result_share`, `puzzle_link_copy` |
| **Convert** | Creates an account | `account_create` |

Read activation as **% of new users who complete a first daily**, and the biggest early lever is almost certainly the **novice difficulty ramp** (see `icp.md`).

## Event dictionary (wired via `track()` in index.html)
Vendor-agnostic shim: buffers to `localStorage['artefactum.events']` and fires to any connected backend (Plausible / GA / a custom `window.__sink`). Backend is live (self-hosted Supabase events) — see "Backend" below.

| Event | Props | Feeds |
|---|---|---|
| `daily_complete` | `score`, `streak` | Activation, retention, north star input |
| `streak_milestone` | `days` (7/30/100/365) | Habit |
| `mastery_up` | `bucket` (category) | **Learning outcome / WWL** |
| `guide_open` | — | **Learning engagement / WWL** |
| `training_start` | — | Depth adoption |
| `result_share` | `tier` | Referral / virality |
| `puzzle_link_copy` | `tier` | Referral (copies the deep-link to a puzzle) |
| `account_create` | `pending` (email-confirm awaited) | Convert |
| `pin_click` | `mode`, `tier` | Map engagement (once/round) |
| `zoom` | `mode`, `tier` | Map engagement — genuine user zoom only (once/round) |
| *(remaining)* `activation_sentiment` | | "felt-taught" guardrail — needs a UI prompt |

## Engagement & quality metrics
- **Guide-open rate** = `guide_open` / `daily_complete` — *is the teaching layer actually used?* (the core product question).
- **Training adoption** = users with ≥1 `training_start` / active users.
- **Rounds/session**, **share rate** = `result_share` / `daily_complete`.
- **Content ops (the rigor story):** % pool vision-audited (drove easy tier 75%→100%), coverage delta by region, bug classes caught by the `check-pool` gate over time. These aren't user metrics but they're the *portfolio* metrics — proof of operational discipline.

## Targets (hypotheses to validate, not promises)
- Activation (first-daily completion) **≥ 55%** of landers.
- D7 retention **≥ 25%** (Wordle-class daily-habit range).
- Guide-open rate **≥ 40%** (validates the teaching layer earns its place).
- WWL trending up week-over-week for returning cohorts.

## Backend (shipped)
**Decision made and live: self-hosted Supabase events** (full data ownership, no third-party tracker — best brand fit). `track()` (`index.html`) POSTs custom events to `api/event.js` → a Supabase `events` table; **Vercel Web Analytics** covers pageviews. `gtag`/`plausible` are optional no-op guards only (neither is loaded).

**Events wired (18):** `daily_start`, `daily_complete`, `round_start`, `guess_submit`, `mastery_up`, `guide_open`, `training_start`, `infinite_start`, `streak_milestone`, `result_share`, `work_share`, `collections_view`, `pin_click`, `zoom`, `puzzle_link_copy`, `account_create`, `support_shown`, `support_click`.

**Still to wire:** `activation_sentiment` (needs a lightweight post-first-daily "how did that feel?" prompt — a UI addition, not just a `track()` call). **Not client-measurable:** `support_convert` happens off-site on Ko-fi; the on-site funnel ends at `support_click`. A true conversion count would need a Ko-fi webhook → `api/event`, tracked as a later option.
