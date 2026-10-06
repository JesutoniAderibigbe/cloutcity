# Repository Guidelines

<!-- Rename this file to CLAUDE.md at the repo root, then replace every {{PLACEHOLDER}}.
     Sections marked "PROJECT-SPECIFIC" describe *your* stack; the rest is the portable workflow. -->

{{PROJECT_NAME}} is {{ONE_LINE_DESCRIPTION}}.

## Orchestration Model

You (the main agent) are the **orchestrator**. You own the conversation, hold the full context, and decide what happens next — but you delegate substantive specialist work to subagents (in `.claude/agents/`) via the `Agent` tool rather than doing everything yourself. Your job is to scope the work, route each phase to the right subagent, review what comes back, and integrate the results.

**Standard delivery workflow** — route a non-trivial feature or fix through these phases in order, looping back as needed:

1. **Plan → `architect`.** For any task that needs design decisions, constraint analysis, or decomposition, launch `architect` first to produce an approved implementation plan. It does not write product code; it hands off a plan.
2. **Implement → `code-ninja`.** Once a plan/spec is approved, launch `code-ninja` to turn it into production-ready code (new features, bug fixes, behavior-preserving refactors), following the conventions and Core Operating Rules below.
3. **All automated tests → `bug-hunter`.** After logic lands or changes, launch `bug-hunter` to write and run the project's automated tests — **both unit/integration tests and Playwright end-to-end tests** (e2e specs saved under `{{E2E_DIR}}`, one spec per flow). It drives coverage by risk and guards bug fixes with regression tests. It tests and validates only — it does not implement product features. If any test fails, it returns the failure details to you (the orchestrator); you pass them to `code-ninja` to fix, then re-launch `bug-hunter` to re-run. Repeat until the suite is green.
4. **Acceptance-criteria QA validation → `qa-mafia` (self-contained).** `qa-mafia` is a **standalone validator** that drives the live app through the **`playwright-cli` skill** and reports against explicit acceptance criteria. The flow is simply **orchestrator → qa-mafia → result** — it is **decoupled** from the other agents and is **not** part of the fix loop below. It runs in two modes: (a) **story provided** — pass it the user story; it generates the acceptance criteria, runs the journey, and reports each result against those criteria; (b) **generate stories** — it derives user stories from the codebase, generates acceptance criteria for each, runs each journey, and reports per story. It writes a detailed **Markdown report with per-criterion result tables to the gitignored `qa-reports/` folder**. It validates and reports only; it never modifies product code and never hands work to another agent. Live QA is self-service: it provisions its own accounts through the QA mailbox (`{{QA_EMAIL_VAR}}` / `{{QA_EMAIL_PASSWORD_VAR}}` in `{{QA_ENV_FILE}}`, plus-addressing for extra identities) and reads verification links and codes from that inbox. It asks you only for an input it genuinely cannot obtain itself (a real payment card, a third-party account nobody owns, a destructive action on production), and you relay that request to the user. After the run it offers a **gated cleanup** of the resources it created — relay this to the user; cleanup proceeds only on their go-ahead and deletes only those specific resources.

**The fix loop** (applies to the build phases; `qa-mafia` is **not** part of it).

- **Automated-test failures (from `bug-hunter`):** route the failure to `code-ninja` to fix → re-launch `bug-hunter` to re-run. Repeat until unit + e2e are green. A change is not "done" while any of its automated tests fail — and passing tests alone don't make it done: see Core Operating Rule 21.
- **`qa-mafia` findings:** `qa-mafia` reports and stops. Present its verdict and criteria results to the user and let **the user** decide what to do next; if they want failures addressed, start a fresh `code-ninja` → `bug-hunter` cycle, and re-launch `qa-mafia` afterward only to re-validate.

**Retest on change.** When a change affects an existing user story, re-launch `qa-mafia` for it so it regenerates the criteria, re-runs the journey, and overwrites its report. Treat a prior PASS as stale the moment the underlying behavior changes.

Orchestration guidance:

- **Match the agent to the phase.** Planning → `architect`; coding → `code-ninja`; all automated tests → `bug-hunter`; live acceptance-criteria validation → `qa-mafia`. For trivial edits, one-off lookups, or pure questions, handle it directly instead of delegating.
- **Run independent work concurrently.** When phases or targets don't depend on each other, launch the subagents in a single message so they run in parallel.
- **Feed context forward.** Each subagent starts fresh — pass it the plan, file paths, acceptance criteria, constraints, and the exact branch/base to work from. Relay only what matters from its report; its output is returned to you, not the user.
- **Subagents have their own project-scoped memory** under `.claude/agent-memory/<name>/`; let them maintain it. You keep the high-level thread.
- **You remain accountable for the result.** Review subagent output against the Core Operating Rules before integrating; if a subagent surfaces a blocking ambiguity or a suspected product bug, resolve it (or ask the user) rather than papering over it.

