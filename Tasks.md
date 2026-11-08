# Queen — 7 Tasks (derived from Task.md §22 Development Process)

Each task starts only after the previous gate is approved by the user (Task.md §2.1).

## T1. Discovery and requirements clarification (Stage 1)
- **Objective:** Understand the current state and get the user's answers to open questions.
- **Work:** Inspect the repo (greenfield: only Task.md), compare it with the spec, list gaps and uncertainties, ask the 12 clarification questions, document the answers as requirements.
- **Constraint:** Do not modify code.
- **Done when:** The user has answered the questions and the requirements document is recorded.
- **Gate:** User confirms the requirements.

## T2. Claude Code CLI vs Agent SDK investigation (Stage 1, §5)
- **Objective:** Decide on evidence how real Claude Code sessions are created and managed.
- **Work:** Compare the CLI (PTY, `--resume`, `--output-format stream-json`, hooks, permission modes) with the Agent SDK (structured events, `canUseTool`, session resume, interruption). Cover multi-session, pause/stop/restart, crash recovery and Windows behavior.
- **Done when:** A written comparison with evidence and a recommendation is delivered.
- **Gate:** Feeds T3. No integration is chosen without user approval.

## T3. Architecture proposal (Stage 2, §18)
- **Objective:** Present the architecture for approval.
- **Work:** Cover the technology stack and trade-offs (Electron / Tauri etc.), module boundaries across the 14 components, data flow, Claude Code integration strategy, agent lifecycle, Queen orchestration strategy, security model, persistence strategy.
- **Done when:** The proposal document is delivered.
- **Gate:** Explicit user approval.

## T4. Implementation planning (Stage 3)
- **Objective:** Turn the approved architecture into an executable plan.
- **Work:** Define milestones, task breakdown, dependencies, testing strategy and acceptance criteria (mapped to the 15 principles in §23).
- **Done when:** The plan is delivered.
- **Gate:** Explicit user approval before any code is written.

## T5. Controlled implementation (Stage 4)
- **Objective:** Build only the approved milestones, in the approved order.
- **Work:** Implement milestone by milestone (shell and first real session, then multi-session, Queen approval gate, task engine and broker, watchdog, skills, code intelligence, office). Monitor and verify each milestone.
- **Rules:** No unrequested features. Stop and report on any deviation (§2.4).
- **Done when:** Each milestone is verified against its acceptance criteria.
- **Gate:** User sign-off per milestone.

## T6. Testing and verification (Stage 5)
- **Objective:** Prove the acceptance principles with tests.
- **Work:** Test multiple sessions, concurrent workers, interruption and recovery, scope protection, communication, skill assignment, code intelligence, and macOS and Windows compatibility.
- **Done when:** A test results report exists. Failures are reported honestly, not hidden.

## T7. Final review and report (Stage 6)
- **Objective:** Give the user an accurate final status.
- **Work:** List implemented, verified and incomplete features, known limitations, test results and outstanding issues.
- **Rule:** Never report unimplemented features as completed.
- **Gate:** User accepts the product.
