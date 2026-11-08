import { EventEmitter } from 'node:events'
import { isAbsolute, relative, resolve } from 'node:path'
import { realpathSync, readdirSync, statSync } from 'node:fs'
import { watch, type FSWatcher } from 'chokidar'
import type { Store } from '../store'
import type { SessionManager } from '../sessions'
import type { Control, Reg } from './control'
import type { Decision } from './permission'
import type { TaskStore } from './tasks'
import { LeaseTable } from './leases'
import { classifyWrite } from './scope'
import { profileViolation, type Hire } from './staff'
import { inactive, repeatedFailure, waitCycle } from './detectors'

export type Confidence = 'low' | 'medium' | 'high'
export type Response = 'note' | 'ask_worker' | 'pause' | 'ask_user'
export interface Alert { id: number; runId: string; sessionId?: string; taskId?: string; ts: number; rule: string; confidence: Confidence; response: Response; evidence: string; status: 'open' | 'dismissed' }

const WRITE_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/
const IGNORE = /(^|[\\/])(node_modules|\.git|out|dist|build|\.DS_Store)([\\/]|$)/

export interface WatchdogOpts { inactivityMs?: number; intervalMs?: number; now?: () => number; leaseTtlMs?: number }

export class Watchdog extends EventEmitter {
  readonly leases: LeaseTable
  private timer?: NodeJS.Timeout
  private watchers: FSWatcher[] = []
  private recentHookWrites = new Map<string, number>() // "session|path" -> ts
  private now: () => number
  private inactivityMs: number
  /** Hire profile of a worker session (set by the app); lets the write policy enforce allowed / blocked paths. */
  profileOf?: (sessionId: string) => Pick<Hire, 'name' | 'allow' | 'deny'> | undefined

  constructor(private store: Store, private mgr: SessionManager, private control: Control, private tasks: TaskStore, o: WatchdogOpts = {}) {
    super()
    this.now = o.now ?? Date.now
    this.inactivityMs = o.inactivityMs ?? 3 * 60_000
    this.leases = new LeaseTable(o.leaseTtlMs ?? 10 * 60_000, this.now)
    control.policy = (reg, tool, input) => this.checkWrite(reg, tool, input)
    if ((o.intervalMs ?? 15_000) > 0) this.timer = setInterval(() => this.tick(), o.intervalMs ?? 15_000)
    this.timer?.unref()
  }
  close(): void { if (this.timer) clearInterval(this.timer); for (const w of this.watchers) void w.close() }

  // ---- alerts ----
  alerts(runId: string): Alert[] {
    return (this.store.raw.prepare('SELECT * FROM alerts WHERE run_id=? ORDER BY id DESC').all(runId) as any[]).map((r) => ({
      id: r.id, runId: r.run_id, sessionId: r.session_id ?? undefined, taskId: r.task_id ?? undefined, ts: r.ts, rule: r.rule,
      confidence: r.confidence, response: r.response, evidence: r.evidence, status: r.status }))
  }
  dismiss(id: number): void { this.store.raw.prepare("UPDATE alerts SET status='dismissed' WHERE id=?").run(id) }

  raise(a: { runId: string; sessionId?: string; taskId?: string; rule: string; confidence: Confidence; response: Response; evidence: string }): Alert | null {
    // de-duplicate: same rule+session+evidence still open
    const dup = this.store.raw.prepare("SELECT id FROM alerts WHERE run_id=? AND rule=? AND IFNULL(session_id,'')=? AND status='open' AND evidence=?").get(a.runId, a.rule, a.sessionId ?? '', a.evidence)
    if (dup) return null
    const ts = this.now()
    const r = this.store.raw.prepare('INSERT INTO alerts (run_id,session_id,task_id,ts,rule,confidence,response,evidence) VALUES (?,?,?,?,?,?,?,?)').run(a.runId, a.sessionId ?? null, a.taskId ?? null, ts, a.rule, a.confidence, a.response, a.evidence)
    const alert: Alert = { id: Number(r.lastInsertRowid), ts, status: 'open', ...a }
    this.respond(alert)
    this.emit('alert', alert)
    return alert
  }