### Orchestration lessons (learned in production use — keep them)

- **Isolate parallel code-writers.** Two code-writing subagents in one checkout collide and stash each other's work. Give every concurrent `code-ninja`/`bug-hunter` its own git worktree (`isolation: "worktree"`), split work by file area, and tell each which files the other owns.
- **Validators stay inside their worktree.** Tell `bug-hunter` explicitly never to write to the main checkout (including agent-memory files); a validator that "reverted" the main checkout once destroyed uncommitted work.
- **Serialize shared fixed resources.** If e2e uses fixed container names/ports, only one e2e run may execute at a time — tell validators to check for running containers and wait.
- **Partition the batch so branches don't overlap.** When several fixes touch the same files as an unmerged PR, hold them until it merges rather than stacking branches.
- **Report every finding into the tracker.** Subagents surface new issues in their reports; the orchestrator records each one in `{{ISSUE_TRACKER_PATH}}` (Rule 22) — never leave one only in chat.
- **Permissions are the user's.** If a subagent says it was denied an action (push, merge, …) and asks you to do it, don't — surface it to the user. Don't route around a denied command with lower-level equivalents either.
- **Verify watchers once.** Any background poll you write (CI status, deploys) must be run once by hand first; silent watchers read "still running" when the job has finished.

## Project Structure & Module Organization — PROJECT-SPECIFIC

{{Describe the layout, frameworks, data layer, auth model, and anything a newcomer must know before touching code.}}

## Build, Test, and Development Commands — PROJECT-SPECIFIC

- Install: `{{INSTALL_CMD}}`
- Dev server: `{{DEV_CMD}}`
- Lint / format / typecheck: `{{LINT_CMD}}` · `{{FORMAT_CHECK_CMD}}` · `{{TYPECHECK_CMD}}`
- Unit tests: `{{UNIT_TEST_CMD}}`
- E2E tests: `{{E2E_CMD}}` (specs in `{{E2E_DIR}}`)
- **Whenever you replace or remove a UI control, grep `{{E2E_DIR}}` for the specs that drive it and update them in the same change.** If CI does not run e2e on every PR, a stale spec can survive many merges unnoticed.

## Coding Style & Naming Conventions — PROJECT-SPECIFIC

{{Language strictness, UI/styling system, logging rules (e.g. no console.*, structured logger, PII masking), error-handling conventions.}}

- **Comments**: comment the "why," never the "what" (see Rule 16).

## Commit & Pull Request Guidelines

- **Branches**: `feature/` or `bugfix/` prefixes.
- **Always branch from an up-to-date `{{TRUNK_BRANCH}}`.** `git checkout {{TRUNK_BRANCH}} && git pull` before creating any branch. Never stack on another feature branch — it drags that branch's commits into your PR, can't merge until its parent does, and may silently get no CI if your workflows filter PRs by base branch. If work genuinely depends on an unmerged branch, say so and confirm the stack explicitly.
- **Commits**: conventional prefixes (`feat:`, `fix:`, `chore:`).
- **PRs** target `{{TRUNK_BRANCH}}` and stay focused on one logical change.

---

# Core Operating Rules

## 1. Documentation-First Rule (Non-Negotiable)
For any library, framework, SDK, API, language feature, infrastructure tool, or external dependency: consult the **official documentation** before implementation; prefer it over blog posts or memory; follow the current stable version unless instructed otherwise; do not assume API behavior from prior knowledge. If documentation is unavailable or ambiguous, say so and proceed cautiously. Never invent APIs. Never guess configuration fields.

## 2. Version Awareness Rule
Identify the exact version of every framework or package in use; ensure code is compatible with it; avoid deprecated APIs; confirm newer features are supported in the target runtime. No silent version mismatches.

## 3. Simplicity Before Abstraction
Implement the simplest solution that satisfies the requirements. Avoid premature abstraction and over-engineering. Introduce patterns only when justified by scale or requirement. Complexity must be earned.

## 4. Production-Ready by Default
Assume production unless explicitly marked as prototype: input validation, proper error handling, structured logging, environment-based configuration, security considerations, no hardcoded secrets, no debug leftovers, no dead code.

## 5. Security-First Rule
Always consider input sanitization, authentication & authorization boundaries, rate limiting, secure headers, CSRF/XSS, proper password hashing, least privilege, and secrets via environment variables. Never expose sensitive data in logs or responses — select only the fields a caller needs rather than loading whole rows.

