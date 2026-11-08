# T3 — Queen Architecture Proposal

Status: DELIVERED. Based on Requirements.md and T2. Hard constraint: **every dependency free/open-source; no paid services, no API key, no code-signing certificate, no paid assets.**

## 1. Technology stack and trade-offs

| Layer | Choice | License | Why / trade-off |
|---|---|---|---|
| Shell | Electron + electron-vite | MIT | Same language as everything else; reliable child-process control on macOS+Windows. Cost: ~150 MB RAM baseline, big installer. Tauri rejected: Rust not installed, needs Node sidecar anyway. |
| UI | React + TypeScript + Zustand, CSS modules | MIT | Familiar, no extra framework. |
| Office | HTML Canvas 2D, sprites generated in code (pixel grids) | own | No paid art, low CPU, throttled to 30 fps and paused when hidden. |
| Terminal view | xterm.js fed from tool events | MIT | Looks like a terminal; no PTY required in v1. |
| Persistence | SQLite via `better-sqlite3` (WAL mode) | MIT | Crash-safe, queryable. Cost: native module must be rebuilt for Electron (`electron-rebuild`). Fallback: `node:sqlite` if Electron's Node supports it. FTS5 gives free text search. |
| File watching | chokidar | MIT | Ground truth for "what files changed", independent of agent claims. |
| AST / symbols | web-tree-sitter (WASM) + prebuilt grammars | MIT | No native build, works on both OS. v1 languages: TypeScript/JavaScript, Python, then others on request. |
| Semantic search | SQLite FTS5 + symbol-name/identifier ranking (v1). Optional local embeddings later only if user asks. | — | Embedding APIs cost money; local models are heavy. Honest label: "semantic-ish" in v1. |
| Claude Code integration | Spawn user's installed `claude` (headless stream-json) | n/a | Per T2: zero cost, no credentials handled. Agent SDK **not** used. |
| Tests | Vitest (unit), Playwright-Electron (e2e) | MIT | Free. |
| Packaging | electron-builder, **unsigned** builds | MIT | Signing costs money. Users see Gatekeeper/SmartScreen warnings; documented one-time bypass. Auto-update out of scope. |

## 2. Process model

```
Electron main (Node)                          Renderer (React)           Child processes
┌───────────────────────────────┐   IPC     ┌──────────────────┐      ┌────────────────────┐
│ Core services (modules §3)    │◄─────────►│ Dashboard, Office│      │ claude (Queen)     │
│  - SQLite, event bus          │ typed     │ Terminals, Skills│      │ claude (worker N)  │
│  - Local control server       │ channel   │ Approvals, Intel │      └────────────────────┘
│    (127.0.0.1, random port,   │           └──────────────────┘            ▲ hooks + MCP
│     per-session token)        │◄───────────────────────────────────────────┘ over localhost
└───────────────────────────────┘
Worker process (utility): code-intelligence indexer (tree-sitter) — off the main thread
```
The local control server (HTTP) offers two endpoints per session: `/hook` (receives PreToolUse/PermissionRequest/etc. from Claude Code hooks) and `/mcp` (Queen tools for communication). Bound to loopback, authenticated by a per-session random token injected through the session's `--settings`/`--mcp-config`.

## 3. Modules (the 14 components)

| # | Module | Responsibility | Depends on |
|---|---|---|---|
| 1 | Desktop shell | Windows, menus, IPC, lifecycle | — |
| 2 | UI layer | Dashboard, approvals, sessions, comms, skills, intel views | 1 |
| 3 | Queen orchestration | Hosts Queen session; state machine Intake→Questions→Plan→Approval→Execute→Verify→Report | 4,6,7,14 |
| 4 | Claude process manager | Spawn/stop/resume `claude`, stream-json parser, per-session event log | 13 |
| 5 | Agent lifecycle manager | Agent definitions, status machine, worker↔session binding | 4,13 |
| 6 | Communication broker | Messages Queen↔worker↔worker, routed and logged, size/relevance limits | 13 |
| 7 | Task & dependency engine | Tasks, DAG, parallel/sequential, handoff, completion verification | 13 |
| 8 | Scope watchdog | Rules + evidence + confidence, pause requests | 4,7,11,12,13 |
| 9 | Code intelligence | Index, symbol/ref search, impact, dup/dead-code/cycle detection (read-only) | 11,13 |
| 10 | Skills management | Discover/assign/version skills, hybrid approval | 11,13,14 |
| 11 | Project workspace | Open project, file tree, chokidar, file→agent attribution, ownership leases | 13 |
| 12 | Terminal monitor | Command history, process status, interrupt, xterm rendering | 4 |
| 13 | Persistence | SQLite schema, migrations, event store | — |
| 14 | Permission & approval | Single policy engine; all allow/deny/ask decisions | 13 |

Boundary rule: modules talk through the in-process event bus and typed interfaces; only module 13 touches SQLite; only module 4 spawns processes; only module 14 decides permissions.

## 4. Claude Code integration strategy
- One headless process per session: `claude -p --input-format stream-json --output-format stream-json --verbose --include-hook-events --session-id <uuid> --setting-sources user --settings <per-worker.json> --mcp-config <per-worker.json> --strict-mcp-config --permission-mode manual --append-system-prompt <role+scope>`.
- Messages in via stdin (stream-json); events out parsed into the event store: assistant text, tool_use, tool_result, hook events, `rate_limit_event`, `result`.
- Per-worker settings register hooks (PreToolUse, PermissionRequest, PostToolUse, Stop) pointing at the control server. Hooks run outside the model, so enforcement is not prompt-only.
- Resume after crash/restart: `--resume <session-id>`. Queen's SQLite maps agent→session id and last event offset.
- Binary discovery: `claude` on PATH, then known install paths (`~/.local/bin`). If missing or not logged in, the app shows setup instructions and does not handle login itself.
- A spike (M1) verifies hook decisions, interrupt behavior and resume on this machine before deeper work.

