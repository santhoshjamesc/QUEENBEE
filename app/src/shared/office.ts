import type { PendingItem, SessionInfo } from './types'

/**
 * Office state derivation. PURE: the office can show nothing that is not computed here from real orchestration
 * data (sessions, tasks, pending approvals, alerts, routed messages, last stream event). Every character carries
 * the evidence for its state. No randomness, no timers, no "ambient" activity.
 */
export type OfficeState = 'working' | 'thinking' | 'waiting' | 'idle' | 'blocked' | 'meeting' | 'completed' | 'error'
export const MEETING_WINDOW_MS = 60_000
export const WALK_IN_MS = 3500

export interface OfficeTask { id: string; title: string; status: string; assignee?: string }
export interface OfficeAlert { sessionId?: string; status: string; rule: string; confidence: string }
export interface OfficeMessage { from: string; to: string; ts: number; delivered: boolean }
export interface LastEvent { type: string; ts: number; tool: boolean }
export interface OfficeInputs {
  now: number
  queenId?: string
  sessions: SessionInfo[]
  tasks: OfficeTask[]
  pending: Pick<PendingItem, 'sessionId' | 'kind'>[]
  alerts: OfficeAlert[]
  messages: OfficeMessage[]
  last: Record<string, LastEvent | undefined>
  hires?: OfficeHire[]
}
export interface OfficeHire { id: string; name: string; title: string; look: number; ts: number; sessionId?: string; focus?: string; /** busy with a task in another window */ elsewhere?: boolean }
export interface Character {
  sessionId: string
  role: 'queen' | 'worker' | 'watchdog'
  /** hired staff only: appearance seed, title, and when they were hired (drives the walk-in animation) */
  hireId?: string; title?: string; look?: number; hiredAt?: number; fresh?: boolean
  name: string
  taskId?: string
  taskTitle?: string
  taskStatus?: string
  state: OfficeState
  /** human-readable evidence taken from the inputs that produced `state` */
  reason: string
  /** where the character is drawn */
  seat: { kind: 'queen' | 'desk' | 'meeting'; index: number }
  /** desk a worker returns to when not in a meeting */
  desk?: number
  /** watchdogs only: sessions with an open alert this dog is investigating (it walks to them) */
  watching?: string[]
}

const LIVE = new Set(['spawning', 'idle', 'working'])
const clock = (t: number) => new Date(t).toLocaleTimeString()

