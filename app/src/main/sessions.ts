import { EventEmitter } from 'node:events'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { SessionInfo, StartSessionOptions } from '../shared/types'
import { ClaudeSession } from './claude/session'
import type { Control } from './queen/control'
import { QUEEN_PROMPT } from './queen/control'
import type { Store } from './store'

export class SessionManager extends EventEmitter {
  private live = new Map<string, ClaudeSession>()
  /** hookScript: absolute path of hook-bridge.js; hooks/MCP are wired only when a Control server is supplied. */
  constructor(private store: Store, private binary: string, private maxSessions = 5, private control?: Control, private hookScript?: string, private hookNode: string = process.execPath) { super() }

  get max(): number { return this.maxSessions }
  setMax(n: number): void {
    if (!Number.isInteger(n) || n < 1 || n > 20) throw new Error('max sessions must be an integer 1–20')
    this.maxSessions = n
    this.store.setSetting('maxSessions', String(n))
  }

  start(opts: StartSessionOptions): SessionInfo {
    const role = opts.role ?? 'plain'
    // Code-level gate (principle 3): a worker cannot exist without an approved plan in its Queen's machine.
    if (role === 'worker') {
      if (!opts.queenId || !this.control?.canSpawnWorker(opts.queenId)) throw new Error('worker spawn refused: no approved plan')
    }
    const running = [...this.live.values()].filter((s) => s.running).length
    if (running >= this.maxSessions) throw new Error(`max concurrent sessions (${this.maxSessions}) reached`)

    const extra: string[] = []
    const s = new ClaudeSession({ store: this.store, binary: this.binary, extraArgs: extra, extraEnv: this.control ? { ELECTRON_RUN_AS_NODE: '1' } : undefined }, opts)
    s.info.role = role
    if (this.control && this.hookScript) {
      const { token } = this.control.register(s.info.id, role, resolve(opts.cwd), { queenId: opts.queenId, taskId: opts.taskId })
      const dir = join(tmpdir(), 'queen-' + process.pid)
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      const q = (x: string) => JSON.stringify(x)
      const settings = { hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `${q(this.hookNode)} ${q(this.hookScript)} ${this.control.port} ${token}`, timeout: 3600 }] }] } }
      const sp = join(dir, token + '.settings.json'); writeFileSync(sp, JSON.stringify(settings), { mode: 0o600 })
      extra.push('--settings', sp)
      if (role === 'queen' || role === 'worker') {
        const mp = join(dir, token + '.mcp.json')
        writeFileSync(mp, JSON.stringify({ mcpServers: { queen: { type: 'http', url: `http://127.0.0.1:${this.control.port}/mcp/${token}` } } }), { mode: 0o600 })
        extra.push('--mcp-config', mp, '--strict-mcp-config', '--append-system-prompt', role === 'queen' ? QUEEN_PROMPT : opts.systemPrompt ?? '')
      }
      // Skill isolation (verified on claude 2.1.319): no setting sources hides personal+project skills; the generated
      // plugin exposes exactly the assigned ones as queen:<name>. --settings/--mcp-config still apply.
      if (role === 'worker' && opts.skillPluginDir) extra.push('--setting-sources', '', '--plugin-dir', opts.skillPluginDir)
    }
    this.live.set(s.info.id, s)
    s.on('event', (e) => this.emit('event', e))
    s.on('status', () => this.emit('status', s.info))
    s.start()
    return s.info
  }

  private queued = new Map<string, string[]>()
  /** Pause: next tool call blocks in the hook; messages are held and delivered on resume. */
  pause(id: string): void { this.get(id); this.control?.pause(id); this.emit('status', this.get(id).info) }
  resume(id: string): void {
    this.control?.resume(id)
    for (const m of this.queued.get(id) ?? []) this.get(id).send(m)
    this.queued.delete(id); this.emit('status', this.get(id).info)
  }
  isPaused(id: string): boolean { return !!this.control?.isPaused(id) }

  send(id: string, text: string): void {
    if (this.isPaused(id)) { this.get(id); this.queued.set(id, [...(this.queued.get(id) ?? []), text]); return }
    this.get(id).send(text)
  }
  stop(id: string): void { this.get(id).stop() }
  list(): SessionInfo[] { return this.store.listSessions().map((s) => ({ ...s, paused: this.isPaused(s.id) })) }
  stopAll(): void { for (const s of this.live.values()) s.stop() }

  private get(id: string): ClaudeSession {
    const s = this.live.get(id)
    if (!s) throw new Error('session not live: ' + id)
    return s
  }
}
