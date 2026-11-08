import type { DatabaseSync } from 'node:sqlite'
import type { Plan } from './machine'

export type TaskStatus = 'pending' | 'assigned' | 'working' | 'awaiting_verification' | 'verified' | 'failed'
export interface Task { runId: string; id: string; title: string; scope: string[]; checks: string[]; deps: string[]; status: TaskStatus; assignee?: string; summary?: string; verification?: string }
export interface Msg { id: number; runId: string; ts: number; from: string; to: string; body: string; delivered: boolean }

export class TaskStore {
  constructor(private db: DatabaseSync) {}

  /** Creates tasks from an APPROVED, normalised plan (idempotent per run). */
  createFromPlan(runId: string, plan: Plan): void {
    if (this.list(runId).length) return
    const now = Date.now()
    for (const t of plan.tasks) {
      this.db.prepare('INSERT INTO tasks (run_id,id,title,scope,checks,status,updated_at) VALUES (?,?,?,?,?,?,?)').run(runId, t.id!, t.title, JSON.stringify(t.scope ?? []), JSON.stringify(t.checks ?? []), 'pending', now)
      for (const d of t.deps ?? []) this.db.prepare('INSERT INTO task_deps VALUES (?,?,?)').run(runId, t.id!, d)
    }
  }

  list(runId: string): Task[] {
    const deps = this.db.prepare('SELECT task_id,dep_id FROM task_deps WHERE run_id=?').all(runId) as any[]
    return (this.db.prepare('SELECT * FROM tasks WHERE run_id=? ORDER BY rowid').all(runId) as any[]).map((r) => ({
      runId, id: r.id, title: r.title, scope: JSON.parse(r.scope), checks: JSON.parse(r.checks), status: r.status,
      assignee: r.assignee ?? undefined, summary: r.summary ?? undefined, verification: r.verification ?? undefined,
      deps: deps.filter((d) => d.task_id === r.id).map((d) => d.dep_id)
    }))
  }
  get(runId: string, id: string): Task | undefined { return this.list(runId).find((t) => t.id === id) }

  /** Tasks whose dependencies are all verified (DAG order) and which are not started. */
  ready(runId: string): Task[] {
    const all = this.list(runId)
    return all.filter((t) => t.status === 'pending' && t.deps.every((d) => all.find((x) => x.id === d)?.status === 'verified'))
  }

  set(runId: string, id: string, f: Partial<Pick<Task, 'status' | 'assignee' | 'summary' | 'verification'>>): void {
    const cur = this.get(runId, id); if (!cur) throw new Error('unknown task ' + id)
    const n = { ...cur, ...f }
    this.db.prepare('UPDATE tasks SET status=?, assignee=?, summary=?, verification=?, updated_at=? WHERE run_id=? AND id=?')
      .run(n.status, n.assignee ?? null, n.summary ?? null, n.verification ?? null, Date.now(), runId, id)
  }
  /** Company-wide figures (every run/window), used by the shared roster and wallet. */
  verifiedCount(): number { return (this.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status='verified'").get() as any).n }
  deliveredCount(): number { return (this.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE delivered=1 AND from_id!='app' AND to_id!='app'").get() as any).n }
  activeAssignees(): Set<string> {
    return new Set((this.db.prepare("SELECT assignee FROM tasks WHERE assignee IS NOT NULL AND status IN ('assigned','working','awaiting_verification')").all() as any[]).map((r) => r.assignee))
  }
  byAssignee(sessionId: string): Task | undefined {
    const r = this.db.prepare('SELECT run_id,id FROM tasks WHERE assignee=?').get(sessionId) as any
    return r && this.get(r.run_id, r.id)
  }

  logMessage(runId: string, from: string, to: string, body: string, delivered: boolean): void {
    this.db.prepare('INSERT INTO messages (run_id,ts,from_id,to_id,body,delivered) VALUES (?,?,?,?,?,?)').run(runId, Date.now(), from, to, body, delivered ? 1 : 0)
  }
  messages(runId: string): Msg[] {
    return (this.db.prepare('SELECT * FROM messages WHERE run_id=? ORDER BY id').all(runId) as any[]).map((r) => ({ id: r.id, runId, ts: r.ts, from: r.from_id, to: r.to_id, body: r.body, delivered: !!r.delivered }))
  }
}
