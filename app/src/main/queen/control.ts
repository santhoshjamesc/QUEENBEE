import { createServer, type Server } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { PendingItem } from '../../shared/types'
import { decide, type Decision } from './permission'
import { QueenMachine, planHash, type Plan } from './machine'

export interface RegMeta { queenId?: string; taskId?: string }
export interface Reg { sessionId: string; role: 'queen' | 'worker' | 'plain'; projectRoot: string; machine?: QueenMachine; meta: RegMeta }
export interface ToolDef { name: string; description: string; inputSchema: unknown }
/** Extra MCP tools (tasks, messaging) supplied by the orchestrator. */
export interface ToolProvider { tools(role: Reg['role']): ToolDef[]; call(reg: Reg, name: string, args: any): Promise<string> }
interface Waiter extends PendingItem { resolve: (v: any) => void }

export const QUEEN_TOOLS = [
  { name: 'ask_user', description: 'Ask the user ONE clarifying question and wait for the answer. Call it again for each follow-up, one question per call, using earlier answers to decide the next. You MUST call this at least once before submit_plan.',
    inputSchema: { type: 'object', properties: { questions: { type: 'array', items: { type: 'string' } } }, required: ['questions'] } },
  { name: 'submit_plan', description: 'Submit the plan for user approval. Blocks until the user approves or rejects. Workers can only start after approval.',
    inputSchema: { type: 'object', properties: { summary: { type: 'string' }, tasks: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', description: 'short unique id such as T1' }, title: { type: 'string' }, worker: { type: 'string' }, deps: { type: 'array', items: { type: 'string' }, description: 'ids of tasks that must be verified first' }, scope: { type: 'array', items: { type: 'string' }, description: 'files/globs the worker may change' }, checks: { type: 'array', items: { type: 'string' }, description: 'shell commands (run in the project root) that exit 0 when the task is truly done. Without checks a task can never be verified automatically.' } }, required: ['title', 'checks'] } } }, required: ['summary', 'tasks'] } }
]

export const QUEEN_PROMPT = `You are Queen, the coordinator. Never edit files yourself. Workflow: (1) understand the request, (2) call mcp__queen__ask_user to ask clarifying questions ONE AT A TIME: pass a single question per call, wait for the answer, then decide the next question from it; stop when you know enough, (3) call mcp__queen__submit_plan with a plan (tasks with id, title, deps, scope, and checks = shell commands that prove the task is done); it blocks until the user decides. Do not start any work or assume requirements before approval. If the plan is rejected, read the feedback and revise. Never change an approved plan without resubmitting it. After approval: use mcp__queen__get_tasks, then mcp__queen__assign_task for tasks that are ready (independent tasks may be assigned in parallel). Workers report back to you by message; a task is only done when the app marks it verified. The boss may hire staff (get_tasks lists them under "staff"); assign_task gives a task to a free staff member (pass "worker" to choose, e.g. a Head of workers for coordination). Staff are configured by the boss (focus, rules, only_works_in, never_touches): match each task to the specialist whose configuration fits, and write task scopes that stay inside their allowed paths; never give a specialist work their rules forbid. If every staff member is busy, tell the boss. The boss can chat with you and any worker at any time, and may interject in your conversations; answer plainly and briefly. Use mcp__queen__message_worker to coordinate; if a worker deviates or you must re-plan, use pause_worker / resume_worker, or stop_worker then assign_task again. Skills: before assigning, call mcp__queen__list_skills and reuse existing skills (no approval needed) by passing their names in assign_task's skills; a worker then sees only those. Only if no existing skill fits, call mcp__queen__propose_skill (the user must approve; never edit skill files directly).`

/** Loopback HTTP server: /hook/<token> (PreToolUse) and /mcp/<token> (Queen tools). Token = per-session secret. */
export class Control extends EventEmitter {
  private server?: Server
  port = 0
  private byToken = new Map<string, Reg>()
  private waiters = new Map<string, Waiter>()

  async listen(): Promise<void> {
    this.server = createServer((req, res) => {
      let body = ''
      req.on('data', (d) => (body += d))
      req.on('end', async () => {
        try {
          const m = /^\/(hook|mcp)\/([a-f0-9]+)$/.exec(req.url ?? '')
          const reg = m && this.byToken.get(m[2])
          if (!m || !reg) { res.writeHead(404).end(); return }
          const json = body ? JSON.parse(body) : {}
          const out = m[1] === 'hook' ? await this.onHook(reg, json) : await this.onMcp(reg, json)
          if (out === null) { res.writeHead(202).end(); return }
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out))
        } catch (e: any) { res.writeHead(500).end(String(e.message ?? e)) }
      })
    })
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r))
    this.port = (this.server!.address() as any).port
  }
  close(): void { for (const w of this.waiters.values()) w.resolve({ cancelled: true }); this.server?.close() }

  /** Registers a session; returns the secret token for its hook/MCP URLs. */
  provider?: ToolProvider
  /** Extra deterministic policy (scope, leases) consulted before the default engine. */
  policy?: (reg: Reg, tool: string, input: any) => Decision | undefined
  private holds = new Map<string, Promise<void>>()
  private releases = new Map<string, () => void>()
  /** While paused, the session's next tool call blocks in the hook until resume(). */
  pause(id: string): void { if (this.holds.has(id)) return; this.holds.set(id, new Promise((r) => this.releases.set(id, r))) }
  resume(id: string): void { this.releases.get(id)?.(); this.holds.delete(id); this.releases.delete(id) }
  isPaused(id: string): boolean { return this.holds.has(id) }
  register(sessionId: string, role: Reg['role'], projectRoot: string, meta: RegMeta = {}): { token: string; machine?: QueenMachine } {
    const token = randomBytes(16).toString('hex')
    const machine = role === 'queen' ? new QueenMachine() : undefined
    this.byToken.set(token, { sessionId, role, projectRoot, machine, meta })
    return { token, machine }
  }
  machineOf(sessionId: string): QueenMachine | undefined { for (const r of this.byToken.values()) if (r.sessionId === sessionId) return r.machine }
  canSpawnWorker(queenId: string): boolean { return !!this.machineOf(queenId)?.canSpawnWorker() }

  pending(): PendingItem[] { return [...this.waiters.values()].map(({ resolve, ...p }) => p) }
  private wait(sessionId: string, kind: PendingItem['kind'], data: any): Promise<any> {
    return new Promise((resolve) => {
      const w: Waiter = { id: randomUUID(), sessionId, kind, createdAt: Date.now(), data, resolve }
      this.waiters.set(w.id, w)
      this.emit('pending', this.pending())
    })
  }
  private settle(id: string, v: any): Waiter {
    const w = this.waiters.get(id)
    if (!w) throw new Error('no such pending item (already decided?)')
    this.waiters.delete(id); w.resolve(v); this.emit('pending', this.pending())
    return w
  }

  // ---- user actions (called from UI via IPC; Queen has no tool that reaches these) ----
  answer(id: string, answers: string[]): void { this.settle(id, { answers }) }
  decideCommand(id: string, allow: boolean): void { this.settle(id, { allow }) }
  /** Skill create/modify approval (principle 11). Resolves only on the user's decision; a closed app cancels it (= false). */
  requestSkillChange(sessionId: string, data: unknown): Promise<boolean> {
    return this.wait(sessionId, 'skill', data).then((r) => !!r.allow)
  }
  decideSkill(id: string, allow: boolean): void {
    const w = this.waiters.get(id)
    if (!w || w.kind !== 'skill') throw new Error('no such skill approval pending')
    this.settle(id, { allow })
  }
  approvePlan(id: string, hash: string): void {
    const w = this.waiters.get(id)
    if (!w || w.kind !== 'plan') throw new Error('no such plan pending')
    const m = this.machineOf(w.sessionId)!
    m.approve(hash) // throws if plan changed
    this.settle(id, { approved: true })
    this.emit('plan', w.sessionId, 'approved')
  }
  rejectPlan(id: string, feedback: string): void {
    const w = this.waiters.get(id)
    if (!w || w.kind !== 'plan') throw new Error('no such plan pending')
    this.machineOf(w.sessionId)!.reject()
    this.settle(id, { approved: false, feedback })
    this.emit('plan', w.sessionId, 'rejected')
  }

  // ---- hook ----
  private async onHook(reg: Reg, h: any): Promise<unknown> {
    const tool = String(h.tool_name ?? '')
    const out = (permissionDecision: string, reason: string) =>
      ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason: reason } })
    // Queen never writes; her only tools are the MCP ones plus read-only exploration.
    if (reg.role === 'queen' && /^(Write|Edit|MultiEdit|NotebookEdit|Bash)$/.test(tool)) return out('deny', 'Queen coordinates; she does not edit or run commands')
    await this.holds.get(reg.sessionId)
    const d = this.policy?.(reg, tool, h.tool_input) ?? decide(tool, h.tool_input, reg.projectRoot)
    this.emit('decision', { sessionId: reg.sessionId, tool, ...d })
    if (d.decision !== 'ask') return out(d.decision, d.reason)
    const r = await this.wait(reg.sessionId, 'command', { tool, summary: d.reason, rule: d.rule })
    return r.allow ? out('allow', 'approved by user') : out('deny', 'denied by user')
  }

  // ---- MCP (minimal streamable-HTTP JSON-RPC: initialize, tools/list, tools/call) ----
  private async onMcp(reg: Reg, rpc: any): Promise<unknown> {
    const reply = (result: unknown) => ({ jsonrpc: '2.0', id: rpc.id, result })
    if (rpc.id === undefined) return null // notification
    if (rpc.method === 'initialize')
      return reply({ protocolVersion: rpc.params?.protocolVersion ?? '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'queen', version: '0.1.0' } })
    if (rpc.method === 'ping') return reply({})
    if (rpc.method === 'tools/list') return reply({ tools: [...(reg.role === 'queen' ? QUEEN_TOOLS : []), ...(this.provider?.tools(reg.role) ?? [])] })
    if (rpc.method === 'tools/call') {
      const text = (t: string, isError = false) => reply({ content: [{ type: 'text', text: t }], isError })
      const m = reg.machine
      const a = rpc.params?.arguments ?? {}
      const name = rpc.params?.name
      try {
        if (!QUEEN_TOOLS.some((t) => t.name === name)) {
          if (!this.provider?.tools(reg.role).some((t) => t.name === name)) return text('unknown tool for this role', true)
          return text(await this.provider.call(reg, name, a))
        }
        if (!m) return text('not a Queen session', true)
        if (rpc.params.name === 'ask_user') {
          m.askUser()
          const r = await this.wait(reg.sessionId, 'question', { questions: a.questions ?? [] })
          if (r.cancelled) return text('cancelled', true)
          return text('User answers:\n' + (r.answers as string[]).map((x, i) => `${i + 1}. ${x}`).join('\n'))
        }
        if (rpc.params.name === 'submit_plan') {
          const plan: Plan = { summary: String(a.summary ?? ''), tasks: a.tasks ?? [] }
          m.submitPlan(plan)
          const shown = m.plan! // normalised copy: this is what the user sees, hashes and approves
          const r = await this.wait(reg.sessionId, 'plan', { plan: shown, hash: planHash(shown) })
          if (r.cancelled) return text('cancelled', true)
          return text(r.approved ? 'Plan APPROVED by the user. You may now proceed.' : 'Plan REJECTED. Feedback: ' + (r.feedback || '(none)'))
        }
        return text('unknown tool', true)
      } catch (e: any) { return text(String(e.message ?? e), true) }
    }
    return { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'method not found' } }
  }
}
