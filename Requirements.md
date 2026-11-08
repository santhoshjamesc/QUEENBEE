# Queen — Requirements (Task 1 output)

Source spec: `Task.md`. Status: **DRAFT — awaiting user confirmation (Task 1 gate).**
Nothing here adds to the spec; items marked "decided" come from the user's answers on 2026-11-07.

## 1. Current state
- Greenfield. The folder contains only `Task.md`, `Tasks.md`, `Tasks/`, and this file. No code, no git repo, no manifests.
- Local environment: macOS (arm64), Node v26.4.0, npm, Claude Code CLI 2.1.319, Python 3. Rust/Cargo not installed.
- Nothing from the spec is implemented yet. All of §3–§21 is outstanding.

## 2. Decisions (from user answers)
| Topic | Decision |
|---|---|
| Desktop stack | Electron + React + TypeScript. (Final stack still confirmed at T3 gate.) |
| Authentication | Support both: reuse the existing Claude Code login, or an API key stored by Queen (OS keychain). |
| Approval model | User approves the plan; sensitive/dangerous commands and out-of-scope edits prompt individually; safe actions follow configurable rules. |
| Concurrency | Agents share the real project folder. No Git dependency or Git features. Conflicts are prevented at application level by Queen (file ownership/approvals) and the watchdog, not by worktrees. |
| Milestone order | Shell + first real session → multi-session → Queen approval gate → task engine + broker → watchdog → skills → code intelligence → office. |
| UI language | English only. |
| Office style | 2D top-down pixel art. |
| CLI vs Agent SDK | Compare equally in Task 2; no choice until the user approves. |
| Queen's nature | Queen runs as its own real Claude Code session; approvals, locks and gates are enforced in application code, not only prompts. |
| Worker count | User-configurable; no fixed target. |
| Persistence | Local SQLite. |
| Platforms | macOS and Windows (spec §1, §23.14). |

## 3. Requirements (taken from Task.md, unchanged)
- Queen asks questions and waits for explicit approval before any work (§2.1, §23.1–2). Workers cannot start early (§23.3).
- No invented features, no scope expansion, deviations stop work and are reported (§2.2, §2.4).
- Real Claude Code sessions per worker, not simulated chats (§5).
- Custom and predefined agents with the §6 fields.
- Controlled communication: Queen↔worker, worker↔worker, user-visible records (§7).
- Watchdog with evidence, confidence levels, and false-positive care (§8).
- Office reflects real state only, plus non-office monitoring views (§9, §17).
- Skills follow real Claude Code conventions; HYBRID approval policy (§10).
- Shared code intelligence using AST/LSP/static analysis, never silently editing code (§11).
- Workspace, terminal views, task/dependency engine, verification workflow, user control center, dashboard (§12–§17).
- Out of scope: other providers, general chat, Git suite, project-management platform (§21).

## 4. Gaps and ambiguities still open
These do not block T1 but must be resolved in later tasks:
1. **CLI vs Agent SDK:** capability differences (permission callbacks, pause/interrupt, resume, Windows behavior) are unknown. Resolved by Task 2.
2. **Hard enforcement of file ownership:** Claude Code runs its own tools, so blocking out-of-scope edits needs permission hooks or SDK callbacks. Feasibility depends on Task 2.
3. **Queen as a Claude Code session:** how Queen's decisions become enforced app actions (structured output, tool/MCP interface) is an architecture question for T3.
4. **Code intelligence scope:** languages to support first for AST/LSP indexing is not specified.
5. **Skill precedence:** exact Claude Code skill discovery/precedence behavior must be verified before the skills milestone.
6. **Windows testing:** no Windows machine is confirmed for T6; availability is unknown.
7. **Distribution:** installers, code signing and auto-update are not specified, so they are treated as out of scope unless you request them.
8. **Rate limits/cost:** behavior when many workers hit Claude usage limits is unspecified.

## 5. Constraints
- Task 1 and Stage 1 must not modify code. Only this document was written.
- Each stage waits for explicit user approval (T2→T7 gates).

## 6. Confirmation
Awaiting user confirmation of this document (Task 1 gate).
