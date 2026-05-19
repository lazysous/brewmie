"""Locked English copy. Single source of truth for all push scripts.
No em dashes anywhere. v2: tighter pitch, no forward-looking subscription
claims, no implicit push-notification promise, no feature dumps.
"""

# Shared brand strings
TITLE = "Brewmie: Espresso Shot Dial-In"  # 30 chars
IOS_SUBTITLE = "Coffee shot timer & grind log"  # 29 chars

# Play rejects "Free." and "No subscription." in the short description as
# promo keywords. Long description still carries both phrases; Play
# permits them there.
PLAY_SHORT_DESC = "Espresso shot timer, grind log, and dial-in coach. Built by baristas."  # 69 chars

IOS_PROMO_TEXT = (
    "Stop guessing at the grinder. Pull a shot, rate the taste, "
    "Brewmie tells you what to change next. Built by baristas."
)  # 117 chars

IOS_KEYWORDS = (
    "dial,grind,dose,yield,ratio,barista,extraction,tracker,crema,"
    "tamper,puckyeah,beanconqueror,timer,log"
)  # 100 chars

DESCRIPTION = """Espresso dial-in coach for home baristas.

Stop guessing at the grinder. Pull a shot, tell Brewmie how it tasted, and get one clear move for the next one. Grind, dose, or yield, in your grinder's actual units, with the reasoning underneath.

Built by baristas. Tuned to your gear, your beans, and the air in your kitchen.

WHAT YOU DO
Set your shot. Hit BREW. The timer takes over. Stop when it's done. Rate the crema and the taste. Brewmie does the rest.

WHAT BREWMIE KNOWS
25 plus machine brands and 100 plus grinder models, with the real dial ranges. Tamp pressure, bean age, roast level, room temperature, humidity, all factored in. Bean profiles travel across bags.

ONE LINE, ONE NEXT MOVE
Not "go a bit finer." Grind 31.5 to 30.5, with the reason sitting underneath. Apply for the next shot with one tap.

INSIGHTS
Every shot tracked. Personal best, consistency score, this week's pace. Sweet-spot recipes surface once you have logged enough good ones. Export your log anytime.

PREMIUM
One payment unlocks every grinder, every tamper, full bean profiles, CSV export, and household sync.

PRIVACY
Shots live on your device by default. Sign in to sync across phones. Anonymous shot data feeds the algorithm. Opt out anytime.

Built for baristas who got tired of guessing."""

WHATS_NEW = (
    "First release. Pull a shot, log the time and yield, rate the taste. "
    "Brewmie tells you what to change next, in your grinder's actual units."
)  # 148 chars

# Pre-flight assertions
assert len(TITLE) <= 30, f"TITLE {len(TITLE)} > 30"
assert len(IOS_SUBTITLE) <= 30, f"IOS_SUBTITLE {len(IOS_SUBTITLE)} > 30"
assert len(PLAY_SHORT_DESC) <= 80, f"PLAY_SHORT_DESC {len(PLAY_SHORT_DESC)} > 80"
assert len(IOS_PROMO_TEXT) <= 170, f"IOS_PROMO_TEXT {len(IOS_PROMO_TEXT)} > 170"
assert len(IOS_KEYWORDS) <= 100, f"IOS_KEYWORDS {len(IOS_KEYWORDS)} > 100"
assert len(DESCRIPTION) <= 4000, f"DESCRIPTION {len(DESCRIPTION)} > 4000"
assert len(WHATS_NEW) <= 4000, f"WHATS_NEW {len(WHATS_NEW)} > 4000"
assert "—" not in DESCRIPTION, "Em dash in description"
assert "—" not in IOS_PROMO_TEXT, "Em dash in promo text"
assert "—" not in PLAY_SHORT_DESC, "Em dash in short description"
assert "—" not in WHATS_NEW, "Em dash in what's new"

if __name__ == "__main__":
    print(f"TITLE              {len(TITLE):3}/30  {TITLE!r}")
    print(f"IOS_SUBTITLE       {len(IOS_SUBTITLE):3}/30  {IOS_SUBTITLE!r}")
    print(f"PLAY_SHORT_DESC    {len(PLAY_SHORT_DESC):3}/80  {PLAY_SHORT_DESC!r}")
    print(f"IOS_PROMO_TEXT     {len(IOS_PROMO_TEXT):3}/170 {IOS_PROMO_TEXT!r}")
    print(f"IOS_KEYWORDS       {len(IOS_KEYWORDS):3}/100 {IOS_KEYWORDS!r}")
    print(f"DESCRIPTION        {len(DESCRIPTION):4}/4000")
    print(f"WHATS_NEW          {len(WHATS_NEW):3}/4000 {WHATS_NEW!r}")