## 5. Agent lifecycle
`defined → spawning → idle → assigned → working ⇄ thinking → waiting(approval|worker|user) → blocked → verifying → completed | failed | stopped`. Transitions are driven by real events (process state, tool events, hook callbacks). A worker's session is created only when Queen has an **approved** plan containing that worker; the process manager refuses to spawn otherwise (code-level gate). Pause = interrupt the current turn and hold new messages; Stop = terminate; Restart = terminate then `--resume`.

## 6. Queen orchestration strategy
- Queen is its own `claude` session, with an MCP toolset served by the app: `ask_user(questions)`, `submit_plan(plan)`, `create_task`, `assign_task`, `message_worker`, `request_scope_change`, `report_status`. Tools only *request*; the app validates and executes.
- Code-enforced state machine (the real guarantee for spec §2.1 and §23.1–3):
  1. New request → state `Intake`. `submit_plan` is rejected until at least one `ask_user` round has completed (or the user marks "no questions needed").
  2. `submit_plan` → state `AwaitingApproval`. UI shows plan; only the user's click moves to `Approved`.
  3. Only in `Approved` can `assign_task` spawn/instruct workers. Scope changes go back to `AwaitingApproval`.
- Verification (spec §15): after a worker's `Stop`/completion claim, app collects git-free diffs (own file snapshot hashes), runs authorized test commands, compares to completion criteria; Queen reviews; status `verified` only when checks pass, else `awaiting-verification`/`failed`.
- Context control: Queen passes workers a task brief plus relevant files/symbols from code intelligence, not the whole transcript.

## 7. Data flow (one request)
User message → Queen session → `ask_user` → UI questions → answers → Queen → `submit_plan` → UI approval → state `Approved` → tasks written to DB → process manager spawns workers → worker events → event bus → (UI, office, watchdog, terminal) ; worker tool calls → hook endpoint → permission engine (+ watchdog rules, file leases) → allow/deny/ask-user → worker continues; completion → verification → Queen report → UI.

## 8. Conflict handling without Git (per user's decision)
- **File leases:** each task declares permitted paths/globs; a write via hook acquires a short lease on the file for that agent. A second agent's write to a leased file is denied with "owned by X"; Queen is notified and sequences the work.
- **Snapshots:** before the first write per task, the app stores a content hash/copy of the file in its own store so that changes can be shown as diffs and reverted on user request. Not a Git replacement.
- Out-of-scope write → watchdog evaluates (dependency of the task? matches plan?) → allow with note, ask Queen/user, or deny. Confidence and evidence recorded.
- Bash commands can modify files invisibly to hooks; chokidar detects the actual change and attributes it to the sessions running at that time, flagged "attribution uncertain" if more than one.

## 9. Watchdog
Layers, cheapest first: (1) deterministic rules: path scope, forbidden commands, new dependency in manifest, repeated identical failures, inactivity timers, wait-for cycles (deadlock) from task DAG; (2) ground truth from chokidar; (3) optional judgment by Queen for ambiguous cases, returning a verdict and rationale. Each alert stores evidence, rule id, confidence (low/medium/high), and response (note, ask worker to explain, pause, ask user). No claim of perfect detection; UI shows evidence.

## 10. Security model
- Loopback-only control server, random port, per-session token, rejects non-matching origin.
- Project boundary: workers get `--add-dir` only for the project; hook denies paths outside it (resolving symlinks). Optionally `--restricted` mode flags are used for review-only agents.
- Default policy: read tools allowed; edits allowed inside task scope; shell commands matched against allow/ask/deny lists (user-editable); destructive patterns (`rm -rf`, `git push`, network installs, writing outside project) always ask. `bypassPermissions` mode is never used by the app.
- No credentials stored by default. Optional user-provided `ANTHROPIC_API_KEY` is passed from the environment only. Logs redact env and token values.
- Crash handling: every event is written to SQLite before UI use; on restart Queen reconciles sessions (alive? resume?) and shows a recovery panel.

## 11. Persistence (SQLite, WAL)
Tables: `projects`, `agents`, `sessions`, `events` (append-only, per session), `tasks`, `task_deps`, `messages`, `approvals`, `plans`, `alerts`, `file_activity`, `file_snapshots`, `leases`, `skills_index`, `skill_versions`, `code_symbols`, `code_refs`, `code_imports`, `settings`. Migrations by numbered SQL files. DB stored in the app data directory; per-project data keyed by project path. Event payloads capped and large outputs stored as truncated text with a size note.

## 12. Skills (hybrid policy, enforced in code)
Scan `~/.claude/skills`, `<project>/.claude/skills`, plugin dirs; parse SKILL.md frontmatter; detect duplicates (name/description similarity), conflicts (contradictory directives via heuristics, flagged for review), outdated (mtime vs referenced files). Assigning = writing per-worker `--settings`/`--plugin-dir`/`--agents` so only chosen skills are exposed. Creating/modifying/replacing a shared skill creates an `approval` row; the write happens only after the user approves; versions stored in `skill_versions` for restore.

## 13. Out of scope (kept out unless approved)
Git features, other AI providers, general chat, auto-update, code signing, cloud sync, embeddings, i18n, PTY takeover.

## 14. Items needing explicit user decision
1. Accept the policy risk in T2 §5 (spawning the user's own `claude`).
2. Unsigned installers with OS warnings.
3. Semantic search limited to FTS5 + symbol ranking in v1.

Given your instruction to proceed automatically, these are treated as accepted defaults; tell me to change any.
