# Flavour Dial-In: diagnosis algorithm v2 (DRAFT for approval)

Status: DRAFT. Nothing in `src/engine.js` changes until this is approved.
Source of ideas: BBE Dial-In `docs/ALGORITHM.md` (v2) and `src/engine/flavour.js`, compared line by line against `src/engine.js` on 2026-11-03.

## 0. Principles kept from v1

1. Taste decides the direction. Shot time decides which lever to pull.
2. One primary change per shot, plus one "then" hint. `changes` on the primary stays machine-readable, so `nextShotFrom` keeps working.
3. Grind advice stays in the user's own grinder units (stepped, stepless, built-in; `finerIs`; learned `sensitivity`).
4. Flavour's own strengths are untouched: the ratio-scaled time window, `learnSensitivity`, `learnRatio`, the overshoot revert, and "Lock it in".

## 1. Decisions already made (2026-11-03)

| # | Decision |
| --- | --- |
| D1 | Salty is neutral (not sour). It only triggers the salty + heavy + short-ratio rule. |
| D2 | Roast ratio ranges apply as a clamp. Start ratio stays 1:2, clamped into the roast's range. Grind-first stays: BBE's "ratio can lead" rule is NOT adopted. |
| D3 | Flavour's ratio-scaled time window is kept. BBE's fixed window is NOT adopted. Only BBE's choking threshold is added. |
| D4 | The channelling sub-algorithm (score and levels) and the prep ladder are ported. The dosing blade and Manual Low Flow are skipped (Barista Express specific). BBE's blade-based dose fit is replaced by a self-reported fill check (D6). |
| D5 | Build order: (1) salty + choking, (2) memory, (3) ratio ranges, (4) prep ladder + channelling + dose fit. One commit each, `npm test` green after each. |
| D6 | (Added 2026-11-03, after approval of sections 1, 6, 7, 14; rank 25 and "+1 only if mixed" decided the same day.) Fill is a per-shot, optional, self-reported check. No basket size or manufacturer dose range is asked for. Dose changes are capped at 0.5 g per shot. Built with item 4 because it shares the "loose puck" channelling signal. See section 7b. |

## 2. Inputs

Unchanged: `notes[]`, `roast`, `dose`, `yield`, `time`, `grind`, `prep` (tamp | wdt_tamp | shaker_tamp | shaker_wdt_tamp), `screen`, `temp`, `profile`.
New: `fill` (optional, per shot: unchecked | level | under | over, default unchecked; section 7b). New: `prev`, the last logged shot of the same coffee **within 7 days** (see section 8). Logged entries gain `cls`, `lever`, `tried[]`.

## 3. Fixed reference values

| Item | Value |
| --- | --- |
| Target ratio, dark | 1:1.5 to 1:1.75 |
| Target ratio, medium | 1:1.75 to 1:2.5 |
| Target ratio, light | 1:2.5 to 1:3.5 |
| Ratio step | 0.25 (replaces the v1 step of 10% of dose per level) |
| Start ratio | `clamp(prefRatio or 2, roast low, roast high)`: dark 1:1.75, medium 1:2, light 1:2.5 until a preference is learned |
| Shot window | unchanged: `lo = max(15, 25 + 4(R-2))`, `hi = max(lo+4, 32 + 5(R-2))` |
| Fast shot (channelling signal only) | `time <= max(12, 12 + 4R)` (20 s at 1:2) |
| Choking | `time >= max(25, 25 + 7R)` (39 s at 1:2) |
| Memory window | 7 days |

Flavour's existing `fast` (below the window) stays for grind decisions. The stricter "fast shot" above is used only for the channelling score, so a 23 s shot is not called channelling.

## 4. Read the cup

- `under`: sour, sharp, lemon, vegetal, vinegar. **Salty is removed.**
- `over`: bitter, ashy, dry, burnt, astringent, medicinal.
- `balanced`: the roast's balanced list (unchanged, including sweet and balanced). Salty is in no list, so it never offsets an off-note in the "mostly balanced, minor note only" test.
- `mixed` = at least one under and one over. `dominant` = the larger side; tie when equal.
- `cls` (stored for memory) = mixed | over | under | balanced.
- Salty alone, or salty with balanced notes, reads as balanced.
- **Salty rule:** salty + heavy (heavy or overpowering) + ratio below the roast's low = the shot was cut off before the sweet phase. Primary: lengthen the ratio to the roast's low edge, keep the grind (key `ratio:longer`).