  private respond(a: Alert): void {
    const say = (id: string | undefined, text: string) => { if (id) try { this.mgr.send(id, text) } catch { /* not running */ } }
    if (a.response === 'ask_worker') say(a.sessionId, `[watchdog] ${a.rule}: ${a.evidence}\nPlease explain what you are doing and why, or change approach.`)
    if (a.response === 'pause' && a.sessionId) this.mgr.pause(a.sessionId)
    say(a.runId, `[watchdog] ${a.rule} (${a.confidence}) task ${a.taskId ?? '-'}: ${a.evidence.slice(0, 400)}${a.response === 'pause' ? ' — worker paused' : ''}`)
  }

  // ---- hook-time policy: scope + leases (workers only) ----
  checkWrite(reg: Reg, tool: string, input: any): Decision | undefined {
    if (reg.role !== 'worker' || !WRITE_TOOLS.test(tool)) return undefined
    const runId = reg.meta.queenId!, taskId = reg.meta.taskId!
    const task = this.tasks.get(runId, taskId)
    const fp = String(input?.file_path ?? input?.notebook_path ?? '')
    if (!task || !fp) return undefined
    let root: string; try { root = realpathSync(reg.projectRoot) } catch { root = reg.projectRoot }
    const abs = isAbsolute(fp) ? fp : resolve(root, fp)

    const prof = this.profileOf?.(reg.sessionId)
    const pv = prof && profileViolation(prof, root, abs)
    if (pv) {
      this.raise({ runId, sessionId: reg.sessionId, taskId, rule: 'hire-profile-violation', confidence: 'high', response: 'ask_worker', evidence: `${relative(root, abs)}: ${pv}` })
      return { decision: 'deny', reason: `${pv}. Message Queen if this task needs someone else.`, rule: 'hire-profile' }
    }

    const v = classifyWrite(task.scope, root, abs, this.scopeFiles(root, task.scope))
    if (v.verdict === 'out-of-scope') {
      this.raise({ runId, sessionId: reg.sessionId, taskId, rule: 'out-of-scope-write', confidence: v.confidence, response: 'ask_worker', evidence: v.evidence })
      return { decision: 'deny', reason: `outside task scope: ${v.evidence}. Message Queen if the scope must change.`, rule: 'scope' }
    }
    if (v.verdict !== 'in-scope') this.raise({ runId, sessionId: reg.sessionId, taskId, rule: 'scope-note-' + v.verdict, confidence: v.confidence, response: 'note', evidence: v.evidence })

    const l = this.leases.acquire(abs, reg.sessionId)
    if (!l.ok) {
      const owner = this.tasks.byAssignee(l.heldBy)?.id ?? l.heldBy.slice(0, 8)
      this.raise({ runId, sessionId: reg.sessionId, taskId, rule: 'lease-conflict', confidence: 'high', response: 'note', evidence: `${relative(root, abs)} is leased by task ${owner}` })
      return { decision: 'deny', reason: `file is owned by task ${owner}; ask Queen to sequence the work`, rule: 'lease' }
    }
    this.recentHookWrites.set(reg.sessionId + '|' + abs, this.now())
    return undefined
  }

  /** Existing files matching a scope (bounded walk) — used to find imports of in-scope files. */
  private scopeFiles(root: string, scope: string[]): string[] {
    if (!scope.length) return []
    const out: string[] = []
    const walk = (d: string, depth: number) => {
      if (depth > 6 || out.length > 500) return
      let names: string[] = []; try { names = readdirSync(d) } catch { return }
      for (const n of names) {
        const p = resolve(d, n); if (IGNORE.test(p)) continue
        let s; try { s = statSync(p) } catch { continue }
        if (s.isDirectory()) walk(p, depth + 1)
        else if (classifyWrite(scope, root, p, []).verdict === 'in-scope') out.push(p)
      }
    }
    walk(root, 0)
    return out
  }

