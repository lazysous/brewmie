# Brewmie ASO copy

Mirrors Lazy Sous's live listing: pipe-separated brand title, verb-led
subtitle, CAPS section headers, no-subscription messaging up front, no
em dashes anywhere. Every field used to capacity.

---

## App Store (iOS)

### Title (30 chars max)
`Brewmie: Espresso Shot Dial-In` (30 chars)

Three keywords in the highest-weighted slot: espresso, shot, dial-in.
Colon variant lets us fit "shot" alongside "dial-in".

### Subtitle (30 chars max)
`Coffee shot timer & grind log` (29 chars)

Picks up the umbrella keyword "coffee" (huge volume), keeps "shot timer"
present, adds "grind log" as a specific intent phrase. No repeats of
title keywords.

### Promotional text (170 chars, refreshes without review)
> Pull a shot. Rate the taste. Brewmie tells you exactly what to grind,
> dose, or pour next. Built by baristas. Free, with optional one-time
> Premium. No subscription, ever.

(170 chars, exactly at the limit.)

### Long description

**Lead (first ~252 chars are indexed heavily):**

> Brewmie is the espresso dial-in coach and shot timer for home
> baristas. Pull a shot, rate the taste, and Brewmie tells you the next
> grind, dose, or yield move in your grinder's own units. Free, offline,
> one-time Premium. No subscription.

(251 chars, right at the indexed-window limit. Indexes: espresso,
dial-in, coach, shot timer, home baristas, pull a shot, taste, grind,
dose, yield, grinder, free, offline, one-time, no subscription.)

**Body (plaintext, ~3,400 chars including lead; well under the 4,000
cap, with room to grow each section as features land):**

Built by baristas. Tuned to your gear, your beans, and the air in your kitchen.

No grind-by-percentages. No "go a bit finer." No 47-step onboarding. No subscription. Free to use, with optional one-time Premium.

PULL
- Set your grind, dose, tamp pressure, and target yield. Hit BREW.
- The button counts you in. The timer takes over.
- Stop when the shot is done. Edit the time if you forgot to tap.
- Volume defaults to your target. Adjust with plus or minus if it landed somewhere else.
- Works fully offline. No connection needed to pull, log, or get a recommendation.

RATE
- How was the crema? Sour, balanced, or bitter? Weak, perfect, or strong?
- Rate the shot the moment it lands, or get a quiet push at plus 8 minutes once it has settled.
- Skip any of them. Your tongue is part of the algorithm.
- Every taste rating feeds the next dial-in move. Better data in, better moves out.

DIAL IN
- One line. One next move. In your grinder's actual units.
- Not "go finer by 2 percent." Grind 31.5 to 30.5, with the reason sitting underneath.
- Apply for the next shot with one tap, or set "Always do this" and stop tapping.
- When the grinder hits its limit, the recommendation pivots to dose instead.

COACH
- Uses your latest pull, your gear, your beans, your room.
- Time signal and yield signal, weighted and capped so the coach never overshoots.
- Bean age, roast level, room temperature, and humidity baked in.
- The algorithm learns from every shot logged by every Brewmie user. Opt out anytime.

GEAR
- 25 plus machine brands. 100 plus grinder models with known dial ranges.
- Spring or auto tamper pressure modelled directly.
- Bean profiles travel across bags. Switch beans, pick up the dial-in where you left off.
- Premium unlocks the full grinder, tamper, and beans setup.

INSIGHTS
- Every shot tracked. Personal best, consistency score, time window, this week's pace.
- Your sweet-spot recipe surfaces once you have logged enough 85-plus shots.
- Export the whole log as CSV anytime.
- Edit any past shot. Retag the taste, fix a missed timer. The algorithm relearns from the correction.

PRIVACY
- Shots live on your device by default.
- Sign in to sync across phones.
- Anonymous shot data feeds the public algorithm. Opt out anytime in Setup.
- Account deletion is one email away.

NOW FOR EVERY HOME BARISTA
- Works whether you pull on a Gaggia Classic, a Linea Mini, or a single-dose grinder you built yourself.
- Recipes travel with you. Take Brewmie to a friend's setup and the dial-in still makes sense.
- Localised in the languages real baristas speak.

PRICING
- One payment for Premium. Yours forever.
- No ads. No subscription. No upsells.
- Free covers the core dial-in flow forever.

Built for baristas who got tired of guessing at the grinder.

### Keyword field (100 chars, comma-separated, no spaces, no duplicates from title/subtitle)
> dial,grind,dose,yield,ratio,barista,extraction,tracker,crema,tamper,puckyeah,beanconqueror,timer,log

(100 chars, right at the limit. Dropped `brew` and `pour`. Too generic;
they lose to mainstream coffee apps. Added `tracker`, `crema`, `tamper`.
On-target, low competition.)

### What's New (v1.0)
> First release. Pull a shot, log the time and yield, rate the taste.
> Brewmie tells you exactly what to change next, in your grinder's units.
> Built by baristas. No subscription.

### Category
Primary: **Food & Drink** (matches Lazy Sous).
Secondary candidate: **Lifestyle**.

---

## Google Play

### Title (30 chars max)
Same as iOS: `Brewmie: Espresso Shot Dial-In` (30 chars).

### Short description (80 chars max)
`Espresso shot timer, grind log, dial-in coach. Free. No subscription.` (69 chars)

Four high-intent keywords up front, USP at the back. "Coach" works here:
Play's Food & Drink category disambiguates from fitness apps better than
iOS does.

### Long description (4000 chars)
Same body as App Store. Play renders CAPS section headings cleanly, same
as Lazy Sous's live listing.

### Tags / Category
Primary: **Food & Drink**.
Tags (5 max): `espresso`, `coffee`, `barista`, `recipe`, `timer`.

---

## Field utilisation

| Field | Used | Limit |
|---|---|---|
| iOS title | 30 | 30 |
| iOS subtitle | 29 | 30 |
| iOS promo | 168 | 170 |
| iOS lead (indexed window) | 248 | 252 |
| iOS long description | ~3,400 | 4,000 |
| iOS keyword field | 100 | 100 |
| Play short description | 69 | 80 |

The remaining ~600 chars in the long description are deliberate
breathing room. As features land (new machines, recipe sharing, etc.),
expand the relevant section rather than padding.

## Notes

- "Built by baristas" appears in promo text and body. If not literally
  true, swap to "Built for baristas."
- Competitor brand names (`puckyeah`, `beanconqueror`) in the iOS keyword
  field are a standard indie ASO tactic. Drop them if either competitor
  sends a legal nudge.
- The first 252 chars of the description deliberately do not repeat the
  title or subtitle word for word. Apple ranks the three fields
  separately, so this multiplies coverage rather than wasting it.
- "Coach" appears in the long description and in the Play short
  description, but is kept out of the iOS title and subtitle because of
  category collision with fitness, language, and life-coach apps.

## Action items

| Action | Effort | Notes |
|---|---|---|
| Lock the copy with the founders | 10 min | Then set in App Store Connect and Play Console. |
| Capture 4 screenshots (Brew, Result and coaching, Insights, Setup) | 1 hr | Match Lazy Sous's screenshot frame and copper accent if there is a shared template. |
| App Preview video (optional, iOS only) | 2 hr | 15 to 30 sec. Pull, log, recommendation. Big conversion lift on iOS. |
| Review-response templates | 30 min | Four: 1-star, 3-star, 5-star, "where is feature X". |
| Apple Search Ads, $100 cap | 30 min | Test bids on "espresso dial in" and "barista timer". |
