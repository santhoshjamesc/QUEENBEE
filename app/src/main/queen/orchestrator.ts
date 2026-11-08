import { spawn } from 'node:child_process'
import type { Control, Reg, ToolDef, ToolProvider } from './control'
import type { SessionManager } from '../sessions'
import type { TaskStore, Task } from './tasks'
import type { SkillManager } from '../skills/manager'
import type { CodeIndex } from '../intel'
import type { Staff } from './staff'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MAX_MSG = 4000
const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required })

export type CheckRunner = (cmd: string, cwd: string) => Promise<{ ok: boolean; output: string }>

export const runShellCheck: CheckRunner = (cmd, cwd) => new Promise((resolve) => {
  const p = spawn(cmd, { cwd, shell: true })
  let out = ''
  const add = (d: Buffer) => { out = (out + d).slice(-4000) }
  p.stdout.on('data', add); p.stderr.on('data', add)
  const t = setTimeout(() => p.kill('SIGKILL'), 120_000)
  p.on('close', (code) => { clearTimeout(t); resolve({ ok: code === 0, output: `$ ${cmd}\n(exit ${code})\n${out}` }) })
  p.on('error', (e) => { clearTimeout(t); resolve({ ok: false, output: String(e) }) })
})

/** Task assignment, controlled messaging and verification. All state-changing rules live here, not in prompts. */
export class Orchestrator implements ToolProvider {
  constructor(private control: Control, private mgr: SessionManager, private tasks: TaskStore, private runCheck: CheckRunner = runShellCheck, private skills?: SkillManager, private intel?: CodeIndex, private staff?: Staff) {
    control.provider = this
    control.on('plan', (queenId: string, outcome: string) => {
      const plan = control.machineOf(queenId)?.plan
      if (outcome === 'approved' && plan) this.tasks.createFromPlan(queenId, plan)
    })
  }

  tools(role: Reg['role']): ToolDef[] {
    const skillTools: ToolDef[] = !this.skills ? [] : [
      { name: 'list_skills', description: 'Search existing skills (personal and project). Reuse an existing skill before proposing a new one. Empty query lists all.', inputSchema: obj({ query: { type: 'string' } }, []) },
      { name: 'propose_skill', description: 'Create or modify a skill. Blocks until the USER approves or denies; nothing is written before approval. Provide the complete SKILL.md (with frontmatter description) and optional extra text files.',
        inputSchema: obj({ name: { type: 'string' }, scope: { type: 'string', enum: ['project', 'personal'] }, skill_md: { type: 'string' }, files: { type: 'object', additionalProperties: { type: 'string' } } }, ['name', 'skill_md']) }
    ]
    const codeTools: ToolDef[] = !this.intel ? [] : [
      { name: 'code_search', description: 'Read-only code intelligence (tree-sitter index, TypeScript/JavaScript/Python). mode "symbols": find declarations by name; "references": identifier uses by name (name-based candidates, not type-resolved); "imports": what a file imports and who imports it.',
        inputSchema: obj({ mode: { type: 'string', enum: ['symbols', 'references', 'imports'] }, query: { type: 'string', description: 'symbol name, or file path for imports' } }, ['mode', 'query']) },
      { name: 'code_impact', description: 'Files that transitively import the given file (what a change to it can affect), with distance.', inputSchema: obj({ path: { type: 'string' } }, ['path']) },
      { name: 'code_health', description: 'Heuristic findings: import cycles, possibly-unused exports, duplicate functions. Each has a confidence; none are edits.', inputSchema: obj({}, []) }
    ]
    if (role === 'queen') return [
      { name: 'get_tasks', description: 'List tasks with status, dependencies and which are ready.', inputSchema: obj({}, []) },
      { name: 'assign_task', description: 'Start a worker for a ready task (all dependencies verified). Only works after plan approval. Optionally give the names of existing skills this worker should have; it then sees only those. Returns a message; the worker is briefed with relevant code from the index.', inputSchema: obj({ task_id: { type: 'string' }, skills: { type: 'array', items: { type: 'string' } }, worker: { type: 'string', description: 'Name of a hired staff member (see get_tasks.staff). Default: the first free one whose configured focus and allowed paths fit the task scope. Staff are shared by all windows; a busy member is busy everywhere.' } }, ['task_id']) },
      { name: 'pause_worker', description: 'Pause the worker of a task: it holds at its next tool call and queued messages wait. Use when it deviates or you need to re-plan. Reversible with resume_worker.', inputSchema: obj({ task_id: { type: 'string' }, reason: { type: 'string' } }, ['task_id']) },
      { name: 'resume_worker', description: 'Resume a paused worker.', inputSchema: obj({ task_id: { type: 'string' } }, ['task_id']) },
      { name: 'stop_worker', description: 'Stop the worker of a task and put the task back to pending so it can be reassigned with assign_task.', inputSchema: obj({ task_id: { type: 'string' }, reason: { type: 'string' } }, ['task_id']) },
      { name: 'message_worker', description: 'Send a message to the worker of a task.', inputSchema: obj({ task_id: { type: 'string' }, text: { type: 'string' } }, ['task_id', 'text']) },
      ...skillTools, ...codeTools
    ]
    if (role === 'worker') return [
      { name: 'message', description: 'Send a message to Queen ("queen") or another running task by id (e.g. "T2").', inputSchema: obj({ to: { type: 'string' }, text: { type: 'string' } }, ['to', 'text']) },
      { name: 'report_done', description: 'Claim your task is complete. The app runs the task checks and tells you the result.', inputSchema: obj({ summary: { type: 'string' } }, ['summary']) },
      ...skillTools, ...codeTools
    ]
    return []
  }

