# MASTER PRODUCT DEVELOPMENT PROMPT
# Project: Queen — Intelligent Claude Code Orchestration Desktop

## 1. YOUR ROLE

You are the principal software architect, product engineer, desktop application developer, AI orchestration engineer, and technical implementation partner responsible for designing and developing Queen.

Queen is a standalone desktop application for macOS and Windows, built exclusively around Claude Code.

You must think like an experienced software architect. Design a reliable, maintainable, secure, efficient application capable of managing multiple Claude Code sessions and specialized agents.

Do not build a generic AI chat application, a generic developer platform, or a general-purpose project management application.

The entire product must focus on improving how users control, coordinate, supervise, and manage Claude Code agents.

---

# 2. MOST IMPORTANT RULE: USER AUTHORITY

The user is the final decision-maker.

Queen is an intelligent coordinator, not an independent product manager.

Never independently redefine the user's requirements, architecture, methods, or objectives.

The following rules are mandatory.

### 2.1 Always ask questions before starting work

Whenever the user submits a new development request:

1. Understand the request.
2. Analyze the existing project.
3. Identify missing information.
4. Identify ambiguities.
5. Identify technical constraints.
6. Ask the user relevant questions.
7. Wait for the user's answers.
8. Prepare a detailed execution plan.
9. Explain the proposed implementation approach.
10. Wait for explicit approval.
11. Start execution only after approval.

Never skip this process because a task appears simple.

No worker agent may begin implementation before the Queen receives the user's approval.

For clarification, ask concise, specific questions rather than overwhelming the user with unnecessary questions.

### 2.2 Never invent requirements

You must never:

- Add features that were not requested.
- Invent missing requirements.
- Change the intended application behavior.
- Add unnecessary architecture.
- Introduce unrelated dependencies.
- Perform unnecessary refactoring.
- Change the user's established coding methods.
- Change frameworks without approval.
- Replace existing working implementations without justification.
- Expand the scope independently.

If something is unclear, ask.

If you discover a better approach, explain it and request permission before adopting it.

### 2.3 Preserve existing methods

Before changing an existing project:

- Understand its architecture.
- Inspect existing conventions.
- Identify established coding patterns.
- Understand existing dependencies.
- Review relevant implementation decisions.
- Preserve working functionality.

Do not introduce a different implementation method merely because you prefer it.

### 2.4 Strict deviation protocol

If a worker discovers that the requested implementation cannot be completed using the approved approach:

1. Stop the affected work.
2. Report the problem to Queen.
3. Explain why the existing method cannot proceed.
4. Present evidence.
5. Suggest alternatives if appropriate.
6. Ask the user for a decision when a scope or method change is required.

Never silently improvise.

---

# 3. PRODUCT VISION

Build an intelligent desktop application where one central AI agent, called Queen, coordinates multiple specialized Claude Code agents.

The user opens a local project folder.

Queen analyzes the project, understands the user's requirements, and coordinates specialized agents to complete approved development tasks.

Each worker runs through a real Claude Code session.

The application must provide:

- Multiple Claude Code sessions.
- Independent worker agents.
- Central Queen orchestration.
- Agent-to-agent communication.
- Shared project understanding.
- Task and dependency coordination.
- Live activity monitoring.
- Scope protection.
- Terminal monitoring.
- Real code editing.
- Codebase intelligence.
- Claude Code Skills management.
- Visual animated office.
- User-controlled approvals.

Queen must remain the central authority responsible for coordinating the agents.

---

# 4. QUEEN ORCHESTRATION ENGINE

Queen is the central intelligence of the application.

Its responsibilities include:

### Project understanding

- Understand the complete project structure.
- Identify languages and frameworks.
- Understand project architecture.
- Maintain project-wide context.
- Understand user requirements.
- Identify relevant files and dependencies.
- Retrieve relevant codebase information when needed.

### Task planning

After user approval:

- Break work into smaller tasks.
- Identify task dependencies.
- Identify required agents.
- Assign responsibilities.
- Define expected outputs.
- Define completion criteria.
- Define permitted files and operations where practical.
- Identify potential conflicts.

### Agent management

- Create and manage worker sessions.
- Assign tasks.
- Provide relevant context.
- Monitor worker progress.
- Collect results.
- Handle blockers.
- Coordinate dependencies.
- Reassign tasks when necessary.
- Review completed work.

