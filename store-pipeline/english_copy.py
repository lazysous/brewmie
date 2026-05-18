"""Locked English copy. Single source of truth for all push scripts.
No em dashes anywhere. Built-by-baristas voice. Espresso-shot focus.
"""

# Shared brand strings
TITLE = "Brewmie: Espresso Shot Dial-In"  # 30 chars
IOS_SUBTITLE = "Coffee shot timer & grind log"  # 29 chars
# Play rejects "Free." and "No subscription." in short descriptions as
# promotional keywords. Long description still carries both phrases; Play
# permits them there.
PLAY_SHORT_DESC = "Espresso shot timer, grind log, and dial-in coach. Built by baristas."  # 69 chars
IOS_PROMO_TEXT = (
    "Pull a shot. Rate the taste. Brewmie tells you exactly what to grind, "
    "dose, or pour next. Built by baristas. Free, with optional one-time "
    "Premium. No subscription, ever."
)
IOS_KEYWORDS = (
    "dial,grind,dose,yield,ratio,barista,extraction,tracker,crema,"
    "tamper,puckyeah,beanconqueror,timer,log"
)  # 100 chars

DESCRIPTION = """Built by baristas. Tuned to your gear, your beans, and the air in your kitchen.

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

Built for baristas who got tired of guessing at the grinder."""

WHATS_NEW = (
    "First release. Pull a shot, log the time and yield, rate the taste. "
    "Brewmie tells you exactly what to change next, in your grinder's units. "
    "Built by baristas. No subscription."
)

# Pre-flight assertions (run on import to catch char-limit regressions)
assert len(TITLE) <= 30, f"TITLE {len(TITLE)} > 30"
assert len(IOS_SUBTITLE) <= 30, f"IOS_SUBTITLE {len(IOS_SUBTITLE)} > 30"
assert len(PLAY_SHORT_DESC) <= 80, f"PLAY_SHORT_DESC {len(PLAY_SHORT_DESC)} > 80"
assert len(IOS_PROMO_TEXT) <= 170, f"IOS_PROMO_TEXT {len(IOS_PROMO_TEXT)} > 170"
assert len(IOS_KEYWORDS) <= 100, f"IOS_KEYWORDS {len(IOS_KEYWORDS)} > 100"
assert len(DESCRIPTION) <= 4000, f"DESCRIPTION {len(DESCRIPTION)} > 4000"
assert len(WHATS_NEW) <= 500, f"WHATS_NEW {len(WHATS_NEW)} > 500"
assert "—" not in DESCRIPTION, "Em dash in description"
assert "—" not in IOS_PROMO_TEXT, "Em dash in promo text"
assert "—" not in PLAY_SHORT_DESC, "Em dash in short description"

if __name__ == "__main__":
    print(f"TITLE              {len(TITLE):3}/30  {TITLE!r}")
    print(f"IOS_SUBTITLE       {len(IOS_SUBTITLE):3}/30  {IOS_SUBTITLE!r}")
    print(f"PLAY_SHORT_DESC    {len(PLAY_SHORT_DESC):3}/80  {PLAY_SHORT_DESC!r}")
    print(f"IOS_PROMO_TEXT     {len(IOS_PROMO_TEXT):3}/170 {IOS_PROMO_TEXT!r}")
    print(f"IOS_KEYWORDS       {len(IOS_KEYWORDS):3}/100 {IOS_KEYWORDS!r}")
    print(f"DESCRIPTION        {len(DESCRIPTION):4}/4000")
    print(f"WHATS_NEW          {len(WHATS_NEW):3}/500 {WHATS_NEW!r}")