  async call(reg: Reg, name: string, a: any): Promise<string> {
    const runId = reg.role === 'queen' ? reg.sessionId : reg.meta.queenId!
    if (this.intel && (name === 'code_search' || name === 'code_impact' || name === 'code_health')) return this.code(reg, name, a)
    if (name === 'list_skills' && this.skills) {
      const found = this.skills.search(reg.projectRoot, String(a.query ?? ''))
      return JSON.stringify(found.map((s) => ({ name: s.name, scope: s.scope, description: s.description, hidden_by_personal_skill: !!s.shadowed })))
    }
    if (name === 'propose_skill' && this.skills) {
      const files: Record<string, string> = { ...(a.files && typeof a.files === 'object' ? a.files : {}), 'SKILL.md': String(a.skill_md ?? '') }
      return this.skills.propose(reg.sessionId, reg.projectRoot, { name: String(a.name ?? ''), scope: a.scope === 'personal' ? 'personal' : 'project', files })
    }
    if (reg.role === 'queen') {
      if (name === 'get_tasks') {
        const busy = this.staff?.busyIds(runId) ?? new Set<string>()
        return JSON.stringify({ tasks: this.tasks.list(runId).map(({ runId: _r, ...t }) => t), ready: this.tasks.ready(runId).map((t) => t.id), staff: (this.staff?.list(runId) ?? []).map((h) => ({ name: h.name, title: h.title, focus: h.focus || undefined, only_works_in: h.allow.length ? h.allow : undefined, never_touches: h.deny.length ? h.deny : undefined, rules: h.instructions || undefined, free: !busy.has(h.id) })) })
      }
      if (name === 'assign_task') return await this.assign(reg, String(a.task_id), Array.isArray(a.skills) ? a.skills.map(String) : undefined, a.worker ? String(a.worker) : undefined)
      if (name === 'pause_worker' || name === 'resume_worker' || name === 'stop_worker') return this.intervene(runId, name, String(a.task_id), String(a.reason ?? ''))
      if (name === 'message_worker') return this.deliver(runId, 'queen', String(a.task_id), String(a.text ?? ''))
    } else {
      if (name === 'message') return this.deliver(runId, reg.meta.taskId!, String(a.to), String(a.text ?? ''))
      if (name === 'report_done') return this.done(reg, runId, String(a.summary ?? ''))
    }
    throw new Error('unsupported tool')
  }

  /** Queen's intervention powers. Only tasks of her own run; everything is logged in the message history. */
  private intervene(runId: string, kind: string, taskId: string, reason: string): string {
    const t = this.tasks.get(runId, taskId)
    if (!t) throw new Error('unknown task ' + taskId)
    if (!t.assignee) throw new Error(`task ${taskId} has no worker`)
    const w = t.assignee
    const log = (what: string) => this.tasks.logMessage(runId, 'queen', taskId, `[intervention] ${what}${reason ? ': ' + reason.slice(0, 300) : ''}`, true)
    if (kind === 'pause_worker') { this.mgr.pause(w); log('paused'); return `Worker of ${taskId} paused (holds at its next tool call).` }
    if (kind === 'resume_worker') { this.mgr.resume(w); log('resumed'); return `Worker of ${taskId} resumed.` }
    if (t.status === 'verified') throw new Error(`task ${taskId} is already verified; nothing to stop`)
    if (this.mgr.isPaused(w)) this.mgr.resume(w) // release a held tool call so the process can exit
    try { this.mgr.stop(w) } catch { /* already gone */ }
    this.tasks.set(runId, taskId, { status: 'pending', assignee: undefined })
    log('stopped; task returned to pending')
    return `Worker of ${taskId} stopped. Task ${taskId} is pending again; call assign_task to reassign it.`
  }

