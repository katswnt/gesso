# Main-study power simulation specification

The excluded pilot does not choose the main study's effect. After the pilot, the owner separately
approves a smallest effect of interest, alpha, target power, sample, and budget before the main-study protocol
freeze.

The simulation may use these conservative pilot nuisance estimates:

- paired within-work variance of the frozen Study B aggregate;
- per-call and per-work missingness;
- exact-identification repeat agreement;
- usable Study A transition/switcher rate;
- eligible-facet count and mask attrition by fame band/cue type;
- evidence-box agreement if that optional method succeeds;
- measured token cost and retry rate.

It must not read the observed correct-cue-minus-sham mean, its sign, a pilot p-value, or which facet
appeared strongest. Code must accept the owner-supplied smallest effect as an explicit parameter and
refuse a missing value. Candidate `n` is simulated under work-level resampling with the frozen hard
strata, missingness/mask process, and clustering plan. The selected `n` is the smallest candidate
meeting the owner-approved power under conservative nuisance bounds, then rounded upward to satisfy
all hard sampling cells.

Pilot works remain excluded from the main manifest regardless of their responses.
