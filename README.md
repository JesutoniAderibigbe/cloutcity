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

| Script                            | What it does                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `npm run dev` / `build` / `start` | Next.js dev server, production build, production server                                                              |
| `npm run typecheck`               | `next typegen` then `tsc --noEmit` (strict)                                                                          |
| `npm run lint`                    | ESLint CLI (flat config): Next core-web-vitals + TypeScript, full jsx-a11y recommended set, `no-console` as an error |
| `npm run format:check` / `format` | Prettier check / write                                                                                               |
| `npm test`                        | Vitest unit tests (`*.test.ts` next to the code)                                                                     |
| `npm run e2e`                     | Playwright specs in `tests/e2e`, against a fresh production build on `E2E_PORT`                                      |
| `npm run budget`                  | Gzipped shell JS of `/` against `data/config/perf.json` (run after `npm run build`)                                  |

Gate order used by the build loop:
`npm run format:check && npm run typecheck && npm run lint && npm test && npm run build && npm run e2e && npm run budget`

## End-to-end tests

- Projects: `mobile-390` (390x844, touch, mobile viewport) and `desktop-1280` (1280x720).
- Import `test` and `expect` from `tests/e2e/fixtures/test.ts`, never from `@playwright/test`.
  The fixture fails any test that logs a console warning or error or throws an uncaught page
  error (PERF-1), and provides `checkA11y()`, an axe scan that fails on serious or critical
  violations (A11Y-2).
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
ignores (matched exactly, and only at warning level). The guard also keeps listening for
`consoleSettleMs` (default 250 ms, a fixture option) after each test body so late async
warnings still fail the test. Headless FPS is meaningless on SwiftShader: assert bytes, timings,
draw calls and triangles instead.

If the smoke test fails: run `npx playwright install chromium`, check the flags above are still
in `playwright.config.ts`, and compare them with the Chromium doc linked above.

## Layout: the overlay layer system (UX-1)

All UI over the scene goes through `src/components/overlay/OverlayLayout.tsx`. It reserves
named zones as rows of one CSS grid (banner, HUD, free scene area, toast, sheet, tab bar), so
zones cannot overlap; content that does not fit scrolls inside its own zone. Zone sizes live in
`data/config/layout.json`. The bottom tab bar (`src/components/nav/BottomTabs.tsx`) sits in the
`tabs` zone with safe-area padding.

## Logging

Use `src/lib/log.ts` (`log.info(msg, context)`, `log.withCorrelationId(id)`). It writes
structured records with a level, timestamp and correlation id. It redacts sensitive keys
(email, token, password, chat, message, note) and scrubs email addresses (plain or `%40`-encoded),
`Bearer` tokens, JWTs and the values of sensitive URL query/fragment parameters from every
string value and from the message itself. Dates become ISO strings, Maps
objects and Sets arrays. `console.*` is a lint error everywhere else.

## Performance budget

`npm run budget` reads `shellJsGzKB` from `data/config/perf.json` (KB = 1000 bytes) and sums the
gzipped size of every script the prerendered `/` makes a modern browser run (Next.js chunks
plus inline scripts; `nomodule` polyfills excluded). The other budgets in `CLAUDE.md` join it in
later tasks.

## PWA

`src/app/manifest.ts` serves `/manifest.webmanifest`. Icons are rendered from
`public/icons/icon.svg` by `node scripts/generate-icons.ts` (output committed). The viewport is
locked to the device width with `viewport-fit=cover`; the shell blocks page scroll, bounce and
double-tap zoom in CSS but keeps pinch zoom (WCAG 1.4.4).

## Local Supabase

The Supabase CLI is a devDependency (`npx supabase ...`) and `supabase/config.toml` is
initialised. Nothing needs a running stack yet; see `progress.md` for when to `npx supabase start`.

## Ignored paths

`.gitignore` covers env files, build output (`.next/`, `out/`), test artefacts
(`test-results/`, `playwright-report/`, `coverage/`) and the geo download cache (`.cache/`,
reserved for the raw NYC Open Data and MTA files `npm run geo:build` downloads in S04).

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