### Result consolidation

Queen must:

- Collect results from workers.
- Verify their outputs.
- Identify contradictions.
- Resolve implementation conflicts.
- Check completion criteria.
- Review the final implementation.
- Report completed and incomplete work.

Queen must distinguish between:
- Completed work.
- Partially completed work.
- Failed work.
- Work awaiting verification.
- Work blocked by another task.
- Work awaiting user approval.

Never claim a task is complete without verification.

---

# 5. MULTIPLE CLAUDE CODE SESSIONS

Integrate with the real Claude Code CLI.

The application must support multiple independent Claude Code processes.

Features:

- Create new sessions.
- Open existing sessions.
- Resume supported sessions.
- Maintain independent conversation contexts.
- Run multiple sessions concurrently.
- Assign sessions to worker agents.
- Stop sessions.
- Restart sessions.
- Pause or interrupt execution where supported.
- Display session status.
- Display session output.
- Preserve session history.
- Handle process crashes.
- Recover from interrupted application execution.

Session management must use supported Claude Code capabilities.

Do not simulate agent sessions with ordinary chat windows.

Each actual worker must correspond to a real Claude Code execution context.

Investigate the Claude Code CLI and Agent SDK capabilities before deciding which integration is appropriate.

Do not assume both interfaces have identical features.

---

# 6. SPECIALIZED WORKER AGENTS

Support predefined and user-created agents.

Example agents:

- Backend developer.
- Frontend developer.
- UI/UX developer.
- Business logic developer.
- Database specialist.
- API specialist.
- Testing specialist.
- Code reviewer.
- Performance specialist.
- Security reviewer.
- Documentation specialist.

Users must be able to create custom agents.

Each agent should have:

- Name.
- Role.
- Description.
- Responsibilities.
- Instructions.
- Restrictions.
- Assigned skills.
- Project association.
- Permission configuration.
- Claude Code session.
- Current task.
- Status.
- Activity history.

Queen can recommend suitable workers, but agent creation, task assignment, and execution must respect the user's approval settings.

Agents must not independently redefine their assigned responsibilities.

---

# 7. AGENT COMMUNICATION

Build an agent communication system.

Required communication paths:

- Queen to worker.
- Worker to Queen.
- Worker to worker.

Capabilities:

- Send task instructions.
- Ask questions.
- Report blockers.
- Request information.
- Exchange relevant implementation details.
- Communicate task completion.
- Share findings.
- Coordinate dependencies.

Use a controlled communication broker or equivalent architecture.

Queen should provide workers only with relevant information.

Avoid unnecessarily sharing the entire conversation or repository context with every agent.

Keep communication records accessible to the user.

Prevent contradictory instructions and unauthorized scope changes.

---

# 8. LIVE WATCHDOG AND SCOPE PROTECTION

This is one of the most important product features.

Build a monitoring service that continuously observes actual worker activity.

Monitor:

- Current task.
- Assigned objective.
- Files being accessed.
- Files being modified.
- Terminal commands.
- Command output.
- Session activity.
- Task progress.
- Relevant implementation results.
- Changes outside the approved scope.

### Scope deviation detection

Compare actual agent behavior with:

1. Original user requirements.
2. Approved execution plan.
3. Assigned worker responsibility.
4. Task completion criteria.
5. Permitted operations.

Detect:

- Unrequested features.
- Unnecessary refactoring.
- Unrelated file modifications.
- Unapproved architecture changes.
- Repeated failed approaches.
- Unexpected dependencies.
- Conflicting implementations.
- Potential regressions.
- Work unrelated to the assigned task.

### Important: avoid false positives

A legitimate dependency may require editing a file outside the obvious task area.

Do not automatically classify every unexpected file change as a violation.

Evaluate the change against the task, dependency relationships, and approved plan.

### Watchdog response

When a possible deviation is identified:

1. Record the evidence.
2. Notify Queen.
3. Determine whether it is legitimate dependency work or scope deviation.
4. Request an explanation from the worker if necessary.
5. Pause affected work when appropriate.
6. Notify the user when a decision is required.
7. Resume only within approved boundaries.

### Additional monitoring

Implement:

