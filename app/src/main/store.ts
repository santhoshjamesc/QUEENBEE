import type { DatabaseSync } from 'node:sqlite'
import type { SessionEvent, SessionInfo, SessionStatus } from '../shared/types'

const MAX_PAYLOAD = 200_000

export class Store {
  private seq = new Map<string, number>()
  constructor(private db: DatabaseSync) {}
  get raw(): DatabaseSync { return this.db }

  upsertSession(s: SessionInfo): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id,name,cwd,model,status,started_at,role) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET status=excluded.status, name=excluded.name`
      )
      .run(s.id, s.name, s.cwd, s.model ?? null, s.status, s.startedAt, s.role ?? 'plain')
  }

  setStatus(id: string, status: SessionStatus): void {
    const ended = status === 'stopped' || status === 'crashed' || status === 'error' ? Date.now() : null
    this.db.prepare('UPDATE sessions SET status=?, ended_at=COALESCE(?, ended_at) WHERE id=?').run(status, ended, id)
  }

  /** After an app crash/quit, sessions recorded as live have no process. Mark them crashed so the UI offers resume. */
  recoverOrphans(): number {
    const r = this.db.prepare("UPDATE sessions SET status='crashed', ended_at=? WHERE status IN ('spawning','idle','working')").run(Date.now())
    return Number(r.changes)
  }

  getSession(id: string): SessionInfo | undefined {
    const r = this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id) as any
    return r && { id: r.id, name: r.name, cwd: r.cwd, status: r.status, model: r.model ?? undefined, startedAt: r.started_at, role: r.role }
  }

  listSessions(): SessionInfo[] {
    return (this.db.prepare('SELECT * FROM sessions ORDER BY started_at DESC').all() as any[]).map((r) => ({
      id: r.id, name: r.name, cwd: r.cwd, status: r.status, model: r.model ?? undefined, startedAt: r.started_at, role: r.role
    }))
  }

  appendEvent(sessionId: string, type: string, subtype: string | undefined, payload: unknown): SessionEvent {
    let seq = this.seq.get(sessionId)
    if (seq === undefined) {
      const r = this.db.prepare('SELECT COALESCE(MAX(seq),0) AS m FROM events WHERE session_id=?').get(sessionId) as { m: number }
      seq = r.m
    }
    seq++
    this.seq.set(sessionId, seq)
    let text = JSON.stringify(payload)
    if (text.length > MAX_PAYLOAD) text = JSON.stringify({ truncated: true, originalSize: text.length, head: text.slice(0, MAX_PAYLOAD) })
    const ts = Date.now()
    this.db.prepare('INSERT INTO events (session_id,seq,ts,type,subtype,payload) VALUES (?,?,?,?,?,?)').run(sessionId, seq, ts, type, subtype ?? null, text)
    return { sessionId, seq, ts, type, subtype, payload: JSON.parse(text) }
  }

  /** Latest conversational event (assistant/user/result) and whether it is a tool call. Used by the office. */
  lastActivityEvent(sessionId: string): { type: string; ts: number; tool: boolean } | undefined {
    const r = this.db.prepare("SELECT type,ts,payload FROM events WHERE session_id=? AND type IN ('assistant','user','result') ORDER BY seq DESC LIMIT 1").get(sessionId) as any
    if (!r) return undefined
    let tool = false
    try { tool = r.type === 'assistant' && (JSON.parse(r.payload)?.message?.content ?? []).some((b: any) => b.type === 'tool_use') } catch { /* truncated payload */ }
    return { type: r.type, ts: r.ts, tool }
  }

  /** Recent Bash commands of a session with a snippet of their result (the "terminal" view). */
  recentCommands(sessionId: string, limit = 15): { ts: number; command: string; result?: string }[] {
    const rows = this.db.prepare("SELECT ts,type,payload FROM events WHERE session_id=? AND type IN ('assistant','user') ORDER BY seq DESC LIMIT 400").all(sessionId) as any[]
    const results = new Map<string, string>()
    const cmds: { id: string; ts: number; command: string }[] = []
    for (const r of rows) {
      let p: any; try { p = JSON.parse(r.payload) } catch { continue }
      for (const b of p?.message?.content ?? []) {
        if (r.type === 'user' && b.type === 'tool_result') results.set(b.tool_use_id, (typeof b.content === 'string' ? b.content : JSON.stringify(b.content)).slice(0, 300))
        if (r.type === 'assistant' && b.type === 'tool_use' && b.name === 'Bash') cmds.push({ id: b.id, ts: r.ts, command: String(b.input?.command ?? '').slice(0, 400) })
      }
    }
    return cmds.slice(0, limit).map((c) => ({ ts: c.ts, command: c.command, result: results.get(c.id) }))
  }

  events(sessionId: string, afterSeq = 0): SessionEvent[] {
    return (this.db.prepare('SELECT * FROM events WHERE session_id=? AND seq>? ORDER BY seq').all(sessionId, afterSeq) as any[]).map((r) => ({
      sessionId: r.session_id, seq: r.seq, ts: r.ts, type: r.type, subtype: r.subtype ?? undefined, payload: JSON.parse(r.payload)
    }))
  }

  getSetting(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as any)?.value
  }
  setSetting(key: string, value: string): void {
    this.db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value)
  }

  /** Audit trail of what the user/engine decided (principles 2, 15). */
  logDecision(sessionId: string, kind: string, summary: string, outcome: string): void {
    this.db.prepare('INSERT INTO decisions (session_id,ts,kind,summary,outcome) VALUES (?,?,?,?,?)').run(sessionId, Date.now(), kind, summary.slice(0, 2000), outcome)
  }
  decisions(sessionId: string): { ts: number; kind: string; summary: string; outcome: string }[] {
    return this.db.prepare('SELECT ts,kind,summary,outcome FROM decisions WHERE session_id=? ORDER BY id').all(sessionId) as any
  }

  /** Latest rate_limit_event across sessions (for the rate-limit panel). */
  latestRateLimit(): { ts: number; info: any } | undefined {
    const r = this.db.prepare("SELECT ts,payload FROM events WHERE type='rate_limit_event' ORDER BY ts DESC LIMIT 1").get() as any
    return r && { ts: r.ts, info: JSON.parse(r.payload).rate_limit_info }
  }
}
