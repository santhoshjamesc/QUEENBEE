import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { SessionInfo, StartSessionOptions } from '../../shared/types'
import type { Store } from '../store'
import { LineParser } from './stream'

export interface ClaudeSessionDeps {
  store: Store
  binary: string
  extraEnv?: Record<string, string>
  extraArgs?: string[] // e.g. --settings / --mcp-config added by later milestones
}

/** One real headless Claude Code process. Emits 'event' (SessionEvent) and 'status'. */
export class ClaudeSession extends EventEmitter {
  info: SessionInfo
  private proc?: ChildProcessWithoutNullStreams
  private stopping = false

  constructor(private deps: ClaudeSessionDeps, private opts: StartSessionOptions) {
    super()
    this.info = {
      id: opts.resumeId ?? randomUUID(),
      name: opts.name,
      cwd: opts.cwd,
      model: opts.model,
      status: 'spawning',
      startedAt: Date.now()
    }
  }

  start(): void {
    const { store, binary } = this.deps
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-hook-events',
      '--permission-mode', 'manual',
      ...(this.opts.resumeId ? ['--resume', this.info.id] : ['--session-id', this.info.id]),
      ...(this.opts.model ? ['--model', this.opts.model] : []),
      ...(this.deps.extraArgs ?? [])
    ]
    store.upsertSession(this.info)
    // Windows npm shims (claude.cmd/.bat) cannot be spawned without a shell; quote the command and every argument.
    const shim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(binary)
    const q = (a: string) => `"${a.replace(/"/g, '\\"')}"`
    const proc = spawn(shim ? q(binary) : binary, shim ? args.map(q) : args, { cwd: this.info.cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...this.deps.extraEnv }, shell: shim })
    this.proc = proc

    const out = new LineParser(
      (obj) => this.handle(obj),
      (line) => this.record('stdout_text', undefined, { line })
    )
    proc.stdout.setEncoding('utf8').on('data', (c: string) => out.push(c))
    proc.stdout.on('end', () => out.flush())
    proc.stderr.setEncoding('utf8').on('data', (c: string) => this.record('stderr', undefined, { text: c }))
    proc.stdin.on('error', () => {}) // EPIPE after process exit is handled by 'exit'
    proc.on('error', (e) => {
      this.record('spawn_error', undefined, { message: e.message })
      this.setStatus('error')
    })
    proc.on('exit', (code, signal) => {
      this.record('process_exit', undefined, { code, signal })
      this.setStatus(this.stopping ? 'stopped' : code === 0 ? 'stopped' : 'crashed')
    })
  }

  /** Send a user message into the running session. */
  send(text: string): void {
    if (!this.proc || this.proc.exitCode !== null) throw new Error('session not running')
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content: text } })
    this.proc.stdin.write(line + '\n')
    this.setStatus('working')
  }

  /** Stop the process. Conversation stays on disk; resume with startSession({resumeId}). */
  stop(): void {
    if (!this.proc || this.proc.exitCode !== null) return
    this.stopping = true
    this.proc.stdin.end()
    const p = this.proc
    setTimeout(() => { if (p.exitCode === null) p.kill('SIGTERM') }, 1500).unref()
    setTimeout(() => { if (p.exitCode === null) p.kill('SIGKILL') }, 5000).unref()
  }

  get running(): boolean {
    return !!this.proc && this.proc.exitCode === null && this.proc.signalCode === null
  }

  private handle(obj: any): void {
    const type = String(obj?.type ?? 'unknown')
    this.record(type, obj?.subtype, obj)
    if (type === 'result') this.setStatus('idle')
    else if (type === 'system' && obj.subtype === 'init') this.setStatus('idle')
  }

  private record(type: string, subtype: string | undefined, payload: unknown): void {
    const ev = this.deps.store.appendEvent(this.info.id, type, subtype, payload)
    this.emit('event', ev)
  }

  private setStatus(s: SessionInfo['status']): void {
    if (this.info.status === s) return
    // never leave a terminal state because of a late event
    if (['stopped', 'crashed', 'error'].includes(this.info.status)) return
    this.info.status = s
    this.deps.store.setStatus(this.info.id, s)
    this.emit('status', s)
  }
}