  // ---- periodic detectors ----
  tick(): void {
    const now = this.now()
    const waiting = new Set(this.control.pending().map((p) => p.sessionId))
    const live = this.mgr.list().filter((s) => s.role === 'worker' && s.status === 'working' && !this.mgr.isPaused(s.id) && !waiting.has(s.id))
    for (const s of this.mgr.list()) if (s.role === 'worker' && ['stopped', 'crashed', 'error'].includes(s.status)) this.leases.releaseAll(s.id)

    const withTs = live.map((s) => { const e = this.store.events(s.id).slice(-1)[0]; return { id: s.id, lastEventTs: e?.ts ?? s.startedAt } })
    for (const i of inactive(withTs, now, this.inactivityMs)) {
      const t = this.tasks.byAssignee(i.id); if (!t) continue
      this.raise({ runId: t.runId, sessionId: i.id, taskId: t.id, rule: 'inactivity', confidence: 'medium', response: 'ask_worker', evidence: `no events for ${Math.round(i.idleMs / 1000)}s while status=working` })
    }
    for (const s of this.mgr.list().filter((x) => x.role === 'worker' && x.status !== 'stopped')) {
      const t = this.tasks.byAssignee(s.id); if (!t || t.status === 'verified') continue
      const f = repeatedFailure(this.store.events(s.id).slice(-60))
      if (f) this.raise({ runId: t.runId, sessionId: s.id, taskId: t.id, rule: 'repeated-failure', confidence: 'high', response: 'ask_worker', evidence: `last ${f.count} tool results failed identically: ${f.text}` })
    }
    // wait-for cycles from the message log: A asked B and got no reply since, while both still working
    for (const runId of new Set(this.mgr.list().filter((s) => s.role === 'queen').map((s) => s.id))) {
      const msgs = this.tasks.messages(runId).filter((m) => m.from !== 'queen' && m.from !== 'app' && m.to !== 'queen')
      const edges: [string, string][] = []
      for (const m of msgs) {
        const reply = msgs.some((r) => r.id > m.id && r.from === m.to && r.to === m.from)
        const alive = (id: string) => this.tasks.get(runId, id)?.status === 'working'
        if (!reply && alive(m.from) && alive(m.to)) edges.push([m.from, m.to])
      }
      const c = waitCycle(edges)
      if (c) this.raise({ runId, rule: 'deadlock', confidence: 'low', response: 'ask_user', evidence: `possible wait cycle (heuristic from unanswered messages): ${c.join(' -> ')}` })
    }
  }

  // ---- ground truth: filesystem watching ----
  /** Watch a project for real changes (catches Bash-made edits invisible to hooks). */
  watchProject(root: string, runId: string): FSWatcher {
    const w = watch(root, { ignored: (p: string) => IGNORE.test(p), ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 } })
    const onChange = (kind: string) => (p: string) => this.onFsChange(runId, root, resolve(p), kind)
    w.on('add', onChange('add')).on('change', onChange('change')).on('unlink', onChange('unlink'))
    this.watchers.push(w)
    return w
  }

  onFsChange(runId: string, root: string, abs: string, kind: string): void {
    const now = this.now()
    const workers = this.mgr.list().filter((s) => s.role === 'worker' && s.status === 'working' && resolve(s.cwd) === resolve(root))
    const hookWriter = workers.find((w) => now - (this.recentHookWrites.get(w.id + '|' + abs) ?? -1e12) < 5000)
    const culprits = hookWriter ? [hookWriter] : workers
    const source = hookWriter ? 'hook' : workers.length ? 'bash-or-other' : 'external'
    const certain = culprits.length === 1
    this.store.raw.prepare('INSERT INTO file_activity (run_id,ts,path,kind,source,sessions,certain) VALUES (?,?,?,?,?,?,?)')
      .run(runId, now, abs, kind, source, JSON.stringify(culprits.map((c) => c.id)), certain ? 1 : 0)
    if (source !== 'bash-or-other') return
    for (const c of culprits) {
      const t = this.tasks.byAssignee(c.id); if (!t) continue
      const prof = this.profileOf?.(c.id); const pv = prof && profileViolation(prof, root, abs)
      if (pv) { this.raise({ runId, sessionId: c.id, taskId: t.id, rule: 'bash-hire-profile-violation', confidence: certain ? 'medium' : 'low', response: certain ? 'ask_worker' : 'note', evidence: `${relative(root, abs)} ${kind}d on disk without a hook-visible write; ${pv}` }); continue }
      const v = classifyWrite(t.scope, root, abs, this.scopeFiles(root, t.scope))
      if (v.verdict !== 'out-of-scope') continue
      this.raise({ runId, sessionId: c.id, taskId: t.id, rule: 'bash-out-of-scope-change',
        confidence: certain ? 'medium' : 'low', response: certain ? 'ask_worker' : 'note',
        evidence: `${relative(root, abs)} ${kind}d on disk without a hook-visible write; ${certain ? 'only worker running' : `attribution uncertain: ${culprits.length} workers active`}. ${v.evidence}` })
    }
  }
}