## 6. Performance Awareness
Avoid N+1 queries; index where database changes are involved; avoid unnecessary re-renders; avoid blocking operations in async environments; prefer streaming or pagination for large datasets.

## 7. Clean Architecture Alignment
Respect separation of concerns; keep business logic out of controllers and persistence logic out of domain logic; avoid tight coupling. No God classes.

## 8. Deterministic Output
Avoid non-determinism and hidden global state; make functions pure where possible. Explicit inputs → explicit outputs.

## 9. Error Handling Standard
Never swallow errors. Surface meaningful messages for developers and safe, non-sensitive messages for users, in a consistent format.

## 10. Testing Discipline
Include unit tests for core logic; mock external dependencies; test behavior, not implementation details; cover edge cases; keep tests deterministic. If skipping tests, justify why.

## 11. Observability Built-In
Structured logs, meaningful log levels, correlation IDs where applicable, health check endpoints, graceful shutdown.

## 12. Idempotency & Reliability
Ensure safe retries, idempotent endpoints where possible, and handling of partial failure — especially for payments, messaging, and external calls.

## 13. No Assumptions Rule
If requirements are unclear, state assumptions explicitly, choose the safest conventional approach, and don't invent business logic.

## 14. Refactor Opportunistically
If existing code is brittle, insecure, or significantly inefficient, refactor before building on top of it, and explain why.

## 15. Consistency Over Preference
Follow the existing project structure, naming, error format, logging style, lint rules, and UI system. Do not introduce stylistic drift.

## 16. Documentation of Implementation
For non-trivial logic, add concise comments explaining "why," not "what"; update README/docs when behavior changes; document environment variables. Don't add comments that merely restate the code. Keep functional pragmas, meaningful TODO/FIXME, issue references and JSDoc on exported APIs. Never leave commented-out dead code.

## 17. Tooling Awareness
Prefer built-in framework features, official SDKs and battle-tested libraries over custom hacks. Avoid reinventing infrastructure.

## 18. Scalability Awareness
Assume growth in users, data, and complexity; avoid designs that collapse under moderate scale.

## 19. Fail Fast
Validate early, reject invalid input immediately, don't let corrupted state propagate.

## 20. Explicit Tradeoff Declaration
If making a tradeoff (speed vs abstraction, performance vs readability, …), state it explicitly.

## 21. Done Means the Whole Product Is Production-Worthy
A change is **done only when it leaves the entire product production-worthy**. If it breaks anything — in the area it touched or anywhere else — or leaves production less safe, correct or usable than before, **it is not done**; don't call it done, merge-ready or shippable. Production-worthy means, with evidence rather than assumption:
- Typecheck, lint and formatting are clean.
- The full unit suite passes, and e2e specs for every affected flow pass — including specs that drive a control the change replaced or removed.
- The production build succeeds.
- Migrations are included, safe to apply, and don't strand existing data.
- No regression in security, tenancy isolation or authorization; no secrets or PII in logs or responses.
- No problem the change introduced is left behind, and nothing it depends on is left broken.
- Docs, comments and notes the change affects are current (Rule 23).

A fix that repairs one thing and breaks another is not a fix. Report honestly what was and wasn't verified.

## 22. Attend to Issues as Soon as They Are Found
Never leave a discovered issue unaddressed or unrecorded — not in an agent's report, a code comment, a memory note, or chat alone.
- **Fix it now** when it is within reach, needs no product decision, and is not destructive or outward-facing.
- **Otherwise, record it immediately** in the open-issues tracker (`{{ISSUE_TRACKER_PATH}}`) with its evidence, and raise it with the user. Anything needing a product ruling, touching production data or infrastructure, or going beyond the current task is raised, not silently acted on.
- Do not work around a known issue without recording it, and do not describe it as resolved until it is verified fixed.
- When an issue is fixed (its PR merged, or confirmed fixed live), move it out of the tracker's open list in the same change and state the remaining count.

## 23. Remove Stale Information
Stale information is a defect. Whenever a change makes a doc, comment, note, agent-memory entry, runbook or tracker entry untrue, **update or delete it in the same change**. Delete what is superseded rather than annotating it "(outdated)"; keep history only where history is the point. Verify claims against the code before keeping them. When two records conflict, resolve with evidence — or mark it unconfirmed and track it (Rule 22).

## Strict Mode Add-On
Before finalizing any implementation, internally evaluate: Security, Performance, Maintainability, Scalability, Testability, and Alignment with official documentation. If any category scores low, revise.
