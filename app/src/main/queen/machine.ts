import { createHash } from 'node:crypto'

/** Queen's run state machine (T3 §6): Intake → Questions → AwaitingApproval → Approved. Pure, no I/O. */
export type QueenState = 'intake' | 'questions' | 'awaiting_approval' | 'approved' | 'rejected'

export interface PlanTask { id?: string; title: string; worker?: string; scope?: string[]; deps?: string[]; checks?: string[] }
export interface Plan { summary: string; tasks: PlanTask[] }

/** Gives every task an id (T1..), validates deps and rejects cycles. Returns a normalised copy. */
export function normalisePlan(plan: Plan): Plan {
  const tasks = plan.tasks.map((t, i) => ({ ...t, id: t.id || `T${i + 1}`, deps: t.deps ?? [], checks: t.checks ?? [] }))
  const ids = new Set<string>()
  for (const t of tasks) { if (ids.has(t.id)) throw new Error('duplicate task id ' + t.id); ids.add(t.id) }
  const dep = new Map(tasks.map((t) => [t.id, t.deps]))
  for (const t of tasks) for (const d of t.deps) if (!ids.has(d)) throw new Error(`task ${t.id} depends on unknown task ${d}`)
  const state = new Map<string, number>()
  const visit = (id: string, path: string[]) => {
    if (state.get(id) === 2) return
    if (state.get(id) === 1) throw new Error('dependency cycle: ' + [...path, id].join(' -> '))
    state.set(id, 1); for (const d of dep.get(id)!) visit(d, [...path, id]); state.set(id, 2)
  }
  for (const t of tasks) visit(t.id, [])
  return { ...plan, tasks }
}

export const planHash = (p: Plan): string => createHash('sha256').update(JSON.stringify(p)).digest('hex')

export class QueenMachine {
  state: QueenState = 'intake'
  asked = 0
  plan?: Plan
  approvedHash?: string

  /** Queen asked the user at least one question (principle 1: ask before work). */
  askUser(): void {
    if (this.state === 'awaiting_approval') throw new Error('plan is awaiting approval')
    this.asked++
    this.state = 'questions'
  }

  submitPlan(plan: Plan): void {
    if (this.asked === 0) throw new Error('Queen must ask the user clarifying questions before submitting a plan')
    if (!plan.tasks?.length) throw new Error('plan has no tasks')
    this.plan = normalisePlan(plan)
    this.state = 'awaiting_approval'
  }

  /** Only a user action (never a Queen tool) calls this. */
  approve(hash: string): void {
    if (this.state !== 'awaiting_approval' || !this.plan) throw new Error('no plan awaiting approval')
    if (hash !== planHash(this.plan)) throw new Error('plan changed since it was shown; re-approval required')
    this.approvedHash = hash
    this.state = 'approved'
  }

  reject(): void {
    if (this.state !== 'awaiting_approval') throw new Error('no plan awaiting approval')
    this.state = 'rejected'
  }

  /** Principle 15: any change to an approved plan drops back to approval. */
  amendPlan(raw: Plan): void {
    const plan = normalisePlan(raw)
    if (planHash(plan) === this.approvedHash) return
    this.plan = plan
    this.approvedHash = undefined
    this.state = 'awaiting_approval'
  }

  /** Code-level gate for spawning workers (principle 3). */
  canSpawnWorker(): boolean { return this.state === 'approved' && !!this.approvedHash && !!this.plan && planHash(this.plan) === this.approvedHash }
}