export function deriveOffice(i: OfficeInputs): Character[] {
  const byId = new Map(i.sessions.map((s) => [s.id, s]))
  const taskOf = new Map<string, OfficeTask>()
  for (const t of i.tasks) if (t.assignee) taskOf.set(t.assignee, t)
  const ids: string[] = []
  if (i.queenId && byId.has(i.queenId)) ids.push(i.queenId)
  for (const t of i.tasks) if (t.assignee && byId.has(t.assignee) && !ids.includes(t.assignee)) ids.push(t.assignee)

  // task id ('T1') / 'queen' → session id, for routed messages
  const endpoint = (x: string): string | undefined => (x === 'queen' ? i.queenId : i.tasks.find((t) => t.id === x)?.assignee)
  const meeting = new Map<string, string>()
  for (const m of i.messages) {
    if (!m.delivered || i.now - m.ts > MEETING_WINDOW_MS || i.now < m.ts) continue
    const a = endpoint(m.from), b = endpoint(m.to)
    if (!a || !b || a === b) continue
    meeting.set(a, `exchanged a routed message with ${m.to === (taskOf.get(a)?.id ?? 'queen') ? m.from : m.to} at ${clock(m.ts)}`)
    meeting.set(b, `exchanged a routed message with ${m.from === (taskOf.get(b)?.id ?? 'queen') ? m.to : m.from} at ${clock(m.ts)}`)
  }

  let desk = 0, seat = 0
  const out: Character[] = []
  for (const id of ids) {
    const s = byId.get(id)!
    const task = taskOf.get(id)
    const live = LIVE.has(s.status)
    const open = i.alerts.filter((a) => a.sessionId === id && a.status === 'open')
    const pend = i.pending.filter((p) => p.sessionId === id)
    const last = i.last[id]
    let state: OfficeState, reason: string

    if (s.status === 'crashed' || s.status === 'error') { state = 'error'; reason = `session ${s.status}` }
    else if (task?.status === 'verified') { state = 'completed'; reason = `task ${task.id} verified by its checks` }
    else if (live && pend.length) { state = 'waiting'; reason = `waiting for you: ${pend.map((p) => p.kind).join(', ')} approval pending` }
    else if (live && (s.paused || open.length)) { state = 'blocked'; reason = s.paused ? 'paused (holds at next tool call)' : `open alert: ${open.map((a) => a.rule + ' (' + a.confidence + ')').join(', ')}` }
    else if (live && meeting.has(id)) { state = 'meeting'; reason = meeting.get(id)! }
    else if (s.status === 'working') {
      if (last?.tool) { state = 'working'; reason = `tool call issued at ${clock(last.ts)}` }
      else { state = 'thinking'; reason = last ? `working, last event "${last.type}" at ${clock(last.ts)}` : 'working, no event recorded yet' }
    } else {
      state = 'idle'
      reason = s.status === 'stopped' ? `session stopped${task ? ` (task ${task.id} is ${task.status})` : ''}` : s.status === 'spawning' ? 'starting' : 'session idle, waiting for input'
    }
    const kind = id === i.queenId ? 'queen' : state === 'meeting' ? 'meeting' : 'desk'
    const index = kind === 'queen' ? 0 : kind === 'meeting' ? seat++ : 0
    out.push({ sessionId: id, role: id === i.queenId ? 'queen' : 'worker', name: s.name, taskId: task?.id, taskTitle: task?.title, taskStatus: task?.status, state, reason, seat: { kind, index } })
  }
  // Hired staff: decorate their session's character, or show them idle at their desk until Queen assigns work.
  const hires = i.hires ?? []
  for (const h of hires) {
    const c = h.sessionId ? out.find((x) => x.sessionId === h.sessionId) : undefined
    const deco = { hireId: h.id, title: h.title, look: h.look, hiredAt: h.ts, fresh: i.now - h.ts < WALK_IN_MS && i.now >= h.ts }
    if (c) { Object.assign(c, deco, { name: h.name }); continue }
    out.push({ sessionId: 'hire:' + h.id, role: 'worker', name: h.name, state: 'idle', reason: h.elsewhere ? 'busy with a task in another window' : h.sessionId ? 'between tasks, waiting for Queen' : 'hired; waiting for Queen to assign a task', seat: { kind: 'desk', index: 0 }, ...deco })
  }
  // Desks: hired staff first (in hiring order), so nobody moves when someone else is hired; then anonymous workers.
  const workers = [...out.filter((c) => c.role === 'worker' && c.hireId).sort((a, b) => (a.hiredAt ?? 0) - (b.hiredAt ?? 0)), ...out.filter((c) => c.role === 'worker' && !c.hireId)]
  for (const c of workers) { c.desk = desk++; if (c.seat.kind === 'desk') c.seat.index = c.desk }
  // Watchdogs are always on the team. They are only "working" while a real alert is open.
  if (i.queenId && byId.has(i.queenId)) {
    const open = i.alerts.filter((a) => a.status === 'open')
    for (const n of [1, 2]) {
      const mine = open.filter((_, k) => k % 2 === n - 1)
      out.push({ sessionId: 'watchdog:' + n, role: 'watchdog', name: n === 1 ? 'Rex' : 'Bolt', state: mine.length ? 'working' : 'idle', watching: mine.map((a) => a.sessionId).filter((x): x is string => !!x), seat: { kind: 'queen', index: n },
        reason: mine.length ? `investigating open alert: ${mine.map((a) => a.rule + ' (' + a.confidence + ')').join(', ')}` : 'on watch: no open alerts' })
    }
  }
  return out
}