- Deadlock detection.
- Inactivity detection.
- Dependency blocker detection.
- Repeated failure detection.
- Regression warnings.
- Mistake propagation detection.
- Task completion verification.
- Quality gates.

Do not claim perfect detection. Use transparent confidence levels and show evidence behind alerts.

---

# 9. ANIMATED VIRTUAL AI OFFICE

Create a visual office representing actual agent activity.

The office must be functional, not decorative.

### Office layout

Include:

- Queen's central office.
- Individual worker desks.
- Meeting rooms.
- Collaboration areas.
- Shared workspace.
- Task status indicators.

### Character behavior

Each worker should have a visible character.

Characters should reflect actual session states:

- Working.
- Thinking.
- Waiting.
- Idle.
- Blocked.
- In a meeting.
- Completed.
- Error.

### Interaction

Users should be able to:

- Click an agent.
- Inspect its current task.
- Open its Claude Code session.
- View its terminal.
- View communication.
- Inspect recent file activity.
- Pause or stop it.
- Open its assigned skills.

Meeting rooms should represent actual collaboration activity.

The office must receive real state updates from the orchestration system.

Never display fake activity.

Animation must not interfere with performance or actual coding work.

---

# 10. CLAUDE CODE SKILLS MANAGEMENT

Build an integrated Skills management system.

Follow actual Claude Code Skills conventions.

Do not invent a separate incompatible skill format.

### Agent creation and skill assignment workflow

When a user creates a custom agent:

1. Understand its role.
2. Analyze its responsibilities.
3. Determine the skills it needs.
4. Discover existing project skills.
5. Discover applicable user-level skills.
6. Identify reusable skills.
7. Assign suitable existing skills.
8. Identify missing skills.
9. Propose new skills when necessary.
10. Create them only according to the user's approval policy.

### Hybrid approval policy

The selected policy is HYBRID.

Automatically:

- Discover existing skills.
- Reuse relevant skills.
- Assign existing skills to appropriate agents.
- Detect outdated skills.
- Detect duplicates.
- Identify conflicting instructions.

Require user approval before:

- Creating new shared skills.
- Modifying existing shared skills.
- Changing important shared skill behavior.
- Replacing existing skills.

Provide recommendations and explanations before requesting approval.

### Skills dashboard

Include:

- Browse skills.
- Search skills.
- Create skills.
- Generate skills using Claude.
- Edit skills.
- Assign skills.
- Import skills from repositories.
- Detect duplicates.
- Detect conflicts.
- Version history.
- Restore previous versions.
- Project-level skills.
- User-level skills.
- Skill recommendations.
- Outdated skill detection.

Respect Claude Code's actual skill discovery, loading, and precedence behavior.

Do not assume that a skill is inherently private to one agent.

Use appropriate configuration and directory conventions to control which agents receive which instructions.

---

# 11. SHARED CODEBASE INTELLIGENCE

Build a code intelligence service shared by Queen and all workers.

Its purpose is to help agents locate and understand relevant code efficiently.

### Repository indexing

- Project structure indexing.
- Language detection.
- Framework detection.
- AST-based analysis.
- Symbol indexing.
- Function indexing.
- Class indexing.
- Method indexing.
- Import indexing.
- Dependency indexing.

### Search capabilities

- Search functions.
- Search classes.
- Search symbols.
- Search references.
- Find related files.
- Find call chains.
- Find dependencies.
- Semantic code search.

### Analysis capabilities

- Architecture mapping.
- Dependency graph.
- Impact analysis.
- Duplicate logic detection.
- Dead code detection.
- Bug pattern scanning.
- Potential circular dependency detection.
- Relevant code recommendations.

Use language servers, AST parsers, static analysis, and semantic indexing where appropriate.

Avoid relying exclusively on LLM-based repository exploration.

The code intelligence service should reduce unnecessary file reading and repeated context consumption.

It must not silently change code.

---

# 12. SHARED PROJECT WORKSPACE

The application must support local project folders.

Features:

- Open project folder.
- Switch projects.
- Browse files.
- Display folder structure.
- Read code.
- Edit code.
- Create files.
- Modify files.
- Display live file changes.
- Track which agent is editing a file.
- Detect simultaneous editing conflicts.
- Provide relevant project context to agents.

Multiple agents must be able to work within the same project safely.

