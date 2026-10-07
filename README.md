# Clout City: NYC

**Tap In. Blow Up.** A mobile-first, browser-based, stylised-3D life game set in a shared, live
New York City. Rules for contributors and agents live in `CLAUDE.md`; the build plan is
`docs/spec/PLAN.md` and the task list is `prd.json`.

## Setup

Requirements: Node 24 (Next.js 16.3 needs >= 20.9; the scripts use Node's built-in TypeScript
support) and npm.

```bash
npm ci
npx playwright install chromium   # browser for e2e, once per Playwright version
npm run dev                       # http://localhost:3000
```

No environment variables are needed for the shell. Env files (`.env`, `.env.local`, ...) are
gitignored; later tasks document their variables here.

| Variable                | Used by                                                           | Default                              |
| ----------------------- | ----------------------------------------------------------------- | ------------------------------------ |
| `NEXT_PUBLIC_LOG_LEVEL` | `src/lib/log.ts` minimum level (`debug`, `info`, `warn`, `error`) | `debug` in dev, `info` in production |
| `E2E_PORT`              | Port Playwright serves the production build on                    | `3100`                               |

## Scripts

| Script                            | What it does                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev` / `build` / `start` | Next.js dev server, production build, production server                                                                                 |
| `npm run typecheck`               | `next typegen` then `tsc --noEmit` (strict)                                                                                             |
| `npm run lint`                    | ESLint CLI (flat config): Next core-web-vitals + TypeScript, full jsx-a11y recommended set, `no-console` as an error                    |
| `npm run format:check` / `format` | Prettier check / write                                                                                                                  |
| `npm test`                        | Vitest unit tests (`*.test.ts` next to the code)                                                                                        |
| `npm run e2e`                     | Playwright specs in `tests/e2e`, against a fresh production build on `E2E_PORT`                                                         |
| `npm run budget`                  | Gzipped shell JS of `/` and the lazy 3D chunk against `data/config/perf.json`, and no test hooks in `.next` (run after `npm run build`) |
| `npm run geo:build`               | Downloads the pinned geo sources and rebuilds `data/geo` and `data/zones` (see Geo data)                                                |

Gate order used by the build loop:
`npm run format:check && npm run typecheck && npm run lint && npm test && npm run build && npm run e2e && npm run budget`

## End-to-end tests

- Projects: `mobile-390` (390x844, touch, mobile viewport) and `desktop-1280` (1280x720).
- Import `test` and `expect` from `tests/e2e/fixtures/test.ts`, never from `@playwright/test`.
  The fixture fails any test that logs a console warning or error or throws an uncaught page
  error (PERF-1), and provides `checkA11y()`, an axe scan that fails on serious or critical
  violations (A11Y-2).
- A test that provokes a console message on purpose (a failure path) lists it with
  `test.use({ expectedConsole: [...] })`: each entry names the exact console type and the text
  (a string matched exactly, or a RegExp; an object argument such as a `src/lib/log.ts` record is
  also matched as JSON) and optionally an exact `count`. Matching messages are let through, but
  every entry must appear, and anything else still fails. Wrap two or more entries as
  `[[a, b], { scope: 'test' }]` (Playwright reads a bare two-entry array as a fixture tuple).
- Screenshot baselines live in `tests/e2e/__screenshots__/` and are per platform. After an
  intended visual change, review the diff and run `npx playwright test --update-snapshots`.

### Headless WebGL in Playwright

Headless Chromium has no GPU, so WebGL2 runs on SwiftShader, Chromium's CPU implementation
(ANGLE on SwiftShader Vulkan). Chromium has deprecated the _automatic_ SwiftShader fallback for
WebGL, so `playwright.config.ts` opts in explicitly for every project:

```
--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader
```

- `--use-gl=angle --use-angle=swiftshader` makes SwANGLE (ANGLE + SwiftShader Vulkan) the GL
  driver, so every machine and CI runner renders with the same software stack.
- `--enable-unsafe-swiftshader` is the opt-in for WebGL on SwiftShader. Without it, recent
  Chromium logs a deprecation warning (which would trip PERF-1) and will eventually refuse to
  create the context. "Unsafe" refers to running untrusted content; we only load our own app.

Source: [Using Chromium with SwiftShader](https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md).
`tests/e2e/webgl-smoke.spec.ts` proves the context is created and renders. Its renderer string
(`ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device ...`) is recorded as a test annotation.

SwiftShader logs one ANGLE performance note per composited WebGL frame,
`GL Driver Message (OpenGL, Performance, ...): GPU stall due to ReadPixels`. It comes from the
software compositor, never appears on a hardware GPU, and is the only message the console guard
ignores (matched exactly, with or without ANGLE's final " (this message will no longer repeat)"
suffix, and only at warning level). The guard also keeps listening for
`consoleSettleMs` (default 250 ms, a fixture option) after each test body so late async
warnings still fail the test. Headless FPS is meaningless on SwiftShader: assert bytes, timings,
draw calls and triangles instead.

If the smoke test fails: run `npx playwright install chromium`, check the flags above are still
in `playwright.config.ts`, and compare them with the Chromium doc linked above.

## Layout: the overlay layer system (UX-1)

All UI over the scene goes through `src/components/overlay/OverlayLayout.tsx`. It reserves
named zones as rows of one CSS grid (banner, HUD, free scene area, toast, sheet, tab bar), so
zones cannot overlap; content that does not fit scrolls inside its own zone. The free scene area
never shrinks below `freeSceneMinHeightPx` (room for the map attribution and its 44 px credits
link); on short viewports banner, toast and sheet shrink first. Zone sizes live in
`data/config/layout.json`. The bottom tab bar (`src/components/nav/BottomTabs.tsx`) sits in the
`tabs` zone with safe-area padding.

## Data, copy and config

Everything players see or the game tunes lives in `/data` as JSON, and every file is validated
by a zod schema in `src/lib/data/schemas/` (`src/lib/data/data.test.ts` fails if a `.json`/`.geojson` file has
no schema or does not match it, if any other file type appears (only `SOURCES.md` and
`README.md` are allowed next to data), or if a cross-file reference breaks).

| Folder            | Holds                                                                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/config/`    | `perf.json` (every performance budget), `theme.json` (palette), `realtime.json`, `moderation.json`, `balance.json` (balance anchors), `layout.json`, `copy.json`, `geo.json` (geo build parameters) |
| `data/copy/`      | `base.json` (every player-facing string) and `packs/*.json` (slang packs)                                                                                                                           |
| `data/items/` ... | `items`, `premium`, `events`, `jobs`, `venues`, `landmarks`: content, with copy keys instead of text (placeholder seeds until their tasks land)                                                     |
| `data/geo/`       | `bounds.json` (NYC extent) and the layers `npm run geo:build` writes: `land`, `water`, `parks`, `subway` (`*.derived.json`), `manifest.derived.json`, `SOURCES.md`                                  |
| `data/zones/`     | play zones (one per 2020 CDTA, grouping NTAs): `zones.derived.json` (metadata) and `zone-shapes.derived.json`                                                                                       |
| `data/audio/`     | `manifest.json` (CC0 tracks only)                                                                                                                                                                   |