  private lastIndexed = new Map<string, number>()
  /** Re-index (incremental, hash-based) at most every 5 s per project, then answer from the index. */
  private async code(reg: Reg, name: string, a: any): Promise<string> {
    const intel = this.intel!
    if (Date.now() - (this.lastIndexed.get(reg.projectRoot) ?? 0) > 5000) { await intel.index(reg.projectRoot); this.lastIndexed.set(reg.projectRoot, Date.now()) }
    const cap = (x: unknown) => JSON.stringify(x).slice(0, 12_000)
    if (name === 'code_impact') return cap(intel.impact(reg.projectRoot, String(a.path ?? '')))
    if (name === 'code_health') return cap(intel.findings(reg.projectRoot))
    const q = String(a.query ?? '')
    if (a.mode === 'symbols') return cap(intel.symbols(reg.projectRoot, q))
    if (a.mode === 'references') return cap({ note: 'name-based candidates, not type-resolved', refs: intel.references(reg.projectRoot, q) })
    if (a.mode === 'imports') return cap({ imports: intel.importsOf(reg.projectRoot, q), importedBy: intel.importersOf(reg.projectRoot, q) })
    throw new Error('mode must be symbols, references or imports')
  }

  private async codeBrief(root: string, t: Task): Promise<string> {
    if (!this.intel) return ''
    try {
      await this.intel.index(root); this.lastIndexed.set(root, Date.now())
      const c = this.intel.context(root, t.scope, t.title)
      if (!c.files.length) return ''
      const syms = c.symbols.filter((s) => s.exported).slice(0, 25).map((s) => `${s.name} (${s.kind}) ${s.path}:${s.line}`)
      return `\nRelevant code from the project index (read-only, may be incomplete${c.note ? '; ' + c.note : ''}):\n- files: ${c.files.join(', ')}\n- they import: ${c.imports.join(', ') || '(none inside the project)'}\n- imported by (check you do not break these): ${c.importedBy.join(', ') || '(none)'}\n- exported symbols: ${syms.join('; ') || '(none)'}\nYou may query more with mcp__queen__code_search / code_impact / code_health.`
    } catch { return '' } // index trouble must never block work
  }

  private async assign(reg: Reg, taskId: string, skillNames?: string[], workerName?: string): Promise<string> {
    const runId = reg.sessionId
    const t = this.tasks.get(runId, taskId)
    if (!t) throw new Error('unknown task ' + taskId)
    if (t.status !== 'pending' && t.status !== 'failed') throw new Error(`task ${taskId} is ${t.status}`)
    const all = this.tasks.list(runId)
    const blocked = t.deps.filter((d) => all.find((x) => x.id === d)?.status !== 'verified')
    if (blocked.length) throw new Error(`task ${taskId} is blocked by unverified dependencies: ${blocked.join(', ')}`)
    // Skills are validated BEFORE a worker exists, so a bad name cannot leave a half-started worker.
    let skillPluginDir: string | undefined
    let prompt = WORKER_PROMPT
    let skillNote = ''
    if (skillNames?.length) {
      if (!this.skills) throw new Error('skills are not available')
      const chosen = this.skills.assign(runId, taskId, reg.projectRoot, skillNames)
      skillPluginDir = this.skills.buildPluginDir(`${runId.slice(0, 8)}-${taskId}-${Date.now()}`, chosen)
      // Isolation drops Claude's project settings sources, which also drops CLAUDE.md: pass it explicitly.
      let claudeMd = ''
      try { claudeMd = readFileSync(join(reg.projectRoot, 'CLAUDE.md'), 'utf8').slice(0, 20_000) } catch { /* none */ }
      prompt += `\nYour assigned skills are available as ${chosen.map((s) => 'queen:' + s.name).join(', ')}; use them when relevant. Do not edit skill files directly; use mcp__queen__propose_skill (the user must approve).` + (claudeMd ? `\n\nProject instructions (CLAUDE.md):\n${claudeMd}` : '')
      skillNote = ` with skills: ${chosen.map((s) => s.name).join(', ')}`
    }
    const brief = this.brief(t) + (await this.codeBrief(reg.projectRoot, t))
    // Staff: if the boss hired people, the task goes to one of them (never to an anonymous worker).
    const hire = this.staff?.pickFree(runId, workerName, t.scope)
    if (this.staff && !hire && this.staff.list(runId).length) throw new Error('all hired staff are busy; ask the boss to hire another worker or wait for someone to finish')
    if (hire) {
      prompt += `\nYour name is ${hire.name}. Your job title is ${hire.title}.${hire.title === 'Head of workers' ? ' You may coordinate other workers by messaging them through Queen-approved channels.' : ''} Reply to the boss in short, plain chat messages.`
      if (hire.focus) prompt += `\nYour focus: ${hire.focus}.`
      if (hire.instructions) prompt += `\nThe boss configured you with these rules; follow them strictly, and if a task needs something they forbid, do not do it, message Queen instead:\n${hire.instructions}`
      if (hire.allow.length) prompt += `\nYou may only change files matching: ${hire.allow.join(', ')}.`
      if (hire.deny.length) prompt += `\nYou must never change files matching: ${hire.deny.join(', ')}.`
    }
    const w = this.mgr.start({ name: hire ? `${hire.name} · ${t.id}` : `${t.id} ${t.title}`.slice(0, 60), cwd: reg.projectRoot, role: 'worker', queenId: runId, taskId, systemPrompt: prompt, skillPluginDir })
    if (hire) this.staff!.bind(hire, w.id)
    this.tasks.set(runId, taskId, { status: 'working', assignee: w.id })
    this.mgr.send(w.id, brief)
    return `Task ${taskId} assigned to ${hire ? hire.name : 'worker session ' + w.id.slice(0, 8)}${skillNote}`
  }

