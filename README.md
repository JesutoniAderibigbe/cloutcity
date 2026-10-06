# Agent Orchestration Kit

A portable Claude Code workflow: one **orchestrator** (the main session) routes work to four
specialist subagents, with a shared rulebook, per-agent project memory and a single open-issues
tracker. Extracted from a production Next.js codebase where it has run for several months.

## The flow

```
               ┌──────────── fix loop ────────────┐
user ─► orchestrator ─► architect ─► code-ninja ─► bug-hunter ─► PR
               │          (plan)       (code)    (unit + e2e)
               │                          ▲            │ failure report
               │                          └────────────┘
               └─► qa-mafia ─► Markdown report ─► user decides
                  (live browser, acceptance criteria — standalone, never in the fix loop)
```

| Agent | Role | Writes product code? | Model |
|---|---|---|---|
| `architect` | Turns a request into an approved, phased plan | No (read-only tools) | sonnet |
| `code-ninja` | Implements the approved plan / bug fix / refactor | Yes | opus |
| `bug-hunter` | Owns all automated tests (unit, integration, Playwright e2e); reports product failures back instead of fixing them | Tests only | sonnet |
| `qa-mafia` | Drives the live app with `playwright-cli` against acceptance criteria; writes a report to `qa-reports/` | No | sonnet |

The orchestrator stays accountable: it reviews every report against the Core Operating Rules,
records every finding in the tracker, and asks the user for anything that needs a ruling.

## What's in the kit

```
CLAUDE.md.template              orchestration model + Core Operating Rules 1–23 + lessons learned
.claude/agents/*.md             the four subagent definitions
.claude/agent-memory/*/MEMORY.md  empty per-agent memory indexes (agents fill them over time)
.claude/skills/playwright-cli/  the browser-automation skill qa-mafia uses (stock, unmodified)
docs/local/OPEN-ISSUES.md       issue-tracker template (Rule 22)
gitignore.snippet               lines to append to .gitignore
```

## Adopt it in another project

1. **Copy the files** into the target repo root (keep the paths):
   ```bash
   cp -r .claude docs CLAUDE.md.template gitignore.snippet /path/to/project/
   cd /path/to/project && mv CLAUDE.md.template CLAUDE.md && cat gitignore.snippet >> .gitignore && rm gitignore.snippet
   ```
   If the project already has a `CLAUDE.md`, merge: keep its project-specific sections and add the
   *Orchestration Model* and *Core Operating Rules* sections from the template.
2. **Fill the placeholders** — find them all with `grep -rn '{{' CLAUDE.md .claude docs`:

   | Placeholder | Where | Example |
   |---|---|---|
   | `{{PROJECT_NAME}}`, `{{ONE_LINE_DESCRIPTION}}` | CLAUDE.md | |
   | `{{E2E_DIR}}` | CLAUDE.md, bug-hunter.md | `tests/e2e` |
   | `{{APP_SOURCE_PATHS}}` | qa-mafia.md | `` `src/app/`, `src/components/`, `src/server/` `` |
   | `{{QA_ENV_FILE}}`, `{{QA_EMAIL_VAR}}`, `{{QA_EMAIL_PASSWORD_VAR}}` | CLAUDE.md, qa-mafia.md | `.env.local`, `QA_EMAIL`, `QA_EMAIL_PASSWORD` |
   | `{{ISSUE_TRACKER_PATH}}` | CLAUDE.md | `docs/local/OPEN-ISSUES.md` |
   | `{{TRUNK_BRANCH}}` | CLAUDE.md | `dev` or `main` |
   | `{{INSTALL_CMD}}` … `{{E2E_CMD}}` | CLAUDE.md commands section | `npm ci`, `npm run lint`, … |
   | PROJECT-SPECIFIC sections | CLAUDE.md | structure, style, logging rules for your stack |

   The `{{...}}` lines inside the agents' *memory frontmatter examples* (`name: {{short-kebab-case-slug}}`)
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

## Using it day to day

- *"Plan X"* → architect; you approve the plan → code-ninja implements → bug-hunter tests → PR.
- *"Validate this story: …"* or *"Generate the stories for area Y and check them"* → qa-mafia.
- New bugs, risks and questions land in `docs/local/OPEN-ISSUES.md` with IDs; direct work by ID
  ("fix BUG-12 and SEC-3"). Items leave the open list as soon as their fix merges.
- For parallel batches, ask the orchestrator to split by file area and run each `code-ninja` in
  its own worktree; validate with `bug-hunter` per branch, one e2e run at a time.