- **Loading.** Server code and scripts import validated data from `src/lib/data/config.ts` and
  `src/lib/data/content.ts`, which parse at import and fail fast with the file name. Client
  code must not pull in zod's classic build (it costs about 90 KB gz of shell JS): the copy
  layer reads its JSON directly (validated by the tests), and the store validates with
  `zod/mini`.
- **Adding content.** Add the entry to the JSON file, add its strings to `data/copy/base.json`
  under the key the entry names (`nameKey`, `titleKey`, ...), and run `npm test`.
- **Copy.** `copy(key, vars)` from `src/lib/copy.ts` renders a string with the active slang pack
  (`data/config/copy.json` → `slangPack`) layered over base. Swapping the pack id changes the
  text with no code change; a new pack file must also be registered in `slangPacks`. Templates
  use `{name}` placeholders (a letter, then letters or digits) whose values are strings, so
  numbers go through the formatters first. Any other brace is rejected by the schema and by
  `interpolate`.
  Packs may override only base keys and must keep the same placeholders.
- **Superlatives (GR-11).** No copy string may contain "cheapest", "biggest", "best", "most" or
  "fastest" as literal text (`src/lib/copy.test.ts`). Give the string a placeholder and fill it
  with `superlative(kind, subjectId, values)`, which returns the word only when the data proves
  it (a unique minimum or maximum) and `null` otherwise.
