import type { DatabaseSync } from 'node:sqlite'
import type { TaskStore } from './tasks'
import type { Staff } from './staff'
import type { Alert } from './watchdog'

/**
 * Chat room: ONE read model over everything people said, as simple chat messages.
 *  - boss <-> agent messages (the `chat` table, written here)
 *  - Queen <-> worker and worker <-> worker routed messages (existing `messages` table)
 *  - watchdog findings (existing alerts), shown as the watchdog talking to Queen
 * Nothing is invented: a message exists only if someone (you, an agent, the watchdog) really produced it.
 */
export interface ChatMsg { id: string; ts: number; from: string; to: string; body: string; thread: string; delivered: boolean }
export interface Person { key: string; label: string; kind: 'boss' | 'queen' | 'watchdog' | 'worker' | 'system'; live: boolean; sessionId?: string }
export interface ChatView { messages: ChatMsg[]; people: Person[] }

export const threadOf = (a: string, b: string): string => {
  if (a === 'boss' || b === 'boss') return 'boss:' + (a === 'boss' ? b : a)
  return [a, b].sort().join('|')
}

export class Chat {
  /** session id -> thread its next reply belongs to (set when the boss posts into a thread) */
  private replyThread = new Map<string, string>()
  constructor(private db: DatabaseSync, private tasks: TaskStore, private staff: Staff, private alerts: (runId: string) => Alert[], private isLive: (sessionId: string) => boolean, private send: (sessionId: string, text: string) => void) {}

  add(runId: string, thread: string, from: string, to: string, body: string, ts = Date.now()): void {
    this.db.prepare('INSERT INTO chat (run_id,thread,ts,from_id,to_id,body) VALUES (?,?,?,?,?,?)').run(runId, thread, ts, from, to, body)
  }

  /** key of a task endpoint ('T1') or hire; falls back to the task id */
  private keyOfTask(runId: string, taskId: string): string {
    const t = this.tasks.get(runId, taskId)
    const h = t?.assignee ? this.staff.ofSession(t.assignee) : undefined
    return h ? h.id : taskId
  }
  private norm(runId: string, x: string): string {
    if (x === 'queen' || x === 'boss' || x === 'watchdog') return x
    if (x === 'app') return 'system'
    return this.keyOfTask(runId, x)
  }

  people(runId: string): Person[] {
    const out: Person[] = [
      { key: 'boss', label: 'You', kind: 'boss', live: true },
      { key: 'queen', label: 'Queen', kind: 'queen', live: this.isLive(runId), sessionId: runId },
      { key: 'watchdog', label: 'Watchdog', kind: 'watchdog', live: true }
    ]
    const hires = this.staff.list(runId)
    // The roster is shared by every window; a hire's session counts here only if it is working in THIS run.
    for (const h of hires) {
      const sid = h.sessionId && this.tasks.byAssignee(h.sessionId)?.runId === runId ? h.sessionId : undefined
      out.push({ key: h.id, label: `${h.name} (${h.title}${h.focus ? ', ' + h.focus : ''})`, kind: 'worker', live: !!sid && this.isLive(sid), sessionId: sid })
    }
    for (const t of this.tasks.list(runId)) {
      if (!t.assignee || hires.some((h) => h.sessionId === t.assignee)) continue
      out.push({ key: t.id, label: `Worker ${t.id}`, kind: 'worker', live: this.isLive(t.assignee), sessionId: t.assignee })
    }
    return out
  }

  list(runId: string): ChatView {
    const msgs: ChatMsg[] = []
    for (const r of this.db.prepare('SELECT * FROM chat WHERE run_id=? ORDER BY id').all(runId) as any[])
      msgs.push({ id: 'c' + r.id, ts: r.ts, from: r.from_id, to: r.to_id, body: r.body, thread: r.thread, delivered: true })
    for (const m of this.tasks.messages(runId)) {
      const from = this.norm(runId, m.from), to = this.norm(runId, m.to)
      msgs.push({ id: 'm' + m.id, ts: m.ts, from, to, body: m.body, thread: threadOf(from, to), delivered: m.delivered })
    }
    for (const a of this.alerts(runId)) {
      const to = a.sessionId ? (a.taskId ? this.keyOfTask(runId, a.taskId) : 'queen') : 'queen'
      msgs.push({ id: 'a' + a.id, ts: a.ts, from: 'watchdog', to: to === 'watchdog' ? 'queen' : to, body: `${a.rule} (${a.confidence} confidence): ${a.evidence}`, thread: 'wd', delivered: true })
    }
    msgs.sort((x, y) => x.ts - y.ts)
    return { messages: msgs, people: this.people(runId) }
  }

  /**
   * The boss posts a message to one agent, optionally inside an existing thread (interfering in a conversation between others).
   * The agent receives it as a message from the boss; its next reply is filed in the same thread.
   */
  post(runId: string, to: string, text: string, thread?: string): void {
    const body = text.trim()
    if (!body || body.length > 4000) throw new Error('message must be 1–4000 characters')
    const p = this.people(runId).find((x) => x.key === to)
    if (!p || p.kind === 'boss' || p.kind === 'system' || p.kind === 'watchdog') throw new Error('you can message Queen or a worker')
    if (!p.sessionId || !p.live) throw new Error(`${p.label} is not running right now. ${p.kind === 'queen' ? 'Press "Resume session" for Queen.' : 'Workers start when Queen assigns them a task.'}`)
    const th = thread && thread !== 'all' && thread !== 'wd' ? thread : threadOf('boss', to)
    const others = th.startsWith('boss:') ? [] : th.split('|').filter((k) => k !== to)
    const ctx = others.length ? ` in your conversation with ${this.people(runId).find((x) => x.key === others[0])?.label ?? others[0]}` : ''
    this.send(p.sessionId, `[message from the boss${ctx}] ${body}`)
    this.add(runId, th, 'boss', to, body)
    this.replyThread.set(p.sessionId, th)
  }

  /** Log a human message that was typed straight into a session (terminal view), so the chat room is complete. */
  logBossToSession(runId: string, sessionId: string, text: string): void {
    const key = sessionId === runId ? 'queen' : this.keyOfSession(runId, sessionId)
    if (!key) return
    this.add(runId, threadOf('boss', key), 'boss', key, text)
    this.replyThread.set(sessionId, threadOf('boss', key))
  }

  private keyOfSession(runId: string, sessionId: string): string | undefined {
    const h = this.staff.ofSession(sessionId); if (h) return h.id
    const t = this.tasks.byAssignee(sessionId); return t ? t.id : undefined
  }

  /** An agent said something in plain text (not a tool call): it is a reply to the boss, in the thread the boss last used. */
  onAssistantText(sessionId: string, text: string): void {
    const t = text.trim(); if (!t) return
    const t2 = this.tasks.byAssignee(sessionId)
    const hire = this.staff.ofSession(sessionId)
    const runId = t2?.runId ?? hire?.runId ?? sessionId
    const key = sessionId === runId ? 'queen' : this.keyOfSession(runId, sessionId)
    if (!key) return
    const th = this.replyThread.get(sessionId) ?? threadOf('boss', key)
    this.add(runId, th, key, 'boss', t.slice(0, 4000))
  }
}