/** States that need frames; everything else is a static pose, so an idle office costs no animation. */
export const ANIMATED: ReadonlySet<OfficeState> = new Set(['working', 'thinking', 'meeting', 'waiting', 'blocked'])
export const needsAnimation = (cs: Character[]) => cs.some((c) => ANIMATED.has(c.state) || c.fresh)

/** Frame loop: ≤ `fps`, stops when nothing animates or the window is hidden. Injectable for tests. */
export class FrameLoop {
  private raf?: number; private last = 0; private active = false
  frames = 0
  constructor(private draw: (t: number) => void, private env: { raf: (cb: (t: number) => void) => number; cancel: (id: number) => void; hidden: () => boolean }, private fps = 12) {}
  get running(): boolean { return this.raf !== undefined }
  setActive(a: boolean): void { this.active = a; this.sync() }
  sync(): void {
    const should = this.active && !this.env.hidden()
    if (should && this.raf === undefined) this.raf = this.env.raf(this.tick)
    if (!should && this.raf !== undefined) { this.env.cancel(this.raf); this.raf = undefined }
  }
  private tick = (t: number) => {
    this.raf = undefined
    if (t - this.last >= 1000 / this.fps) { this.last = t; this.frames++; this.draw(t) }
    this.sync()
  }
}

// ---------------- layout (pure, in a 320-wide virtual pixel grid) ----------------
export interface Rect { x: number; y: number; w: number; h: number }
export interface OfficeLayout { width: number; height: number; queenRoom: Rect; meetingRoom: Rect; shared: Rect; table: Rect; pos: Record<string, { x: number; y: number }>; deskArea: Rect; desks: Rect[] }
export const GRID_W = 320, MEETING_SEATS = 6, DESKS_PER_ROW = 8
const SEATS: [number, number][] = [[-22, -8], [0, -12], [22, -8], [-22, 14], [0, 18], [22, 14]]

export function layoutOffice(cs: Character[]): OfficeLayout {
  const workers = cs.filter((c) => c.role === 'worker')
  const nDesks = Math.max(workers.length, 1)
  const rows = Math.ceil(nDesks / DESKS_PER_ROW)
  const queenRoom = { x: 8, y: 8, w: 96, h: 68 }, meetingRoom = { x: 216, y: 8, w: 96, h: 68 }
  const table = { x: meetingRoom.x + 30, y: meetingRoom.y + 24, w: 36, h: 20 }
  const deskArea = { x: 8, y: 84, w: 304, h: rows * 40 }
  const shared = { x: 8, y: deskArea.y + deskArea.h + 4, w: 304, h: 26 }
  const desks = Array.from({ length: nDesks }, (_, d) => ({ x: 8 + (d % DESKS_PER_ROW) * 38 + 3, y: 84 + Math.floor(d / DESKS_PER_ROW) * 40 + 4, w: 32, h: 32 }))
  const deskPos = (d: number) => ({ x: desks[d].x + 16, y: desks[d].y + 12 })
  const pos: Record<string, { x: number; y: number }> = {}
  for (const c of cs) {
    if (c.role === 'queen') pos[c.sessionId] = { x: queenRoom.x + 48, y: queenRoom.y + 36 }
    else if (c.role === 'watchdog') pos[c.sessionId] = { x: queenRoom.x + (c.seat.index === 1 ? 14 : 82), y: queenRoom.y + 56 }
    else if (c.seat.kind === 'meeting' && c.seat.index < MEETING_SEATS) { const [dx, dy] = SEATS[c.seat.index]; pos[c.sessionId] = { x: table.x + 18 + dx, y: table.y + 10 + dy } }
    else pos[c.sessionId] = deskPos(c.desk ?? 0)
  }
  return { width: GRID_W, height: shared.y + shared.h + 8, queenRoom, meetingRoom, shared, table, pos, deskArea, desks }
}
