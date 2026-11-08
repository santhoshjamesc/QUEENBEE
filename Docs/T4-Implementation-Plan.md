# T4 — Implementation Plan

Status: DELIVERED. Follows T3. Zero-cost tooling only. Order fixed by user: shell+session → multi-session → approval gate → tasks/broker → watchdog → skills → code intel → office.

## Milestones

| M | Name | Scope | Depends | Acceptance (verified by) |
|---|---|---|---|---|
| M0 | Scaffold | electron-vite + React + TS project, lint, Vitest, SQLite open + migrations, typed IPC | — | App launches; `npm test` passes; DB file created (unit + manual launch) |
| M1 | Shell + first real session | Binary discovery, spawn one `claude` headless, stream-json parser, event store, session view (xterm from events), stop/resume; spike for hooks/interrupt | M0 | Real prompt answered by real claude; events in SQLite; stop then `--resume` continues same conversation (integration test against real CLI) |
| M2 | Multi-session | N concurrent sessions, per-session status, crash detection and recovery, configurable max, rate-limit event display | M1 | 3 sessions run concurrently with isolated contexts; kill -9 one → detected, resume works; ≈ principle 4 |
| M3 | Queen + approval gate | Queen session with app MCP tools; state machine Intake→Questions→Plan→Approval; permission engine + hook endpoint; approval UI | M2 | Worker spawn refused before approval (unit); Queen must ask before plan (unit); sensitive command prompts user (integration); principles 1,2,3,15 |
| M4 | Tasks + broker | Task DAG, assignment, parallel/sequential, handoff, broker messages, verification workflow, user control center | M3 | DAG ordering test; worker→worker message routed and logged; completion not "verified" without checks; principles 5,6,8 partial, 13 |
| M5 | Watchdog + leases | File leases, scope rules, chokidar attribution, inactivity/deadlock/repeat-failure detection, alerts with evidence/confidence, pause/resume | M4 | Out-of-scope write denied/flagged with evidence; legitimate dependency edit not flagged (fixture tests); lease conflict handled; principle 7,8 |
| M6 | Skills | Discovery, search, assign per worker, hybrid approval for shared-skill changes, versions/restore, duplicate/conflict/outdated detection | M3 | Existing skill reused without approval; create/modify requires approval (test); restore version works; principles 10,11 |
| M7 | Code intelligence | Project indexer (tree-sitter), symbol/reference/import search, dependency graph, impact, cycles, dup/dead-code heuristics, relevant-context for tasks | M4 | Index of a fixture repo returns correct symbols/refs; cycle detected; read-only guarantee test; principle 12 |
| M8 | Office | Canvas pixel office driven only by event store state; click-through to session/terminal/comm/files/skills; list view alternative | M2 | Every character state maps to a real session state (test); no activity without an event; CPU idle check; principle 9 |
| M9 | Dashboard polish + packaging | Dashboard aggregation, errors panel, unsigned mac/win build config | all | Build artifacts produced on mac; Windows build config only (see below) |

## Cross-cutting testing strategy
- **Unit (Vitest):** state machines, permission engine, lease logic, DAG, parsers, skill discovery.
- **Integration with real Claude Code:** small prompts on `--model haiku`, minimal tokens, run sparingly to protect the user's subscription window.
- **Fixture projects:** tiny repos for watchdog and code intelligence tests.
- **E2E:** Playwright-Electron smoke for launch, approval flow with a fake `claude` stub (for determinism, no usage) plus a few real runs.
- **Fake CLI stub:** scripted binary emitting stream-json so most tests cost nothing.
- **Windows:** no Windows machine available → code uses cross-platform path/process APIs, CI-free; Windows is reported as **untested** in T6/T7 unless a machine is provided. No claim of compatibility without testing.

## Principle → test mapping (spec §23)
1 ask before work → M3 unit; 2 wait for approval → M3 unit; 3 workers can't start early → M3 spawn-refusal test; 4 real independent sessions → M2; 5 Queen coordinates → M4; 6 controlled comms → M4; 7 watchdog → M5; 8 Queen intervenes → M5/M4 (pause/reassign); 9 office real state → M8; 10 skills reused → M6; 11 skill approval → M6; 12 code intel → M7; 13 agents edit/test real code → M4 integration; 14 mac+Windows → M9 mac only, Windows untested; 15 never silently change requirements → M3 plan-hash check (changed plan requires re-approval).

## Rules during implementation
No unrequested features. Any approach failure → stop and report per §2.4. Each milestone ends with a verification note in `Docs/Progress.md` stating verified/unverified honestly.