- **Numbers (UX-2).** `formatMoney` (whole US dollars, halves rounded away from zero) and
  `formatCount` (rounded to a whole count, then `Intl.NumberFormat` compact; never `-0`) in
  `src/lib/format.ts`. Anywhere else under `src/`, ESLint rejects any reference to `Intl`,
  the `toLocale*String` / `toFixed` / `toPrecision` methods however they are reached, and
  hand-built dollar amounts (`` `$${x}` ``, `'$' + x`, `$` before a JSX expression).
- **Theme.** `data/config/theme.json` holds the palette. The root layout writes each token to a
  `--palette-<token>` variable on `<html>`, and `src/app/globals.css` maps it to the Tailwind
  colour `--color-<token>` (`bg-night-900`, `text-taxi-400`, ...). A new token needs a line in
  both; `src/lib/theme.test.ts` checks they match and that no source file hardcodes a colour.

## Game state

`src/state/store.ts` is the Zustand store (`useGameStore(selector)`), persisted to localStorage
under `cloutcity:game` with a schema `version` and a `migrate` step. Loaded state is validated:
out-of-range fields are repaired (speed to 1x, remainder to 0, stats clamped and rounded) and
only a structurally unusable save is replaced by a fresh state. A save from a newer build is
never overwritten: the store sets `newerSavePresent` and writes nothing until
`discardNewerSaveAndStartFresh()` is called. Only meaningful changes (minute, cash, stats,
speed) are written, not every tick. If localStorage is unavailable (private
browsing, blocked site data, full quota) the store keeps working in memory for the session.

The store holds an engine snapshot and calls the engine for every change (`tick`,
`performAction`, `setSpeed`); it holds no game rules itself.

- **Engine** (`src/engine/`): pure functions, no React, three, Supabase or store imports, and
  no real clock or randomness (ESLint enforces it; `src/engine/purity.test.ts` proves it).
  Every number comes from `data/config/balance.json` (`time`, `stats`, `actions`).
- **Two clocks.** The personal game clock (`clock.ts`) is whole game minutes since day 1, 00:00.
  Passive time runs at 10 game minutes per real minute while the tab is visible, at 1x or 2x;
  actions fast-forward it instantly by their duration. City time (`cityTime.ts`) is the real
  New York wall clock for an instant the caller passes in. `src/state/clockDriver.ts` is the
  only code that reads real time for the personal clock, and it pauses while the tab is hidden.
- **Stats** (`stats.ts`): energy, hunger (fullness) and mood, 0-100, decay at each game hour;
  a stat at 0 drains the others faster and/or slows actions (`stats.atZero`).
- **Actions** (`actions.ts`): validated definitions with a duration, cash and energy cost and
  stat effects; failures return a typed error (`INSUFFICIENT_FUNDS`, `INSUFFICIENT_ENERGY`, ...)
  and change nothing.
- **Saves** (`save.ts`): bump `SAVE_VERSION` and add a step to `migrateSave`, with a test, on any
  breaking change to the saved shape.

## Logging

