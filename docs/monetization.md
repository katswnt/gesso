# Gesso — Monetization Hypothesis Memo

## Constraint & stance
Gesso's mission is **free, public-domain, accessible** art literacy. Monetization must not gate the core daily or paywall knowledge — that would betray the brand and the ICP (art-curious lapsed museum-goers who resent gatekeeping). So the frame is: *how do we become sustainable without becoming extractive?* Revenue is a **guardrail** (cover costs, prove viability), not the north star.

## Options considered
| Model | Fit | Risk | Verdict |
|---|---|---|---|
| **Donations / "buy me a coffee" / gift a friend** | High — matches the mission and the audience's goodwill; museums live on membership/donation | Low ceiling | **Start here** (low-lift, on-brand) |
| **Freemium depth** (free daily; paid unlimited training, archives, extra modes, deep stats) | Medium — depth is our moat; power users exist | Can feel like paywalling learning if drawn wrong | Phase 2, *only* gate convenience/depth, never the daily or the notes |
| **Edu licensing** (classroom mode, teacher dashboards, LMS) | High-value but different product + sales motion | Heavy build, small top-of-funnel now | Later; the students/educators secondary ICP |
| **Museum / brand partnerships** ("this week's collection, presented by X"; co-branded dailies) | Strong brand fit, mission-aligned, non-extractive to users | Requires reach + BD | Once traffic justifies it |
| **Ads** | — | Directly clashes with "we don't exploit you" | **No** |

## Recommendation
A **two-layer** path: (1) **donations/gift now** (goodwill, ~free to build, proves willingness-to-pay signal), then (2) **freemium depth** that gates *convenience* (unlimited training, full archive, richer stats) while the daily + all teaching content stay free forever.

## The one experiment to run now
**"Support Gesso" placement test.** After a user hits a **7-day streak** (a moment of demonstrated value — event `streak_milestone {days:7}`), show a soft, dismissible "*Enjoying your daily museum? Support it / gift a friend*" card linking to a donation page.

- **Hypothesis:** ≥3% of 7-day-streak users click through; ≥0.5% convert to a donation or gift.
- **Why 7-day streak:** value is *proven*, not assumed — the ask lands after delight, not before. Avoids souring activation for new/novice users (the ICP we protect).
- **Instrumentation** (via the wired `track()`): `support_shown`, `support_click`, `support_convert`. Read CTR and conversion by streak length.
- **Success → next step:** if CTR clears the bar, test placement variants and add the "gift a friend" viral angle (a shareable gifted-puzzle link, reusing the existing copy-link mechanic). If it flops, we've learned donation isn't the lever and pivot toward freemium depth or partnerships.
- **Cost:** one card + a link + 3 events. Days, not weeks. Purpose-built as a *measurable* PM experiment, not a revenue plan.

## What this demonstrates (portfolio)
Reasoning about a business model **under a values constraint**, sequencing (goodwill → depth → partnerships), and designing a **falsifiable experiment tied to a value moment** rather than bolting a paywall on day one.