## 5. Read the shot

- `R` = yield / dose; status short, in range or long against the roast range.
- Flow (grind decisions): `fast` (below window), `slow` (above window), `in`, `unknown` (no time).
- `choking` = time >= choking threshold. A choking shot gets a large coarser step and the label "Grind coarser (choking likely)".
- Channelling score: see section 7.

## 6. Levers and ranks

Lower rank shows first. Primary is the lowest rank, "then" is the next, the rest become notes (two at most). Anything at 60 or above is a note, not a lever.

| Lever | Rank | When |
| --- | --- | --- |
| Dose fit (self-reported) | 25 | the user reports an under- or over-filled basket (section 7b). Below a leading prep rung, above grind |
| Prep rung, leading | 20 | channelling likely or strong, and (mixed + fast, or mixed + flow in window + ratio in range) |
| Grind, flow-driven | 30 | slow, choking, or under with a fast shot |
| Grind, nudge | 32 | flow in window and the v1 rule picks grind (lower half for sour, upper half for bitter) |
| Ratio, flow-in-window | 34 | flow in window and the v1 rule picks yield (upper half for sour, lower half or dark roast for bitter) |
| Body (watery or heavy, balanced cup) | 35 | v1 rule, now bounded by the range |
| Ratio, secondary | 40 | flow wrong in the same direction, or ratio outside the range |
| Prep rung, demoted | 45 | mixed + slow or choking, or mixed + ratio out of range |
| Notes | 60+ | minor off-note, temperature tip, "unusual" notes, tried levers (62) |

## 7. Channelling sub-algorithm (ported)

Signals:

| Signal | Points |
| --- | --- |
| Mixed notes | +3 |
| Fast shot (stricter threshold, section 3) | +2 |
| Under-filled basket (self-reported, section 7b), counted only when the cup is also mixed | +1 |

BBE's third signal, a loose puck, came from the dosing blade. Flavour takes it from the user's own fill check instead, and only when they report `under` and the cup is mixed (the tasting notes already point to channelling). Maximum score is 6; the level cut-offs stay the same. Fast + under-filled without mixed notes scores 2 ("possible"), the same as without the fill report. The evidence for this signal is practitioner interpretation only (section 7b), so the copy still says "likely", never "diagnosis".

- Score 5-6: **strong**. 3-4: **likely**. 2 (fast only): **possible**. Below 2: **none**.
- `channeling` in the result becomes the level (`none | possible | likely | strong`) plus the score. The old boolean is `level is likely or strong`.
- Possible (fast only, not mixed): this is under-extraction from fast flow. If sour, grind finer leads. The next prep rung appears as a note (rank 62). Bitter on a fast shot gets the ratio/grind advice below, not a prep lever.
- Likely or strong: add the next prep rung (section 7a), ranked by section 6.
- Copy always says "likely channelling" or "strong channelling signals", and "a likely cause, not a diagnosis; uneven roasting or a wide particle mix can look the same". Never "diagnosis".

What changes from v1:
- Bitter + fast and sour + slow are no longer flagged as channelling.
- Sour + slow (not mixed): no grind move. Note: "Unusual: slow and sour. Check for late channelling, an uneven grind or a temperature drop before grinding finer." If the ratio has room, the primary is a longer ratio (rank 40, the only lever). If not, the primary is a check-only item (type `check`, no `changes`).
- Mixed + slow still reads as a choked grind: grind coarser, large step if choking. The prep rung is the "then" (rank 45).

What decides how high prep ranks:

| Situation | Prep rank | Why |
| --- | --- | --- |
| Mixed + fast | 20 (primary) | grinding finer would over-extract the channels |
| Mixed + flow in window + ratio in range | 20 (primary) | nothing else is off |
| Mixed + slow or choking | 45 | the clock says grind coarser first |
| Mixed + ratio out of range | 45 | fix the ratio, then prep |

