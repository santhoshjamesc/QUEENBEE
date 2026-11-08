import type { DatabaseSync } from 'node:sqlite'
import type { TaskStore } from './tasks'
import { inScope } from './scope'

/**
 * Staff (hires) and the coin economy.
 * The roster and the wallet are company-wide: every window (every Queen run) sees the same workers, and a worker
 * does one task at a time across ALL windows. A hire is a real, persisted agent record with its own look, desk and
 * profile (focus, instructions, allowed / blocked paths). Its Claude session is started by Queen's assign_task
 * (the plan-approval gate still applies) and bound to the hire. Coins are derived from real data only
 * (verified tasks, delivered messages) minus what hires cost.
 */
export interface Hire {
  id: string
  /** run the hire was created in; only the row key, NOT a restriction */
  runId: string
  name: string; title: string; look: number; cost: number; ts: number; sessionId?: string
  /** short label of what they do, e.g. "mobile app only" */
  focus: string
  /** free-text rules injected into their prompt, e.g. "only improve UI; never change logic or workflow" */
  instructions: string
  /** globs they may write (empty = anywhere the task scope allows) */
  allow: string[]
  /** globs they must never write (wins over allow) */
  deny: string[]
}
export interface HireProfile { focus?: string; instructions?: string; allow?: string[] | string; deny?: string[] | string }
export interface Economy { coins: number; earned: number; spent: number; nextCost: number; hires: number }

export const START_COINS = 150
export const REWARD_VERIFIED = 30
export const REWARD_MESSAGE = 5
export const TITLES = ['Developer', 'Designer', 'Tester', 'Writer', 'Researcher', 'Head of workers'] as const
const NAMES = ['Ada', 'Linus', 'Grace', 'Alan', 'Margaret', 'Dennis', 'Barbara', 'Ken', 'Radia', 'Edsger', 'Hedy', 'Tim']
export const hireCost = (existing: number) => 50 + 25 * existing
const MAX_GLOBS = 30

/** Validates user-typed globs: relative to the project, no escaping it. */
export function cleanGlobs(input: unknown, label: string): string[] {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[\n,]+/) : []
  const out: string[] = []
  for (const g of raw) {
    const x = String(g).trim().replace(/^\.\//, '')
    if (!x) continue
    if (x.length > 120) throw new Error(`${label}: "${x.slice(0, 30)}…" is too long`)
    if (/^([a-zA-Z]:)?[\\/]/.test(x) || x.split(/[\\/]/).includes('..')) throw new Error(`${label}: "${x}" must be a path inside the project (relative, no "..")`)
    if (!out.includes(x)) out.push(x)
  }
  if (out.length > MAX_GLOBS) throw new Error(`${label}: at most ${MAX_GLOBS} entries`)
  return out
}

/** Why this hire may not write `abs` (project-relative check), or undefined if the profile allows it. Deterministic. */
export function profileViolation(h: Pick<Hire, 'name' | 'allow' | 'deny'>, root: string, abs: string): string | undefined {
  if (h.deny.length && inScope(h.deny, root, abs)) return `${h.name} is configured never to touch this path (blocked: ${h.deny.join(', ')})`
  if (h.allow.length && !inScope(h.allow, root, abs)) return `${h.name} is configured to work only in: ${h.allow.join(', ')}`
  return undefined
}