Use `src/lib/log.ts` (`log.info(msg, context)`, `log.withCorrelationId(id)`). It writes
structured records with a level, timestamp and correlation id. It redacts sensitive keys
(email, token, password, chat, message, note) and scrubs email addresses (plain or `%40`-encoded),
`Bearer` tokens, JWTs and the values of sensitive URL query/fragment parameters from every
string value and from the message itself. Dates become ISO strings, Maps
objects and Sets arrays. `console.*` is a lint error everywhere else.

## Geo data

`npm run geo:build` (`scripts/geo/build.ts`) downloads the sources pinned in
`scripts/geo/sources.lock.json` (DCP borough boundaries clipped to shoreline and 2020 NTAs, MTA
subway static GTFS) into `.cache/geo/`, then writes simplified, integer-metre layers to
`data/geo` and `data/zones`. The output is deterministic: `npm run geo:build -- --check` rebuilds
in memory and fails if a committed file differs, and `npm test` rebuilds from the cache when it
is present. `--update` accepts changed upstream files and rewrites the lock; `--offline` never
touches the network. Parameters live in `data/config/geo.json`; sources, terms, transformations
and attribution text are in `data/geo/SOURCES.md` (generated). All coordinates use the one
projection in `src/lib/geo/projection.ts` (lat/lng to local metres, fixed origin), shared by the
build, the scene and the engine; `src/lib/data/geo.ts` loads the layers for server code and tests.

## Performance budget

`data/config/perf.json` holds every budget from `CLAUDE.md`, per tier where tiered, plus the
`cc-mid-4g` throttle profile and the FPS step-down rule. `npm run budget` (after `npm run build`,
KB = 1000 bytes) checks:

- `shellJsGzKB`: the gzipped size of every script the prerendered `/` makes a modern browser run
  (Next.js chunks plus inline scripts; `nomodule` polyfills excluded);
- `sceneChunkJsGzKB`: the lazy 3D chunk, i.e. the files of the `next/dynamic` scene import listed
  in `.next/server/app/page/react-loadable-manifest.json` (minus any file the shell already
  loads); the script fails if the manifest is missing or lists no lazy JS;
- that no file in `.next/static` contains the e2e test-hook marker `__CLOUTCITY_TEST__`.

Draw calls, triangles and idle frames at the default view are asserted by
`tests/e2e/city-scene.spec.ts`. Enforcement of the other budgets joins in later tasks.

## 3D city scene

`src/scene/` renders the base city with react-three-fiber: extruded borough land, the water
plane, parks and cemeteries, subway ribbons with a dark casing, instanced station markers and
plain line-letter chips at each line's terminals (our own colours and style, never MTA bullets).
It is about a dozen draw calls at the default view.

- **Loading.** `src/scene/CityScene.tsx` (server) resolves config, palette tokens, the projected
  start and bounds and copy into small props. `CitySceneClient.tsx` loads the canvas with
  `next/dynamic` (`ssr: false`), so the shell is interactive first, and starts the geo request at
  hydration. The geo layers come from the prerendered route `/geo/base?v=<geoVersion>`
  (`src/app/geo/base/route.ts`) and are validated in the 3D chunk with `zod/mini`
  (`src/scene/geo/schema.ts`, kept in step with the classic schemas by its tests).
- **Config.** Camera start, zoom/tilt/turn limits, layer heights, line widths, marker and chip
  sizes and lights live in `data/config/scene.json`; scene colours are palette tokens in the
  `scene` block of `data/config/theme.json` (resolved to hex on the server). Toon shading uses one
  shared gradient ramp (`toonRamp`).
- **Camera.** three's `MapControls` (`src/scene/camera/CameraRig.tsx`): one finger or left drag
  pans, pinch or wheel zooms towards the pointer, two fingers or right drag rotate and tilt; the
  target stays inside `data/geo/bounds.json`. Rendering is on demand (`frameloop="demand"`), so an
  idle map draws zero frames.
- **Attribution.** `src/scene/MapAttribution.tsx` shows the NYC Open Data and MTA lines in the free
  scene row of the overlay grid (a one-line form when the row is short, via a container query in
  `globals.css`); `/credits` has the full text.