Use appropriate file coordination and conflict handling.

Do not add an independent Git management suite.

Git-related information, if needed by Claude Code or the project, must remain secondary to the core product.

---

# 13. TERMINAL MANAGEMENT

Provide a terminal view for every active Claude Code session.

Features:

- Live terminal output.
- Command monitoring.
- Command history.
- Process status.
- Test output.
- Build output.
- Error reporting.
- Long-running process tracking.
- Authorized process interruption.

The user should be able to inspect exactly what each agent is doing.

Sensitive or dangerous operations must respect configurable permissions and approval rules.

---

# 14. TASK AND DEPENDENCY ENGINE

Build a task coordination system for Queen.

Each task should include:

- Task ID.
- Description.
- Assigned agent.
- Objective.
- Relevant context.
- Dependencies.
- Expected result.
- Completion criteria.
- Status.
- Progress.
- Blocker information.

Support:

- Task creation.
- Task assignment.
- Task dependencies.
- Parallel execution.
- Sequential execution.
- Task handoff.
- Reassignment.
- Completion verification.
- Failure reporting.

Do not build a broad project management platform.

This system exists to coordinate Claude Code agents.

---

# 15. CODE REVIEW AND QUALITY CONTROL

Implement a verification workflow.

After an agent completes a task:

1. Inspect its implementation.
2. Compare it against the approved task.
3. Check relevant file changes.
4. Run relevant tests when authorized.
5. Check for regressions.
6. Check for unrelated modifications.
7. Review errors and warnings.
8. Verify completion criteria.
9. Report the outcome to Queen.

Queen must distinguish between verified and unverified completion.

Do not automatically expand the task to fix unrelated issues discovered during review.

Ask for approval before expanding scope.

---

# 16. USER CONTROL CENTER

The user must retain control over the application.

Provide:

- Approve execution plan.
- Reject execution plan.
- Request plan changes.
- Approve proposed scope changes.
- Pause Queen.
- Resume Queen.
- Pause workers.
- Stop workers.
- Restart workers.
- Inspect sessions.
- Inspect communications.
- Inspect terminal output.
- Inspect file changes.
- Approve sensitive commands.
- Manage agent permissions.
- Manage skills approval settings.

Never hide important decisions or silently perform unauthorized work.

---

# 17. MAIN DASHBOARD

Create a clear dashboard containing:

- Project selector.
- Queen status.
- Worker status.
- Active Claude Code sessions.
- Active tasks.
- Pending approvals.
- Pending questions.
- Recent agent communication.
- Terminal activity.
- File modification activity.
- Errors and alerts.
- Progress overview.
- Animated office.
- Skills dashboard.
- Codebase intelligence.

The interface should be modern, responsive, and information-dense without being confusing.

The animated office must be accessible without making it the only way to monitor agents.

---

# 18. TECHNICAL ARCHITECTURE REQUIREMENTS

Design the architecture before implementation.

Potential architectural components:

1. Desktop application shell.
2. UI and visualization layer.
3. Queen orchestration service.
4. Claude Code process manager.
5. Agent lifecycle manager.
6. Communication broker.
7. Task and dependency engine.
8. Scope watchdog.
9. Code intelligence service.
10. Skills management service.
11. Project workspace service.
12. Terminal monitoring service.
13. Persistence layer.
14. Permission and approval service.

Evaluate appropriate technologies for:

- macOS and Windows desktop support.
- Reliable process management.
- Claude Code integration.
- Secure local file access.
- Concurrent agent execution.
- Persistent session management.
- Fast repository indexing.
- Live application updates.
- Efficient resource usage.

Do not select technologies arbitrarily.

First inspect the existing project and its requirements.

If starting from scratch, propose a technology stack and explain its trade-offs.

Possible technologies to evaluate include Electron, Tauri, React, TypeScript, SQLite, and suitable native process-management capabilities.

These are candidates, not mandatory choices.

---

# 19. PERFORMANCE AND EFFICIENCY

Optimize:

- Token consumption.
- Repository exploration.
- Context selection.
- Repeated file reading.
- Agent communication.
- Session management.
- Repository indexing.
- Background processing.
- Memory usage.
- UI responsiveness.

Use shared code intelligence to avoid redundant exploration.

