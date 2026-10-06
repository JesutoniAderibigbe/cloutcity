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
- webgl: yes (S01 webgl-smoke passes with --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader)
- supabase: yes (local stack started 2026-10-06 via `npx supabase start`; .env.local has
  NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and
  MODERATOR_EMAILS. If Docker restarts: `npx supabase start`. imgproxy and pooler are stopped; not needed.)
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
- Age (user ruling, from the user's manager): adults only (18+). The welcome card on first open asks a
  neutral year of birth before play; under 18 sees an in-voice "come back when you're 18" screen,
  the gate locks on that device for 24 h, and no Supabase user is created. Only an attestation
  boolean and timestamp are stored, never the birth year.
- Content (user ruling): nightlife and alcohol as flavour only, never rewarded, required or tied
  to a stat; no drugs, sexual content or gambling; mild profanity only.
- Clocks: a personal game clock per player, plus shared real NYC city time for shared features.
- Strangers: preset emotes only.
- Realtime vendor: Supabase Realtime behind PresenceTransport, migrating at the cost trigger.
- Visibility: guests visible under generated handles; ghost mode for everyone; the user moderates
  via MODERATOR_EMAILS.
- Music: CC0 only, no radio.
- CAPTCHA: Turnstile on anonymous sign-in in production only.
- Legal: generic labels for branded landmark names and derived subway artwork; everything stays
  `legalReviewed:false` until legal review.
- Out-of-scope list in CLAUDE.md stands.
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
- Six lanes running builds/e2e at once overloaded this 10-core Mac (load avg up to ~85): tests hit
  5 s timeouts and API calls stalled. Heavy steps (npm test, build, e2e) now go through a shared
  2-slot queue script (orchestrator scratchpad `heavy.sh`); never raise timeouts to compensate.
- NYC Open Data (Socrata) and nyc.gov return 403 from this machine; geo:build uses NYC DCP's ArcGIS
  FeatureServer + MTA S3. The download cache lives in .cache/geo (gitignored); copy it between
  worktrees or run `npm run geo:build` with network. `geo:build -- --check --offline` verifies outputs.
- MTA GTFS quirks: Q/N/R shapes end ~103 m short of 96 St (terminal extension); Q03/Q04 sit 4–4.5 m
  off their shapes. NTA QN0151 (Rikers) has BoroName Bronx but CDTA QN01; Marble Hill station 106 is
  borough manhattan but zone bx08.
- src/lib/geo uses relative `.ts` imports so Node scripts can load it; src/lib/data/geo.ts (classic
  zod + all layers) is never imported by client code.
- zod/mini must be imported as a namespace: `import * as z from 'zod/mini'`. `import { z }` makes
  Turbopack bundle all of zod/mini incl. locales (~92 KB gz). client-imports.test.ts enforces it.
- Playwright: use page.clock.setFixedTime only; clock.install() fakes rAF and hangs the console
  guard's settle. Playwright's getByRole does not skip inert content; check for an [inert] ancestor.
- Onboarding lives in its own store (cloutcity:onboarding v1), separate from the game save, so it
  survives game-save repair/migration. E2E fixture option `onboarding: 'complete' | 'fresh'`.
- Client code validates with `zod/mini`; classic zod in the shell costs ~90 KB gz (blew the 180 KB
  budget). Never import `@/lib/data/config` or classic schemas from client-reachable modules
  (src/lib/client-imports.test.ts enforces it). Server/scripts may use classic zod.
- Expected storage conditions (private mode, quota, corrupt save) log at `info`; the e2e console
  guard fails on warnings, so reserve `warn` for real problems.
- Copy cannot contain literal `{` or `}` (placeholder rule); add an escape if ever needed.
- Any `Intl` reference, toLocale*/toFixed/toPrecision, or `$`-prefixed template/concat outside
  src/lib/format.ts is a lint error: money and counts go through formatMoney/formatCount.
- Superlatives in copy only via superlative(kind, subjectId, values) (needs ≥2 distinct ids).
- src/engine is pure and lint-enforced: no Date/Reflect/self/globalThis/timers/fetch, no Math.random,
  no dynamic import/require, no imports of state/components/scene/realtime/server/app (any path form).
  Time is injected; city-time parts come from wallClockParts in src/lib/format.ts.
- Saves: a newer-build save is never overwritten without discardNewerSaveAndStartFresh(); invalid
  fields are repaired (speed→1x, remainder→0, stats clamped), only structurally broken saves start
  fresh; storage is written only on meaningful changes (minute, stats, cash, speed), not every tick.
- e2e serves on port 3100 (E2E_PORT) because 3000 is taken on this machine; reuseExistingServer
  is on outside CI, so make sure nothing stale is serving on 3100 before trusting a run.
- SwiftShader always logs "GPU stall due to ReadPixels" at warning level for a visible WebGL
  canvas; the console guard allowlists exactly that text, warning type only.
- The console guard waits 2 rAF + consoleSettleMs (250 ms) after each test; errors later than that
  are not caught by design. Raise consoleSettleMs per spec if a flow has late async work.
- Playwright 1.63 needed `npx playwright install chromium` (headless shell v1243).
- log.ts scrubs emails (incl. %40), Bearer/JWT tokens and sensitive URL params in every string;
  free-text like "code=404" is over-redacted on purpose.
- Supabase Realtime bills a broadcast to N subscribers as N+1 messages. Keep shards small and
  send intents, not per-frame positions. Presence track() is not for high-frequency data.
- Supabase anonymous sign-ins: 30 per hour per IP by default (shared Wi-Fi and carrier NAT can
  hit it). Raise it in the dashboard for production and add Turnstile.
- Free Supabase projects pause after a week idle. Production needs Pro.
- Headless Chromium renders WebGL in software. Never assert FPS in CI; assert bytes, timings,
  draw calls and triangles.
- docs/local/ is gitignored: put OPEN-ISSUES pointers into iteration notes.

## Lanes and slice plan (user decisions 2026-10-06)
Goal: a **playable solo slice** first (welcome card, 3D map, travel, jobs, rent, shop, clout,
events), then the rest. Up to six lanes, full testing on every task.
- Lane A (worktree lane-a, 3100): S05a ✓ → S05b → S05 (needs S04a) → S06 (main checkout is integration-only from now on)
- Lane B (lane-b, 3101): S04 → S04a → S04c → S04b → S04d
- Lane C (lane-c, 3102): S11 ✓ → S10 ✓ → S12 → S10a (needs S09)
- Lane D (lane-d, 3103): S14 → S13 (needs S10)
- Lane E (lane-e, 3104): S07 → S09 → S07a
- Lane F (lane-f, 3105): S08 (needs S04 merged)
Slice = S01–S06 minus S04e, plus S07, S07a, S08–S14. After the slice: S04e, S07b, S15, S16, S16a,
then phases 4–7. Slice PR "Playable slice" opens when all slice tasks pass.

## Phase user stories (qa-mafia, Mode A, at phase end)
1. New visitor on a phone: opens the link, passes the 18+ welcome card, picks audio, lands on the
   3D map in Queens, takes or skips the tour, buys a first bodega breakfast, finds any place via
   the Places panel, still plays after going offline and reloading. An under-18 answer is refused
   with the in-voice screen and stays locked on reload.
2. Player travels by walk, subway and taxi; visits a landmark; is refused then admitted at the
   club door; buys and sells an item; works a shift; pays rent; sees why Brooklyn and Manhattan
   are locked.
3. Player levels up through clout and flexing at a landmark, resolves an event, completes goals,
   decorates the apartment, builds an avatar in the creator.
4. Player saves progress via magic link and keeps it; picks a handle; adds a friend by invite;
   chats until the 10-message limit; blocks and reports; shares a card; views /live.
5. Two players in two browsers see each other move in the same neighborhood; block, mute,
   report, ghost mode and emotes work; the city degrades to solo when offline; a live event
   counts down.
6. Player browses premium items, buys one in Stripe test mode, sees it restored on another
   device, and loses it on refund.
7. Full smoke test of all of the above on mobile-390.

## Phase reviews
(none yet: phase, qa-mafia verdicts, report paths, PR link)

## Tuning log
- S03 placeholders (TUNE-1): decay per game hour energy 3, hunger 5, mood 2; start stats 100/80/70;
  at-zero penalties (hunger 0: +3 energy/+4 mood drain per h; energy 0: +3 mood drain, 1.5x duration;
  mood 0: 1.25x duration); catalog sleep 480 min +80 energy +5 mood, nap 60 min +15 energy,
  bodega-breakfast 20 min $6 +40 hunger +5 mood, home-meal 45 min $4 5 energy +50 hunger,
  walk-in-the-park 60 min 10 energy +15 mood.

## Blocked tasks
(none yet)

## Needs human review
(none yet)

## Iteration notes
- S01 (attempt 1, passed): Next 16.3.8 / React 19.3.0 / TS 6.0.3 / Tailwind 4.3.3 scaffold with
  pinned three 0.182.0, R3F 9.8.1, drei 10.7.9; ESLint 9 flat config (jsx-a11y, no-console),
  Prettier, Vitest 5, Playwright 1.63 (mobile-390, desktop-1280); shared e2e fixture with console
  guard + axe; PWA manifest and icons; bottom tabs; overlay layer system (data/config/layout.json);
  structured logger with redaction; budget script (136 KB / 180 KB shell JS); supabase/config.toml.
  Two bug-hunter fix cycles: logger value scrubbing (P1, P3) and console-guard settle window (P2).
  Gates: 96 unit, 70 e2e, build, budget all green. Placeholder tab/HUD copy and palette tokens
  are hardcoded: S02 moves them into /data/copy and data/config/theme.json.
  OPEN-ISSUES: RISK-1 npm audit (dev-only), RISK-2 darwin-only screenshot baselines, RISK-3
  stats-gl nested three, NOTE-1 port 3000, NOTE-2 blocked install scripts, NOTE-3 allowlist.
- S02 (attempt 1, passed): /data folders with zod schemas (src/lib/data/schemas, loaders in
  src/lib/data), perf.json with every CLAUDE.md budget (test reads CLAUDE.md), theme.json → CSS
  vars, realtime/moderation/balance/layout/copy config, placeholder seeds; copy layer with nyc and
  plain slang packs; formatMoney/formatCount + strict lint rule; superlative scanner and computed
  superlative(); Zustand store (cloutcity:game v1, migrate, zod/mini merge) with never-throwing
  storage. One fix cycle (superlative ranks, lint bypasses, all-file-type data check, malformed
  placeholders, integer counts, info-level storage logs). Gates: 253 unit, 76 e2e, build, budget
  137.4 KB. The store is not read by any UI yet (S03/S05 wire it).
  OPEN-ISSUES: DEC-9 zod/mini on client, TUNE-1 placeholder numbers.
- S03 (attempt 1, passed): pure engine in src/engine (clock with integer-microsecond remainder,
  1x/2x, hidden pause, 5 s tick cap; calendar + midnight/rent-week rollovers; stats decay per game
  hour with stacking at-zero penalties; validated actions with typed errors; city time via
  wallClockParts; save v2 with migrate from v1 and field repair); store actions tick/performAction/
  setSpeed/discardNewerSaveAndStartFresh; clockDriver (not started by any UI yet — S05 wires it).
  One fix cycle: purity-lint bypasses, newer-save overwrite guard + meaningful-change-only writes,
  repair-instead-of-discard, float carry. Test change by ruling: store.test.ts "repairs a negative
  remainder / a remainder of a whole game minute" now expects repair (was "starts fresh").
  Gates: 446 unit, 76 e2e, build, budget 137.4 KB. Catalog actions have no copy names yet.
- S05a (attempt 1, passed): welcome card over the scene — neutral year picker (only ≤ Y−19 passes),
  consent with Terms/Privacy (placeholder routes), audio choice; under-18 → in-voice lock for 24 h,
  no Supabase; 18+ → local attestation/consent/audio record (never the year); startGuestSession hook
  (local mode only; S05 adds Supabase); shared form pattern; modal overlay layer + OverlayBackground
  inert + focus trap; e2e fixture seeds onboarding. Orchestrator fixes: zod/mini namespace imports in
  src/engine/actions.ts and save.ts. Gates: 502 unit, 210 e2e, build, budget 161.7 KB.
  OPEN-ISSUES: DEC-9 update, Q-5 re-consent, Q-6 Y−18 ruling, RISK-2 baselines; low: storage log text
  says "saved game" for onboarding data.
- S04 (attempt 1, passed on lane-b, merged): reproducible geo:build from hash-locked DCP borough/NTA
  layers + MTA GTFS → derived land, water, parks, subway (29 lines, 496 stations) and 71 CDTA zones;
  SOURCES.md; ENU projection (cc-enu-v1, origin 40.7/−73.98); base geo 137 KB gz. Bug-hunter: 0
  product failures. Merge conflicts in data.test.ts and schemas/config.ts resolved (kept both).
- S11 (attempt 1, passed on lane-c, merged): four shift jobs at the wage anchors, weekly rent with
  late fees and eviction to the lowest-rent home, clout-level gating helper src/engine/clout.ts, save
  v3. Bug-hunter: 0 product failures. Copy JSON conflicts with S05a resolved (kept both).
  OPEN-ISSUES: UX-4 eviction wording, TUNE-2 placeholders.
- S10 (attempt 1, passed on lane-c, merged): 12 wearables (3 rarities, 5 slots) + 3 gifts, cash only;
  resale floor(price × resalePct) depreciating 5%/game day to a 50% floor; own-once wearables, stacking
  gifts; effects once per owned copy on first wear; gifts to 'yourself' or a branded NpcId only; save
  v4 inventory. Bug-hunter: 0 product failures (low: tampered worn:false can re-grant an effect; v3 save
  carrying inventory starts fresh). No UI yet → S10a. Gates on dev: 1010 unit, 210 e2e, budget 163.9 KB.
- S07 (attempt 1, passed on lane-e, merged): 5 boroughs with config-driven clout gating (Brooklyn at
  local, Manhattan at scene-regular, Bronx/SI expanding soon); 27 landmarks (Wikidata P625, verified
  within 1 m by bug-hunter; generic labels for branded names; 9/11 Memorial strict look-only); 24
  invented venues (corner-halo-deli renamed late-lantern-deli); engine boroughs.ts/places.ts;
  client-safe src/lib/world/places.ts. 3D render sub-clauses moved into S04c's acceptance (orchestrator
  note). Gates on dev: 1238 unit, 210 e2e, budget 167.4 KB (copy growth → S05c).
  OPEN-ISSUES: LEGAL-1 list, STN-1, "Ninth Hour Coffee" flag.

