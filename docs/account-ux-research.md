# Account UX Research — patterns from award-winning & best-in-class apps

Research date: 2026-08-16. Purpose: guide the Kalsa Account section design
(optional, Pro UI-only, store-aware login, i18n EN/IT).

## Pattern 1 — Social-first login hierarchy (consumer apps)

Consumer apps put social login (Google, Apple) as the PRIMARY CTAs and email
below, separated by an "or continue with email" divider. Hierarchy should
reflect the audience's actual usage split. For Kalsa: the store-derived provider
(Google on Play, Apple on App Store) is the hero button; email is the secondary
path; on sideload (no store detected) email becomes primary and the store
providers are shown disabled with an explanation.

- Source: https://muz.li/inspiration/login-screen/ (Login screen UX, social vs email)

## Pattern 2 — Account entry from the drawer header

Top apps (Booking.com, Airbnb, Spotify) treat the account as a header element:
avatar + name at the top of the drawer/menu, tapping it opens the account. A
dedicated "Account" item in the drawer list also works when the header is busy.
For Kalsa: avatar chip in the Drawer header (when signed in) + dedicated
"Account" item in the drawer items list (consistent with Settings/Documents/Notes).

- Source: https://medium.com/design-bootcamp/designing-profile-account-and-setting-pages-for-better-ux-345ef4ca1490
- Source: https://mobbin.com/explore/mobile/screens/my-account-profile (4300+ account screens)

## Pattern 3 — Avatar with a designed empty state

Mobbin's avatar study (8200+ components): always design the default/empty state.
Initials-based avatar (name-derived monogram) is the standard when no photo is
available; colored circle with initials beats a grey silhouette for recognition.

- Source: https://mobbin.com/glossary/avatar

## Pattern 4 — Paywall: clarity, value-first, price transparency

Qonversion paywall guide: (1) clarity & simplicity — short benefit sentences,
one prominent CTA ("Unlock Pro"); (2) value proposition upfront — icons +
feature bullets, sell benefits not features; (3) price transparency — price
prominently displayed, billing cycle explicit ("billed monthly"), cancel-anytime
reassurance; (4) 1-2 tiers max with a "Best value" badge; (5) local currency;
(6) minimize FUD (fears, uncertainties, doubts). Kalsa Pro screen: hero value
statement, 3-4 benefit rows with icons, price + billing cycle, CTA, small print
(cancel anytime). No real billing — CTA is UI-only per product decision.

- Source: https://qonversion.io/blog/paywall-design-uiux-examples

## Pattern 5 — Profile + plan status together

Eleken profile-page analysis: the account screen shows identity (avatar, name,
email) AND current plan/payment status in one place, with the plan state as a
prominent card. Kalsa: signed-in state shows a "Current plan: Free" card with an
"Upgrade to Pro" path; signed-out shows the login options first.

- Source: https://www.eleken.co/blog-posts/profile-page-design

## Pattern 6 — Error clarity & keyboard correctness

Login UX failures that matter: unclear error messages ("Incorrect email or
password", not "Login failed"), email fields use the email keyboard type, avoid
over-designing the login screen. Kalsa email mock: validate email format with a
clear inline error, `keyboardType="email-address"`, `autoCapitalize="none"`.

- Source: https://muz.li/inspiration/login-screen/

## Pattern 7 — Accessibility in settings/account surfaces

Account settings must keep good color contrast, screen-reader labels, and
tappable target sizes. Kalsa: use existing theme tokens (no new colors),
accessibilityRole/labels on buttons and login options, hit targets ≥ 44dp.

- Source: https://bricxlabs.com/blogs/account-settings-design-examples

## Pattern 8 — Progressive disclosure, not a hard gate

Best paywalls are soft, not hard: the app keeps working without an account (the
feature is optional, no forced sign-in). Account/Pro is presented as an upgrade
path, never as a blocker. Kalsa requirement: account is optional by design.

- Source: https://www.revenuecat.com/blog/growth/guide-to-mobile-paywalls-subscription-apps
- Source: https://apphud.com/blog/design-high-converting-subscription-app-paywalls

## Application to Kalsa (concrete)

- Screen hierarchy: Drawer → "Account" item → AccountScreen (overlay, same
  pattern as Settings).
- Signed-out: hero login button = store provider (Google on Android, Apple on
  iOS App Store/TestFlight distribution builds), divider "or continue with
  email", email field (email keyboard, inline validation), disabled provider
  pair with note when the store source is "none" (iOS debug/ad-hoc/sim).
- Signed-in: initials avatar, email, "Current plan: Free" card with "Upgrade to
  Pro" CTA, Pro screen (value statement, 4 benefit rows, price + billing
  cycle, CTA, cancel-anytime small print), Sign out.
- Note: Pattern 2's drawer-header avatar chip was NOT implemented (dedicated
  drawer item instead — would require lifting account state to AppShell).
- Note: on iOS, TestFlight builds report "apple" (App Store distribution
  profile) — a product decision; only debug/ad-hoc/sim report "none".
- Note: Android Play detection uses the Play Install Referrer API (Play only
  serves referrer data for packages it installed): success → "google", any
  rejection/timeout → "none" → email-only. Debug builds installed via adb
  therefore show email-only, which matches the sideload rule.
- Persistence: local only (AsyncStorage/SecureStore), no backend — "not
  connected to anything" per product decision.
- All strings through i18n (en.ts + it.ts); no hardcoded UI text.