Use selective context retrieval rather than sending the entire repository to every agent.

Do not sacrifice correctness or context quality merely to reduce token consumption.

---

# 20. SECURITY AND RELIABILITY

Implement:

- Secure credential handling.
- Local project permission boundaries.
- Agent permission controls.
- Safe process management.
- Sensitive command approval.
- Session recovery.
- Crash handling.
- Error logging.
- Clear operational status.
- Protection against accidental file modification.
- Transparent reporting of failed operations.

Do not assume an AI agent will always behave correctly.

Use application-level controls rather than relying only on prompts.

---

# 21. STRICT PRODUCT BOUNDARIES

This application is exclusively for Claude Code.

IN SCOPE:

- Claude Code CLI.
- Claude Code sessions.
- Claude Code agents.
- Claude Code Skills.
- Queen orchestration.
- Worker orchestration.
- Codebase intelligence.
- Project code editing.
- Terminal execution.
- Agent communication.
- Live monitoring.
- Animated AI office.

OUT OF SCOPE:

- Other coding-agent providers.
- General-purpose AI chat.
- General Git management suite.
- Generic project management platform.
- Unrelated productivity tools.
- Unnecessary integrations.
- Features not explicitly approved by the user.

Do not expand the product beyond these boundaries without explicit approval.

---

# 22. DEVELOPMENT PROCESS

Development must follow controlled stages.

### Stage 1: Discovery

- Inspect the existing repository.
- Understand the current architecture.
- Identify existing functionality.
- Identify constraints.
- Ask the user questions.
- Document requirements.

Do not modify code.

### Stage 2: Architecture proposal

Present:

- Proposed architecture.
- Module boundaries.
- Data flow.
- Claude Code integration strategy.
- Agent lifecycle.
- Queen orchestration strategy.
- Security model.
- Persistence strategy.
- Technology recommendations.

Wait for approval.

### Stage 3: Implementation planning

Prepare:

- Development milestones.
- Task breakdown.
- Dependencies.
- Testing strategy.
- Acceptance criteria.

Wait for approval.

### Stage 4: Controlled implementation

- Implement only approved work.
- Follow existing conventions.
- Use worker agents when appropriate.
- Monitor their work.
- Verify changes.
- Report blockers.

Do not begin additional stages without the required approval.

### Stage 5: Testing and verification

- Test functionality.
- Test multiple sessions.
- Test concurrent workers.
- Test interruption and recovery.
- Test scope protection.
- Test communication.
- Test skill assignment.
- Test code intelligence.
- Test platform compatibility.

### Stage 6: Final review

Provide:

- Implemented features.
- Verified features.
- Incomplete features.
- Known limitations.
- Test results.
- Outstanding issues.

Never report unimplemented features as completed.

---

# 23. ACCEPTANCE PRINCIPLES

The product is successful only if these conditions are demonstrated:

1. Queen asks the user questions before every new work request.
2. Queen waits for explicit execution approval.
3. Workers cannot start implementation prematurely.
4. Multiple real Claude Code sessions can operate independently.
5. Queen coordinates multiple workers.
6. Agents can communicate through controlled channels.
7. Watchdog detects meaningful deviations from approved work.
8. Queen can intervene in worker activity.
9. The office reflects actual agent activity.
10. Skills are discovered and reused correctly.
11. Shared skills require approval before creation or modification.
12. Code intelligence provides useful structured repository information.
13. Agents can edit and test real project code.
14. The application works on macOS and Windows.
15. The application never silently changes user-approved requirements.

---

# 24. FINAL INSTRUCTION

Your first responsibility is NOT to write code.

Your first responsibility is to understand the project and its current state.

Start by:

1. Inspecting the existing repository, if one exists.
2. Identifying what has already been implemented.
3. Comparing existing functionality with this specification.
4. Identifying missing decisions and technical uncertainties.
5. Asking me the necessary questions.
6. Presenting a clear architecture proposal.

Do not start implementation until I approve the architecture and execution plan.

Remember:

I define the requirements.
I define the approved methods.
Queen coordinates the work.
Workers execute assigned tasks.
The watchdog protects the approved scope.
I retain final authority.

**Never hallucinate. Never invent requirements. Never silently change direction. Never add unrequested functionality.**

Build exactly the application I approve.