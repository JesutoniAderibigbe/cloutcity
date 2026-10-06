# Progress log

The loop appends here after each task. Fresh iterations read this first.

## Machine facts (2026-10-06)
- Node v24.19.0, npm 12.0.2 (Next.js 16.3.8 needs Node >= 20.9: OK)
- Docker 29.7.2 installed, Docker Desktop running
- Supabase CLI 2.119.0 installed globally (Homebrew); S01 also adds it as an npm devDependency (`npx supabase`)
- Stripe CLI 1.53.0 installed (Homebrew), **not logged in**
- gh: logged in as JesutoniAderibigbe, WRITE access to internovatechnologies-rgb/cloutcity
- Playwright Chromium: installed (WebKit and Firefox not installed; optional)
- Network: available

## Environment (a human fills this in; the loop may set webgl only, per loop step 10)
Tasks whose `requires` includes an item marked no are blocked with these instructions.
- network: yes
- webgl: no (pending S01: becomes yes when tests/e2e/webgl-smoke.spec.ts passes)
  Unblock: if the smoke fails, follow the README note on Chromium launch flags, then set yes.
- supabase: no
  Unblock (Docker is already running):
  1. After S01 has landed: `npx supabase start`.
  2. Copy API URL, anon key and service_role key from `npx supabase status` into .env.local as
     NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
  3. Set yes.
- realtime: no
  Unblock: supabase above, then confirm `npx supabase status` lists Realtime and
  `npm run check:realtime` passes (added with S29), then set yes.
- stripe: no
  Unblock:
  1. `stripe login` (the user runs this; it opens the browser).
  2. Put test-mode STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY in .env.local, and
     STRIPE_WEBHOOK_SECRET from `stripe listen --print-secret`.
  3. Set yes.
- playwright browsers installed: yes (chromium)
- github: yes
- qa mailbox: no (QA_EMAIL / QA_EMAIL_PASSWORD in .env.local; needed only for deployed-env QA.
  Local magic links use the Supabase mail catcher)
- moderators: MODERATOR_EMAILS in .env.local (comma-separated; default: the user's account)

## Open rulings (user approved defaults on 2026-10-06 unless marked)
- Age (user ruling): anyone plays immediately; the age check is asked only at the first gated
  feature (S17); only the band (under13 / teen / adult) and a timestamp are stored.
- Content (user ruling): all ages. No alcohol, drugs, sexual content or gambling; mild cartoonish crime.
- Clocks: a personal game clock per player, plus shared real NYC city time for shared features.
- Strangers: preset emotes, adults only.
- Realtime vendor: Supabase Realtime behind PresenceTransport, migrating at the cost trigger.
- Visibility: adult guests visible under generated handles; teens visible to friends only;
  unknown and under-13 visible to no one; ghost mode for every 13+ player; the user moderates
  via MODERATOR_EMAILS.
- Music: CC0 only, no radio.
- CAPTCHA: Turnstile on anonymous sign-in in production only (applies to 13+ only).
- Legal: generic labels for branded landmark names and derived subway artwork; everything stays
  `legalReviewed:false` until legal review.
- Out-of-scope list in CLAUDE.md stands.
- Cross-age connections (user ruling 2026-10-06): no friendships, chat, roommates or emotes
  across age bands (teen with teen, adult with adult).
- Payments: Stripe test mode only. Real payouts need a Stripe account in a supported country
  (Stripe does not directly support Nigeria-registered businesses; e.g. a US entity via Stripe
  Atlas). Human step, not a loop task.

## Pinned versions and why (Rule 2)
- three 0.182.0: R3F 9.8.1 uses THREE.Clock (deprecated r183) and PCFSoftShadowMap
  (deprecated r186). Newer three versions warn in the console (PERF-1).
- typescript 6.0.3: typescript-eslint 8.71.1 requires < 6.1.0 (TypeScript 7.0.2 is latest).
- eslint 9.39.5: eslint-plugin-jsx-a11y 6.10.2 supports only up to ESLint ^9.
- Next 16 removed `next lint`: use the ESLint CLI.
(Versions verified against the npm registry by the orchestrator on 2026-10-06.)

## Learnings and gotchas
- Supabase Realtime bills a broadcast to N subscribers as N+1 messages. Keep shards small and
  send intents, not per-frame positions. Presence track() is not for high-frequency data.
- Supabase anonymous sign-ins: 30 per hour per IP by default (shared Wi-Fi and carrier NAT can
  hit it). Raise it in the dashboard for production and add Turnstile.
- Free Supabase projects pause after a week idle. Production needs Pro.
- Headless Chromium renders WebGL in software. Never assert FPS in CI; assert bytes, timings,
  draw calls and triangles.
- docs/local/ is gitignored: put OPEN-ISSUES pointers into iteration notes.
- COPPA: nothing may send a persistent identifier (analytics, error reporting, visit counting)
  before a 13+ answer. Hosting-layer IP logging needs legal review before launch.

## Phase user stories (qa-mafia, Mode A, at phase end)
1. A new visitor on a phone opens the link and sees no age question; accepts Terms, picks audio,
   lands on the 3D map in Queens, takes or skips the tour, buys a first bodega breakfast, finds a
   place via the Places panel, and still plays after going offline and reloading.
2. A player travels by walk, subway and taxi; visits a landmark; is refused then admitted at the
   club door (music and dancing); buys and sells an item; works a shift; pays rent; sees why
   Brooklyn and Manhattan are locked. No age question appears at any point.
3. A player levels up through clout and flexing at a landmark, resolves an all-ages event,
   completes goals, decorates the apartment, and builds an avatar.
4. A player taps "Add friends" and gets the age question. Under-13: friendly "not available"
   messages everywhere and no network calls to Supabase. Teen: picks a handle, invites a teen
   friend, chats until the 10-message limit, blocks and reports, cannot friend an adult. Adult:
   saves progress via magic link, shares a card, views /live.
5. Live city: two adults in two browsers see each other move and exchange emotes; a teen and an
   adult stranger never see each other; two teen friends see each other with no stranger emotes;
   an unanswered or under-13 player sees ambient life only; block, mute, report and ghost mode
   work; going offline degrades to solo; a live event counts down.
6. Premium: under-13 blocked; a teen acknowledges the parental-consent notice; an adult buys in
   Stripe test mode, sees it restored on another device, and loses it on refund.
7. Full smoke test of all of the above on mobile-390.

## Phase reviews
(none yet: phase, qa-mafia verdicts, report paths, PR link)

## Tuning log
(none yet)

## Blocked tasks
(none yet)

## Needs human review
(none yet)

## Iteration notes
(none yet)