  private brief(t: Task): string {
    return `Task ${t.id}: ${t.title}\nAllowed scope (stay within it): ${t.scope.join(', ') || 'whole project'}\nCompletion checks the app will run: ${t.checks.join(' ; ') || '(none defined)'}\nWhen finished, call mcp__queen__report_done. Do not claim completion otherwise. Use mcp__queen__message to ask Queen or another task for something.`
  }

  /** Route a message. Workers may only reach Queen or tasks in the same run; everything is logged. */
  private deliver(runId: string, from: string, to: string, body: string): string {
    if (!body || body.length > MAX_MSG) throw new Error(`message must be 1–${MAX_MSG} characters`)
    let target: string | undefined
    if (to === 'queen') target = runId
    else target = this.tasks.get(runId, to)?.assignee
    if (to !== 'queen' && !this.tasks.get(runId, to)) throw new Error('unknown task ' + to)
    let delivered = false
    if (target) { try { this.mgr.send(target, `[message from ${from}] ${body}`); delivered = true } catch { /* target not running */ } }
    this.tasks.logMessage(runId, from, to, body, delivered)
    if (!delivered) throw new Error(`${to} is not running; message logged but not delivered`)
    return 'delivered'
  }

  private async done(reg: Reg, runId: string, summary: string): Promise<string> {
    const t = this.tasks.byAssignee(reg.sessionId)
    if (!t) throw new Error('no task bound to this worker')
    this.tasks.set(runId, t.id, { status: 'awaiting_verification', summary })
    const results: string[] = []
    let ok = true
    for (const c of t.checks) { const r = await this.runCheck(c, reg.projectRoot); results.push(r.output); if (!r.ok) { ok = false; break } }
    const text = results.join('\n---\n')
    if (!t.checks.length) {
      this.tasks.set(runId, t.id, { verification: 'No checks defined: cannot be marked verified automatically; needs review.' })
      this.note(runId, t.id, 'claims done; NO checks defined, awaiting review')
      return 'Recorded. No checks were defined for this task, so it stays awaiting_verification until Queen/user reviews it.'
    }
    this.tasks.set(runId, t.id, { status: ok ? 'verified' : 'failed', verification: text })
    this.note(runId, t.id, ok ? 'VERIFIED (all checks passed)' : 'FAILED verification:\n' + text.slice(-1500))
    return ok ? 'All checks passed. Task verified.' : 'Verification FAILED. Fix the problem and call report_done again.\n' + text
  }

  /** Tell Queen the outcome (best-effort; also in the message log). */
  private note(runId: string, taskId: string, body: string): void {
    let delivered = false
    try { this.mgr.send(runId, `[app] Task ${taskId}: ${body}`); delivered = true } catch { /* queen not running */ }
    this.tasks.logMessage(runId, 'app', 'queen', `Task ${taskId}: ${body}`, delivered)
  }
}

export const WORKER_PROMPT = `You are a worker agent coordinated by Queen. Do only your assigned task, stay inside its scope, and never claim completion without calling mcp__queen__report_done. If you need something outside your scope, message Queen instead of doing it.`
