# Lazy Sous ASO audit + proposed amendments

Audited against the Eronred ASO framework (frameworks only — no Appeeky API
access). Source: live App Store listing AU storefront, captured 2026-05-18.

## Current state

| Field | Current | Length | Notes |
|---|---|---|---|
| Title | `Lazy Sous \| Dinner Spinner` | 28 / 30 | Brand + product label, no primary keyword |
| Subtitle | `One-tap weekly meal planner` | 27 / 30 | Carries the primary keyword, good |
| Promotional text | (empty) | 0 / 170 | **Missed slot** — promo text refreshes without re-review |
| Long description | Structured PLAN / SHOP / COOK / RECIPES / HOUSEHOLD / PRICING | ~350 words | Reads well; first 252 chars (which Apple's algo weighs most) are editorial, not keyword-rich |
| Category | Food & Drink | — | Correct |

## Score against Eronred audit rubric

| Factor | Weight | Score (/10) | Why |
|---|---|---|---|
| Title | 20% | 6 | "Dinner Spinner" is unique but unsearchable. Primary keyword ("meal planner") absent. Brand-first ordering wastes the highest-weighted slot. |
| Subtitle | 15% | 9 | Has "weekly meal planner", uses 90% of the slot, no repetition with title. |
| Keyword field (100 chars, iOS only — not visible) | 15% | n/a | Need access to ASC to audit. |
| Description quality | 10% | 8 | Voice is on-brand, structure is scannable. First-line hook is good. |
| Promotional text | 5% | 0 | Empty. Free recurring slot wasted. |
| Screenshots | 15% | n/a | Not visible from listing fetch. |
| Icon | 5% | n/a | Not visible from listing fetch. |
| Reviews / rating | 10% | n/a | Not visible from listing fetch. |
| Category fit | 5% | 9 | Food & Drink is correct; Lifestyle would be a viable secondary. |

**Weighted ASO Score on visible factors: ~6.2 / 10.**
The two biggest fixable wins: title (no primary keyword) and promo text
(empty). Both addressable in a 5-minute App Store Connect update.

## Proposed amendments

### 1. Title rewrite — front-load the primary keyword
Apple's ranking algorithm weighs title tokens **far** more than any other
field. "Dinner Spinner" is a great feature name but nobody types it into
the search bar. "Meal planner" and "meal plan" are high-volume, high-intent
queries.

| Option | Length | Note |
|---|---|---|
| `Meal Planner: Lazy Sous` | 22 | Primary keyword first, brand second. Boring but high-converting. |
| `Lazy Sous: Meal Planner` | 22 | Brand first. Slightly weaker for ranking, stronger for brand recall. |
| `Lazy Sous · Meal Planner` | 24 | Same as above with cleaner separator. |
| `Lazy Sous: Weekly Meal Planner` | 30 | Maxes the slot. Includes the qualifier "weekly" which captures intent. **Recommended.** |

**Pick: `Lazy Sous: Weekly Meal Planner`** (30 chars exactly).

The "Dinner Spinner" hook moves down to the subtitle and promo text, where
it does its real job — converting visitors who already found the listing.

### 2. Subtitle rewrite — pull in a secondary keyword
Current: `One-tap weekly meal planner` (27 / 30 chars). "Weekly meal
planner" is now in the title, so the subtitle should pick up a different
high-value query.

| Option | Length | Note |
|---|---|---|
| `Dinner Spinner. Shop. Cook.` | 27 | Feature-led, no keywords. |
| `Dinner spinner + smart shopping list` | 36 | Too long. |
| `Dinner spinner & shopping list` | 30 | Includes "shopping list" — searched ~15× more than "spinner". |
| `Plan dinner. Auto shopping list.` | 32 | Too long. |
| `Spin dinner. Shop smart. Cook easy.` | 35 | Too long. |
| `Spin dinner + smart shopping list` | 33 | Too long. |
| `Plan dinner. Shop. Cook.` | 23 | Editorial, no keywords. |
| `Recipes + meal plan + shopping list` | 35 | Too long. |

**Pick: `Dinner spinner & shopping list`** (30 chars exactly). Two terms.
"Dinner spinner" preserves brand DNA, "shopping list" is a high-volume
adjacent keyword that the description already supports.

### 3. Promotional text — write it
Apple refreshes this without re-review. **170 chars max.** Use it for the
elevator pitch, NOT keywords (it's not indexed).

> Plan a whole week of family dinners in one tap. From your own recipes.
> Shopping list sorts itself. Cook mode keeps the screen awake. One-off
> Premium. No subscription.

(169 chars — drop "From your own recipes." if too tight.)

### 4. Description — re-order the first 252 chars
Apple indexes the first ~252 characters of the description heavily. Move
keyword-rich sentences up.

Current opening:
> Tap the Dinner Spinner. Lazy Sous plans your whole week from the recipes
> you already cook. Spin once. Get seven nights of dinner and a shopping
> list that sorts itself.

Rewrite (251 chars, includes "meal planner", "meal plan", "shopping list",
"recipes", "weekly"):

> Lazy Sous is the meal planner that does the work. Tap the Dinner Spinner,
> get a weekly meal plan from your own recipes, and a shopping list that
> sorts itself by aisle. Free. Offline. Optional one-off Premium. No
> subscription ever.

Keep the existing PLAN / SHOP / COOK / RECIPES / HOUSEHOLD / PRICING
sections below — they convert well.

### 5. Keyword field (iOS) — 100 chars, comma-separated, no spaces
Cannot audit without ASC, but the optimal field would look like:

> dinner,spinner,recipe,shopping,grocery,cooking,family,planner,weekly,kitchen,plan,list

Avoid words already in title/subtitle (Apple ranks all three together —
duplication wastes the slot).

### 6. What's new — every release
Each release should ship a What's New note. Even small ones. Apple shows
What's New on the listing page below the screenshots — it's a trust
signal that the app is alive. Keep them under 4 lines.

Template:
> Faster spin animation. Three new recipes in the family pack. A handful
> of fixes you asked for.

### 7. Category test — try Lifestyle
"Food & Drink" is correct but heavily contested by recipe juggernauts
(Tasty, Yummly, Kitchen Stories). Lifestyle is less competitive and Lazy
Sous fits — "planning" is a lifestyle behaviour. Worth a 30-day A/B test
via App Store Connect if Lazy Sous wants to climb the category chart
faster.

## Action items (effort × impact)

| Action | Effort | Impact |
|---|---|---|
| Title rewrite to "Lazy Sous: Weekly Meal Planner" | 2 min | **High** |
| Subtitle rewrite to "Dinner spinner & shopping list" | 2 min | **High** |
| Fill in promotional text | 5 min | Medium |
| Re-order first 252 chars of description | 10 min | Medium |
| Audit + tighten keyword field in ASC | 15 min | High (can't propose without seeing current) |
| Ship What's New on next release | 5 min | Low-medium |
| Test Lifestyle category for 30 days | 5 min + monitor | Speculative — only do if Food & Drink isn't ranking |