- **Failures.** Before the canvas mounts, the shell checks for WebGL2 and downloads the geo body
  (`src/scene/geo/load.ts`, which never rejects); the 3D chunk validates it without throwing. No
  WebGL, a failed download, a non-JSON body or a schema failure each show the error status
  (`map.error.device` or `map.error.load`) over the static background and log exactly one
  structured warning; the shell keeps working. `SceneErrorBoundary` only catches unexpected
  renderer errors.
- **Test hooks.** With `NEXT_PUBLIC_TEST_HOOKS=1` at build time, `window.__CLOUTCITY_TEST__.scene`
  exposes `ready`, `frames()`, `camera()` and `renderInfo()` (`src/scene/testHooks.tsx`). The e2e
  web server sets it and builds into `.next-e2e` (`NEXT_DIST_DIR`, read by `next.config.ts`), so
  the hook never reaches `.next`; in every other build its code is removed as dead code.

## PWA

`src/app/manifest.ts` serves `/manifest.webmanifest`. Icons are rendered from
`public/icons/icon.svg` by `node scripts/generate-icons.ts` (output committed). The viewport is
locked to the device width with `viewport-fit=cover`; the shell blocks page scroll, bounce and
double-tap zoom in CSS but keeps pinch zoom (WCAG 1.4.4).

## Local Supabase

The Supabase CLI is a devDependency (`npx supabase ...`) and `supabase/config.toml` is
initialised. Nothing needs a running stack yet; see `progress.md` for when to `npx supabase start`.

## Ignored paths

`.gitignore` covers env files, build output (`.next/`, `.next-e2e/` for the e2e build, `out/`), test artefacts
(`test-results/`, `playwright-report/`, `coverage/`) and the geo download cache (`.cache/`:
the raw NYC Open Data and MTA files `npm run geo:build` downloads, kept unmodified).

## Agent orchestration kit

A portable Claude Code workflow: one **orchestrator** (the main session) routes work to four
specialist subagents, with a shared rulebook, per-agent project memory and a single open-issues
tracker. Extracted from a production Next.js codebase where it has run for several months.

### The flow

```
               ┌──────────── fix loop ────────────┐
user ─► orchestrator ─► architect ─► code-ninja ─► bug-hunter ─► PR
               │          (plan)       (code)    (unit + e2e)
               │                          ▲            │ failure report
               │                          └────────────┘
               └─► qa-mafia ─► Markdown report ─► user decides
                  (live browser, acceptance criteria — standalone, never in the fix loop)
```

| Agent        | Role                                                                                                               | Writes product code? | Model  |
| ------------ | ------------------------------------------------------------------------------------------------------------------ | -------------------- | ------ |
| `architect`  | Turns a request into an approved, phased plan                                                                      | No (read-only tools) | sonnet |
| `code-ninja` | Implements the approved plan / bug fix / refactor                                                                  | Yes                  | opus   |
| `bug-hunter` | Owns all automated tests (unit, integration, Playwright e2e); reports product failures back instead of fixing them | Tests only           | sonnet |
| `qa-mafia`   | Drives the live app with `playwright-cli` against acceptance criteria; writes a report to `qa-reports/`            | No                   | sonnet |

The orchestrator stays accountable: it reviews every report against the Core Operating Rules,
records every finding in the tracker, and asks the user for anything that needs a ruling.

### What's in the kit

```
CLAUDE.md.template              orchestration model + Core Operating Rules 1–23 + lessons learned
.claude/agents/*.md             the four subagent definitions
.claude/agent-memory/*/MEMORY.md  empty per-agent memory indexes (agents fill them over time)
.claude/skills/playwright-cli/  the browser-automation skill qa-mafia uses (stock, unmodified)
docs/local/OPEN-ISSUES.md       issue-tracker template (Rule 22)
gitignore.snippet               lines to append to .gitignore
```

### Adopt it in another project