When prep is primary and the cup is not tied, "then" is the grind move in the dominant direction, labelled "only if still off after the prep change". A tied cup gets no grind follow-up.

### 7a. Prep ladder

First rung the user is not already doing. "Level tamp" is bundled into rung 1 (no tamp input).

| Rung | Shown when | `changes` | Evidence note |
| --- | --- | --- | --- |
| 1. Level tamp + WDT | prep has no WDT | `prep: wdt_tamp` (`shaker_wdt_tamp` if shaker already on) | Best-tested fix |
| 2. Blind shaker | no shaker | `prep: shaker_wdt_tamp` | Popular tip, little testing |
| 3. Puck screen | screen off | `screen: true` | Best-tested fix |
| 4. Slow-feed the grinder | rungs 1-3 done | none | Popular tip, little testing |
| 5. Escalate | rung 4 was last shot's advice and the cup is still mixed | grind one small step | see below |

(BBE's Manual Low Flow rung is skipped.)

**Rung 5, escalate:** stop recommending prep. Grind one small step in the dominant direction (coarser if tied). Note: "Prep is maxed. If it still tastes mixed, check bean freshness and try a different bag as a fair test."

Keys: `prep:wdt`, `prep:shaker`, `prep:screen`, `prep:slowfeed`. Always: "Change one thing, then pull again."

### 7b. Dose fit (self-reported)

**Why it is in the algorithm.** Shot time is the engine's main clue for the grind. A badly filled basket changes the flow by itself, so a grind change made to correct it can push the shot the wrong way, and the next well-filled shot then runs wrong. BBE solves this with a calibrated dosing blade. Flavour has no blade and does not know the basket, so it asks the user to say what they saw.

**Evidence grade: practitioner opinion.** The channelling evidence note (2 Nov 2026) lists "higher dose" as "No controlled test found", and Cameron et al. (2020) lowered dose and coarsened the grind together, so the effect of dose alone has not been measured. The note also found that a puck looking even did not predict extraction yield or taste (Decent Espresso), so the check is about fill height, not about whether the puck looks tidy. There is no source at all for the overfill case beyond the physics that a deeper bed resists flow. Consequences:
- Copy says "can" and "tends to", and carries the label "Practitioner advice, not tested".
- Dose is never suggested as a general fix for a thin or watery cup. It appears only when the user reports an under-filled basket (this matches the evidence note: "the app treats it only as the fix for an under-filled basket").

**Input.** `fill`, one optional choice per shot, saved with the shot. No basket size or dose range is asked for, and manufacturer ranges are not used.

| Value | Label shown | Effect |
| --- | --- | --- |
| `unchecked` (default) | Didn't check | none |
| `level` | Looked right | none |
| `under` | Under-filled | dose lever up; +1 channelling signal |
| `over` | Over-filled | dose lever down |

**Rules**
- `under`: primary lever `dose:raise`. Raise the dose by 0.5 g and keep the ratio (new yield = new dose x current ratio, rounded to 0.5 g). Text: "Hold the grind until the fill looks right."
- `over`: primary lever `dose:lower`. Lower the dose by 0.5 g, keep the ratio. Text: "An over-filled basket tends to slow the flow, so judge the grind after the fill looks right."
- Rank 25 (decided 2026-11-03): below a leading prep rung (20), above grind (30). When dose is the primary, the grind lever shown as "then" reads "once the fill looks right".
- Cap: one change per shot, 0.5 g. With no basket range to stop it, the memory rule is the limit: a dose lever is crossed off after two unsuccessful steps (1.0 g in total). It then drops to a note: "Dose has moved 1 g and the basket still looks under-filled (or over-filled). Check that the grounds are levelled and the tamp is level; a different basket may suit this dose."
- `under` adds +1 to the channelling score only when the cup is also mixed (section 7; decided 2026-11-03).
- The app never infers the fill from dose or time. If `fill` is `unchecked` and the shot is (sour and fast), or has a thin or watery note, or is choking, one low-ranked note (rank 62) is added: "Check your fill. An under- or over-filled basket can also cause this." It is not shown when `fill` is `level`.
- Section 10 no longer suggests adding dose for a thin cup.

**Memory.** Keys `dose:raise` and `dose:lower`. Applied = dose moved at least 0.4 g in the advised direction. Improved = the fill report changed to `level`, or the cup improved (section 8). `nextShotFrom` applies the new dose and yield.

## 8. Memory (the logbook)

**Stored per logged shot** (new fields): `cls`, `lever` (the primary's key, or null when locked in), `tried[]` (levers crossed off so far for this coffee).

**Keys:** `grind:coarser`, `grind:finer`, `ratio:shorter`, `ratio:longer`, `prep:wdt`, `prep:shaker`, `prep:screen`, `prep:slowfeed`, `dose:raise`, `dose:lower`. (`grind:revert` for the overshoot revert is never crossed off.)

**Lookup:** `previousShot` returns the latest entry for the coffee key, and memory ignores it if older than 7 days. Overshoot revert uses the same entry and the same limit.
Note: BBE matches roaster + coffee + roast. Flavour's `coffeeKey` is roaster + coffee, so a roast change on the same coffee name would match. Leave as is.

**Order of checks on a new shot:**
1. Overshoot revert (v1 rule) runs first. If it fires, the previous grind lever worked and overshot: do not mark it tried.
2. Was the advice applied? Compare `prev` to this shot:
   - grind: moved in the advised direction (respecting `finerIs`)
   - ratio: moved at least 0.1 in the advised direction
   - dose: moved at least 0.4 g in the advised direction
   - prep keys: the rung is now on
   - `prep:slowfeed`: cannot be checked, counts as applied
   - no `lever` stored: skip memory
3. Improved = mixed became over/under, or anything became balanced. For a dose lever, also improved when the fill report changed to `level`.
4. Outcome:
   - Not applied: repeat the advice, text begins "Last time's change wasn't made."
   - Applied and improved: "You made last time's change and the cup improved. Keep it and carry on."
   - Applied, not improved: add the lever to `tried`. Grind goes one size up once (stepped uncalibrated: level + 1, calibrated: steps x2, within existing clamps). Grind or dose tried twice, or any other lever tried once, drops to a note (rank 62, "You tried this last time and the cup didn't change.").
5. If nothing below rank 60 is left: primary is "No new lever left" (type `hold`, `lockIn` false): pull again to confirm, or try a fresh bag of the same coffee as a fair test.

## 9. Ratio moves (replaces `yieldRec`)

- Direction: bitter (over) = shorter; sour (under) = longer; body rules per section 10.
- New ratio: if outside the roast range, go to the nearest edge. If inside, move 0.25 toward the far edge, never past it. No move possible (already at the edge): the lever is not offered and the next one is promoted.
- Target yield in grams rounds to the nearest 0.5 g.
- The roast range shapes advice and the start ratio only. It never overrides a balanced cup: a balanced shot outside the range is still "Lock it in", and `learnRatio` still learns what the user locks in.

## 10. Body, temperature, finishing

- Balanced cup + thin (and not contradictory): shorter ratio per section 9; if already at the short edge, no further lever. Dose is not suggested for a thin cup (no controlled evidence, section 7b); the only dose advice comes from the fill check. This replaces the v1 hint "try 0.5 g more dose".
- Balanced cup + heavy: longer ratio per section 9.
- Temperature: v1 behaviour (a tip note, only when the machine temperature is adjustable and the primary is not prep). Temperature as a ranked lever is out of scope.
- Minor off-note (mostly balanced): note, as in v1, and it stops the shot reading "Lock it in".
- Nothing to change: "Lock it in".

## 11. Output contract

Keeps: `ok, ratio, window, timeStatus, taste, dir, lockIn, primary, then, notes`.
Adds: `cls`, `channelling {score, level}`, `lever` (primary key or null), `tried`.
`primary` gains `key`. `type` gains `check`. The old `channeling` boolean is kept for the UI as `level is likely or strong` until the UI is updated.
The saved logbook entry stores `fill` from the form and `cls`, `lever`, `tried` from the result. A dose lever's `changes` carries both `dose` and `yield` (change in `src/app.js` near the save at line ~319).

## 12. Worked examples (each becomes a test)

All medium roast, 18 g to 36 g (1:2.0, window 25-32 s, fast <= 20 s, choking >= 39 s), prep `wdt_tamp`, no screen, unless stated.

1. **Salty alone**, 28 s: balanced, "Lock it in". (v1: grind finer.)
2. **Salty + heavy, ratio short:** 18 g to 28 g (1:1.56), 24 s: primary lengthen ratio to 1:1.75, stop around 31.5 g, grind unchanged.
3. **Salty + sour, 28 s:** sour only counts; salty does not offset it. Normal sour advice.
4. **Mixed + fast, strong:** notes sour, sour, bitter; 19 s; prep `wdt_tamp` + screen. Score 5. Primary prep rung 2 (shaker, `prep: shaker_wdt_tamp`). Then: grind finer, "only if still off after the prep change".
5. **Mixed, in window, ratio in range:** sour + bitter, 28 s. Score 3, likely. Primary rung 2 (blind shaker). Wording says "likely", not "diagnosis".
6. **Mixed + slow:** sour + bitter, 36 s. Grind coarser small step (primary). Then: prep rung (demoted).
7. **Choking:** bitter, 41 s. Grind coarser, large step, label "choking likely".
8. **Sour + slow:** sour, 36 s. No grind finer. Primary longer ratio 1:2.25 (40.5 g). Note "Unusual: slow and sour". Not flagged as channelling.
9. **Sour + fast, possible:** sour, 19 s. Score 2. Grind finer leads (v1 behaviour). Next prep rung (shaker) appears as a note.
10. **Bitter + fast:** bitter, 19 s, prep shaker + WDT + screen. Score 2, possible, not channelling. Primary shorter ratio to 1:1.75 (31.5 g). No prep lever.
11. **Ladder exhausted:** prep shaker + WDT + screen; previous.lever `prep:slowfeed`; sour + bitter, 28 s. Rung 5: grind one small step in the dominant direction (coarser if tied) + fresh-bag note.
12. **Memory, not applied:** previous.lever `grind:finer` at grind 10, this shot still at 10. Primary repeats grind finer, text "Last time's change wasn't made."
13. **Memory, applied, no better:** previous.lever `grind:finer` (cls under), grind moved finer, still under. `tried = ['grind:finer']`; next grind step is one size up. Second failure: grind drops to a note, next lever promoted.
14. **Memory, applied and improved:** previous cls mixed, now under. Message "the cup improved", lever not crossed off.
15. **Overshoot beats memory:** previous sour at 10 with lever `grind:finer`, now bitter at 8. Revert to 9. `tried` stays empty.
16. **Ratio clamps:**
    - Dark, bitter, 1:2 (above 1.75): shorten to 1:1.75 (31.5 g).
    - Light, sour, 1:2 (below 2.5): lengthen to 1:2.5 (45 g).
    - Medium, bitter, ratio exactly 1.75: ratio cannot move; grind is offered instead.
17. **Start ratio:** no pref: dark 1.75, medium 2, light 2.5. A learned pref of 2.0 on a dark roast starts at 1.75.
18. **Balanced outside the range** (dark, 1:2, chocolate): "Lock it in", not a ratio change.
19. **Memory expiry:** previous shot 8 days old is ignored.
20. **Under-filled, sour, fast:** fill `under`, sour, 19 s, prep `wdt_tamp`. Primary raise dose to 18.5 g, stop around 37 g (ratio 1:2 kept), grind unchanged. Then: grind finer, "once the fill looks right". Dose (25) outranks grind (30). Channelling: fast 2 only, possible (the +1 needs mixed notes).
21. **Over-filled, slow, bitter:** fill `over`, bitter, 36 s. Primary lower dose to 17.5 g, stop around 35 g. Then: grind coarser, "once the fill looks right".
22. **Mixed + fast + under-filled:** sour, bitter, 19 s, fill `under`. Score 3 + 2 + 1 = 6, strong. Primary: the prep rung (rank 20). Then: raise dose (rank 25).
23. **Dose cap:** shot 1 under-filled: raise to 18.5 g. Shot 2 (18.5 g, applied, still under): raise to 19 g, `tried = ['dose:raise']`. Shot 3 (19 g, applied, still under): `tried` has two, so the dose lever drops to a note ("Dose has moved 1 g...") and the next lever is promoted.
24. **Fill unchecked, sour + fast:** normal sour advice (grind finer) plus one rank-62 note, "Check your fill". No dose lever.
25. **Fill `level`:** same shot as 24 gives no note and no dose lever.
26. **Thin, balanced cup at the short ratio edge:** no dose suggestion (v1 suggested 0.5 g more dose).
27. **Fill is saved and remembered:** a logged shot with `fill: under` and `lever: dose:raise` is read back by the next shot of that coffee.

## 13. Test plan

- One test per worked example above (examples 20-27 cover the fill check).
- `nextShotFrom` applies `dose` and `yield` together for a dose lever.
- Existing `test/engine.test.js` tests to rewrite because the behaviour changes on purpose: "bitter + fast shot flags channeling and fixes prep, not grind" (line 40), "sour + slow shot does not say grind finer" (46), "sour + slow with maxed prep falls back to a longer shot" (51), "mixed sour + bitter: fix prep first, then slow-feed when prep is maxed" (82). Any test that asserts a 10%-of-dose yield step.
- Existing tests that must stay green unchanged: in-window sour/bitter (64, 70, 75), contradictory body, stepless/stepped grind output, calibrated sensitivity, overshoot (149), temperature (156), learnSensitivity, nextShotFrom, learnRatio.
- Service worker cache bumps to `brevista-dialin-v7` with the first engine commit.

## 14. Assumptions to confirm

1. Memory window of 7 days also applies to the overshoot revert (v1 had no limit).
2. Ratio step of 0.25 replaces the v1 step (10% of dose per level, 0.5 g rounding). Gram targets will differ from v1.
3. "Sour + slow, no ratio room" falls back to a check-only primary (`type: check`).
4. A learned preferred ratio outside the roast's range is clamped for the start suggestion only; the user's locked-in recipes are never changed.
5. Fast-only shots (score 2) show the next prep rung as a note, not as a lever.
6. The saved-entry change (`cls`, `lever`, `tried`) needs no migration: old entries without `lever` simply skip memory.
7. Dark-roast extras from BBE (WDT note, degassing reminder) and temperature as a ranked lever are out of scope for this round.

Added after approval (fill check, section 7b):

8. Fill is self-reported only. No basket size or dose range is asked for, and the app never infers fill from dose or time.
9. (Decided 2026-11-03.) The dose-fit lever ranks 25, below a leading prep rung and above grind, because the evidence is practitioner opinion only.
10. (Decided 2026-11-03.) A reported under-fill adds +1 to the channelling score only when the cup is also mixed.
11. A dose lever is crossed off after two unsuccessful steps (1.0 g in total), because there is no basket range to cap against.
12. The v1 hint "try 0.5 g more dose" for a thin cup is removed, because the evidence note found no controlled test of dose.
13. Over-fill advice (lower the dose) has no source beyond the physics of bed resistance. Its copy is labelled "plausible, not tested".

## 15. Not ported

The dosing blade, its dose-fit step and basket band (replaced by the self-reported fill check, section 7b), Manual Low Flow, inner/outer burr wording, BBE's fixed shot window, and BBE's "ratio can lead" rule.

## 16. Offered back to BBE later

`learnSensitivity` (seconds per grind step learned from the user's own shots) and the overshoot revert.

## 17. Explainer copy: "Fill the basket for your coffee" (approved)

Shown once in grinder setup, and reachable again from a "How to fill" link beside the fill check.

> **Fill the basket for your coffee**
>
> Beans differ in density. Light roasts take up less space than dark roasts, even when the weight is the same.
>
> After a firm, level tamp, the puck should sit a small, even distance below the shower screen. It should neither touch the screen nor leave a big empty space above it.
>
> Too little coffee, and the shot can run fast and thin, and the puck is easier to disturb.
>
> Too much coffee presses the puck against the screen. The shot can run slow and be hard to read.

In-shot prompt beside the fill check: "Optional. Skip it if you didn't look."
Result-card note (rank 62, only when fill is unchecked): "Check your fill. An under- or over-filled basket can also cause this."
