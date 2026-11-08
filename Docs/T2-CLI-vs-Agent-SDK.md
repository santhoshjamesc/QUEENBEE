# T2 — Claude Code CLI vs Agent SDK (evidence and recommendation)

Status: DELIVERED. Constraint from user: **zero cost** for the builder and for end users. Evidence date: 2026-11-07, Claude Code 2.1.319.

## 1. Decisive findings

1. **The Agent SDK is a wrapper around the same Claude Code binary.** Docs: "A library that runs the Claude Code binary"; the TS package bundles a native binary per platform and spawns it as a subprocess (`claude.exe` on Windows). So there is no capability only the SDK has at the engine level; the SDK is a convenience layer.
2. **Auth/cost rule (Anthropic legal page, verbatim):** third-party developers "should use API key authentication ... Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users." The overview says the same for products "built on the Claude Agent SDK". An end user *may* sign in to the **unmodified Claude Code binary** with their own subscription.
   - Consequence: an SDK-based Queen that makes users log in or reuses their subscription token is not permitted. An API-key route costs money, which violates the zero-cost constraint.
   - The compliant zero-cost path is: Queen launches the **user's own installed, already-logged-in `claude` binary** and never reads, stores or forwards credentials. Whether a desktop orchestrator spawning that binary counts as "unmodified Claude Code" is not explicitly addressed by the docs — **this is a residual policy risk the user must accept** (see §5).
3. **Local test (this machine):** `claude -p --input-format stream-json --output-format stream-json --verbose` ran on the existing subscription login with no API key, returned structured events (`system/init`, `assistant`, `rate_limit_event` with 5-hour window utilization, `result` with `session_id`). Cost reported was $0.0027 (subscription usage, no billing).

## 2. Comparison

| Need (spec) | CLI (headless `-p` stream-json) | CLI (interactive PTY) | Agent SDK (TS) |
|---|---|---|---|
| Real Claude Code session | Yes | Yes | Yes (spawns binary) |
| Structured events for office/watchdog | Yes: stream-json, `--include-hook-events`, `--include-partial-messages` | No (screen scraping) | Yes (same events, typed) |
| Terminal view | Reconstruct from tool_use/tool_result events | Native terminal fidelity (node-pty) | Reconstruct from events |
| Approve sensitive commands | `--permission-prompts host` / `--permission-prompt-tool` (MCP tool Queen provides) and PreToolUse / PermissionRequest hooks | Hooks only, plus human typing in the PTY | `canUseTool` (only when flow falls through to prompt) + hooks |
| Hard scope enforcement | PreToolUse hook (exit code 2 / `deny`) via `--settings` JSON, runs outside the model | same | same hooks |
| Pause | No true pause; use interrupt-by-process-signal or stop and `--resume` | Esc / signal | `interrupt()` (streaming input only); no pause |
| Stop / restart | Kill process; `--resume <id>` or `--session-id <uuid>` | same | `close()`; `resume` option |
| Multi-session | One process per worker; `--session-id` gives Queen a known UUID | same | One `query()` per worker |
| Crash recovery | Transcripts persist on disk; `--resume`; Queen's own SQLite stores mapping | same | `listSessions`, `getSessionMessages`, `resume` |
| Set mode live | Restart or hook-driven | no | `setPermissionMode()` (streaming only) |
| Skills / agents / plugins | `--agents`, `--plugin-dir`, `.claude/skills`, `--setting-sources` | same | same via options |
| Windows | `claude.exe`; hooks run bash or PowerShell; exec-form hooks need real `.exe` | PTY via ConPTY (node-pty supports) | bundled `claude.exe` |
| Cost to user | Own subscription login | same | API key required to be compliant |
| Extra dependency | None | node-pty (native module, MIT, needs rebuild for Electron) | npm package (license: "see README", commercial terms) |

## 3. Verified skills behavior (for the skills milestone)
Locations: enterprise > personal (`~/.claude/skills`) > project (`.claude/skills`); nested dirs load when files there are touched; plugin skills are namespaced; `--add-dir` skills load, first-added wins. Skills are not private to an agent, so per-agent control must use `--setting-sources`, `--add-dir`, `--plugin-dir`, `--agents` and per-worker `--settings`.

### 3.1 Empirically verified on claude 2.1.319 (2026-11-08, M6 pre-check)
Method: `--output-format stream-json` init event `skills` list, plus a haiku question for which duplicate won.
- Skill identity = **directory name**, not the frontmatter `name`.
- Same name in personal (`~/.claude/skills`) and project (`.claude/skills`): **personal wins**, only one entry is listed. Confirmed with a temporary personal skill (removed afterwards).
- `--add-dir <d>` with `<d>/.claude/skills/x`: loads as `x`; if `x` already exists it is kept **side by side as `<dirname>:x`** (not "first wins" as first assumed above).
- `--plugin-dir <p>`: skills are namespaced `<plugin name>:<skill>`; a same-named project skill is not shadowed.
- `--setting-sources project` keeps project skills, drops user plugins/personal; `--setting-sources ""` drops project and personal skills too. About 19 bundled skills (batch, loop, simplify, ...) always remain.
- `--disable-slash-commands` removes every skill, bundled ones too.
- Consequence for M6: to give a worker exactly the assigned skills, run it with `--setting-sources ""` plus one generated `--plugin-dir` (skills appear as `queen:<name>`). The bundled skills cannot be removed individually. Skills are guidance, not a security boundary; the hook gate stays the enforcement.

## 4. Recommendation (for user approval at T3 — not chosen yet)
**Primary: headless CLI, one `claude -p --input-format stream-json --output-format stream-json` process per worker/Queen, spawned from Electron's main process using the user's installed `claude`.**
- Hard enforcement in app code: per-worker `--settings` JSON registering PreToolUse/PermissionRequest hooks that call a small local Queen hook endpoint (allow/deny/ask by scope, file ownership, command rules). This is not prompt-only.
- Terminal view: render command and output from tool events (no PTY needed for MVP). Optional later: PTY "attach" for the user to take over a session (`claude --resume <id>`), only if the user asks.
- Do **not** bundle or depend on the Agent SDK. This avoids the API-key requirement, keeps zero cost, and loses no capability, since the SDK wraps the same binary.
- API-key storage: keep as optional passthrough of the user's own `ANTHROPIC_API_KEY` env var only; Queen stores no secrets by default.

Rejected: SDK as primary (policy and cost); PTY-only (no structured events, fragile scraping).

## 5. Risks and unknowns
1. **Policy risk:** orchestrating the user's own CLI is not explicitly blessed or banned. Mitigations: never touch OAuth tokens, no login UI, no proxying, per-user own binary; user should read the legal page.
2. **Usage limits:** many concurrent workers drain one subscription's 5-hour window quickly. `rate_limit_event` is available; Queen should read it and throttle (default max workers small, user-configurable).
3. **No true pause:** "pause" = interrupt current turn and hold the worker; resumes via a new message.
4. **Hook semantics:** `defer`/`allow` details were from summarised docs; verify with a spike test in M1 before relying on them.
5. **Not tested:** Windows (no machine), `--permission-prompt-tool` in practice, long-running crash/resume. Scheduled for the first milestone spike.

## Sources
- https://code.claude.com/docs/en/agent-sdk/overview
- https://code.claude.com/docs/en/agent-sdk/typescript
- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/legal-and-compliance
- Local: `claude --help` (2.1.319) and a stream-json run on this machine.