1. **Copy the files** into the target repo root (keep the paths):
   ```bash
   cp -r .claude docs CLAUDE.md.template gitignore.snippet /path/to/project/
   cd /path/to/project && mv CLAUDE.md.template CLAUDE.md && cat gitignore.snippet >> .gitignore && rm gitignore.snippet
   ```
   If the project already has a `CLAUDE.md`, merge: keep its project-specific sections and add the
   _Orchestration Model_ and _Core Operating Rules_ sections from the template.
2. **Fill the placeholders** — find them all with `grep -rn '{{' CLAUDE.md .claude docs`:

   | Placeholder                                                        | Where                      | Example                                            |
   | ------------------------------------------------------------------ | -------------------------- | -------------------------------------------------- |
   | `{{PROJECT_NAME}}`, `{{ONE_LINE_DESCRIPTION}}`                     | CLAUDE.md                  |                                                    |
   | `{{E2E_DIR}}`                                                      | CLAUDE.md, bug-hunter.md   | `tests/e2e`                                        |
   | `{{APP_SOURCE_PATHS}}`                                             | qa-mafia.md                | `` `src/app/`, `src/components/`, `src/server/` `` |
   | `{{QA_ENV_FILE}}`, `{{QA_EMAIL_VAR}}`, `{{QA_EMAIL_PASSWORD_VAR}}` | CLAUDE.md, qa-mafia.md     | `.env.local`, `QA_EMAIL`, `QA_EMAIL_PASSWORD`      |
   | `{{ISSUE_TRACKER_PATH}}`                                           | CLAUDE.md                  | `docs/local/OPEN-ISSUES.md`                        |
   | `{{TRUNK_BRANCH}}`                                                 | CLAUDE.md                  | `dev` or `main`                                    |
   | `{{INSTALL_CMD}}` … `{{E2E_CMD}}`                                  | CLAUDE.md commands section | `npm ci`, `npm run lint`, …                        |
   | PROJECT-SPECIFIC sections                                          | CLAUDE.md                  | structure, style, logging rules for your stack     |

   The `{{...}}` lines inside the agents' _memory frontmatter examples_ (`name: {{short-kebab-case-slug}}`)
   are intentional — they're the template the agents fill in. Leave those.

3. **Install the browser CLI** qa-mafia drives: `npm install -g @playwright/cli` (provides
   `playwright-cli`; the skill falls back to `npx --no-install playwright-cli`). bug-hunter's e2e
   specs need `@playwright/test` and a `playwright.config.ts` in the project as usual.
4. **Give qa-mafia a QA mailbox** so live QA is self-service: a Gmail (or any IMAP) inbox with an
   app password in your untracked env file. Plus-addressing (`qa+admin@…`) yields unlimited test
   identities. Without it, qa-mafia will have to ask for accounts and OTPs.
5. **Tune per project** (optional):
   - Model per agent: the `model:` frontmatter line (`opus` / `sonnet` / `haiku`).
   - architect's `tools:` list — it's read-only by design; add MCP tools you want it to consult (e.g. Figma).
   - Rules you don't want: delete them from CLAUDE.md, but keep 21–23 — they're what make the loop trustworthy.
6. **Commit** `CLAUDE.md`, `.claude/agents/`, `.claude/agent-memory/` and `.claude/skills/`. The
   agent memories are meant to be shared through version control; `docs/local/` and `qa-reports/`
   stay local (gitignored).

### Using it day to day

- _"Plan X"_ → architect; you approve the plan → code-ninja implements → bug-hunter tests → PR.
- _"Validate this story: …"_ or _"Generate the stories for area Y and check them"_ → qa-mafia.
- New bugs, risks and questions land in `docs/local/OPEN-ISSUES.md` with IDs; direct work by ID
  ("fix BUG-12 and SEC-3"). Items leave the open list as soon as their fix merges.
- For parallel batches, ask the orchestrator to split by file area and run each `code-ninja` in
  its own worktree; validate with `bug-hunter` per branch, one e2e run at a time.