/** Could this hire do a task with this scope? (auto-pick heuristic; real enforcement happens at write time) */
export function fitsScope(h: Pick<Hire, 'allow' | 'deny'>, scope: string[]): boolean {
  if (!h.allow.length && !h.deny.length) return true
  if (h.allow.length && !scope.length) return false // "whole project" is wider than a restricted specialist
  // A scope entry fits when the entry itself falls inside allow and outside deny (globs are matched as literal paths).
  return scope.every((s) => (!h.allow.length || inScope(h.allow, '/', '/' + s.replace(/^\.\//, ''))) && !(h.deny.length && inScope(h.deny, '/', '/' + s.replace(/^\.\//, ''))))
}

export class Staff {
  constructor(private db: DatabaseSync, private tasks: TaskStore) {}

  /** The whole company roster. `_runId` is accepted for call-site compatibility; the roster is shared by all windows. */
  list(_runId?: string): Hire[] {
    return (this.db.prepare('SELECT * FROM hires ORDER BY ts, id').all() as any[]).map((r) => ({
      id: r.id, runId: r.run_id, name: r.name, title: r.title, look: r.look, cost: r.cost, ts: r.ts, sessionId: r.session_id ?? undefined,
      focus: r.focus ?? '', instructions: r.instructions ?? '', allow: JSON.parse(r.allow ?? '[]'), deny: JSON.parse(r.deny ?? '[]')
    }))
  }

  economy(_runId?: string): Economy {
    const hires = this.list()
    const earned = this.tasks.verifiedCount() * REWARD_VERIFIED + this.tasks.deliveredCount() * REWARD_MESSAGE
    const spent = hires.reduce((a, h) => a + h.cost, 0)
    return { coins: START_COINS + earned - spent, earned, spent, nextCost: hireCost(hires.length), hires: hires.length }
  }

  hire(runId: string, name: string, title: string, profile: HireProfile = {}, now = Date.now()): Hire {
    const hires = this.list()
    const eco = this.economy()
    const nm = name.trim().slice(0, 30) || NAMES.find((n) => !hires.some((h) => h.name === n)) || `Worker ${hires.length + 1}`
    if (hires.some((h) => h.name.toLowerCase() === nm.toLowerCase())) throw new Error(`${nm} already works here`)
    const focus = String(profile.focus ?? '').trim().slice(0, 80)
    const instructions = String(profile.instructions ?? '').trim().slice(0, 2000)
    const allow = cleanGlobs(profile.allow, 'Only work in'), deny = cleanGlobs(profile.deny, 'Never touch')
    if (eco.coins < eco.nextCost) throw new Error(`Not enough coins: hiring costs ${eco.nextCost}, you have ${eco.coins}. Verified tasks earn ${REWARD_VERIFIED} each.`)
    const ttl = (TITLES as readonly string[]).includes(title) ? title : 'Developer'
    let n = hires.length + 1
    while (hires.some((h) => h.id === 'H' + n)) n++
    const id = 'H' + n
    const look = Math.floor(Math.random() * 1000)
    this.db.prepare('INSERT INTO hires (id,run_id,name,title,look,cost,ts,focus,instructions,allow,deny) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, runId, nm, ttl, look, eco.nextCost, now, focus, instructions, JSON.stringify(allow), JSON.stringify(deny))
    return { id, runId, name: nm, title: ttl, look, cost: eco.nextCost, ts: now, focus, instructions, allow, deny }
  }

  /** Change a hire's configuration later (name, title and look stay). */
  configure(hireId: string, profile: HireProfile): Hire {
    const h = this.list().find((x) => x.id === hireId); if (!h) throw new Error('unknown hire ' + hireId)
    const focus = profile.focus === undefined ? h.focus : String(profile.focus).trim().slice(0, 80)
    const instructions = profile.instructions === undefined ? h.instructions : String(profile.instructions).trim().slice(0, 2000)
    const allow = profile.allow === undefined ? h.allow : cleanGlobs(profile.allow, 'Only work in')
    const deny = profile.deny === undefined ? h.deny : cleanGlobs(profile.deny, 'Never touch')
    this.db.prepare('UPDATE hires SET focus=?, instructions=?, allow=?, deny=? WHERE run_id=? AND id=?').run(focus, instructions, JSON.stringify(allow), JSON.stringify(deny), h.runId, h.id)
    return { ...h, focus, instructions, allow, deny }
  }

  bind(hire: Pick<Hire, 'runId' | 'id'>, sessionId: string): void {
    this.db.prepare('UPDATE hires SET session_id=? WHERE run_id=? AND id=?').run(sessionId, hire.runId, hire.id)
  }
  ofSession(sessionId: string): Hire | undefined {
    return this.list().find((h) => h.sessionId === sessionId)
  }

  /** A hire is busy while its bound session is the assignee of an unfinished task in ANY window. */
  busyIds(_runId?: string): Set<string> {
    const active = this.tasks.activeAssignees()
    const busy = new Set<string>()
    for (const h of this.list()) if (h.sessionId && active.has(h.sessionId)) busy.add(h.id)
    return busy
  }

  /**
   * Picks the named hire (must be free), or the first free hire whose profile fits `scope`.
   * undefined = nobody hired; the caller falls back to an anonymous worker.
   */
  pickFree(_runId: string | undefined, wanted?: string, scope: string[] = []): Hire | undefined {
    const hires = this.list(); if (!hires.length) return undefined
    const busy = this.busyIds()
    if (wanted) {
      const h = hires.find((x) => x.id === wanted || x.name.toLowerCase() === wanted.toLowerCase())
      if (!h) throw new Error(`no hire called "${wanted}". Staff: ${hires.map((x) => x.name).join(', ')}`)
      if (busy.has(h.id)) throw new Error(`${h.name} is busy with another task`)
      return h
    }
    const free = hires.filter((h) => !busy.has(h.id))
    const fit = free.find((h) => fitsScope(h, scope))
    if (!fit && free.length) throw new Error(`no free hire is configured for this task's scope (${scope.join(', ') || 'whole project'}). Free: ${free.map((h) => `${h.name}${h.allow.length ? ' [only ' + h.allow.join(', ') + ']' : ''}`).join('; ')}. Name one explicitly, or ask the boss to hire a fitting specialist.`)
    return fit
  }
}
