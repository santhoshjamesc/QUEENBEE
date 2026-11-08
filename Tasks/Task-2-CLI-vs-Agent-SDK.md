# Task 2: Claude Code CLI vs Agent SDK Investigation (Stage 1, spec §5)

**Objective:** Decide, on evidence, how real Claude Code sessions are created and managed.

## Work
- Compare the CLI (PTY, `--resume`, `--output-format stream-json`, hooks, permission modes) with the Agent SDK (structured events, `canUseTool`, session resume, interruption).
- Cover multi-session, pause/stop/restart, crash recovery and Windows behavior.
- Do not assume the two interfaces have identical features.

## Done when
A written comparison with evidence and a recommendation is delivered.

## Gate
Feeds Task 3. No integration is chosen without user approval.
