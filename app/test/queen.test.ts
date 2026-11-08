import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { mkdtempSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { QueenMachine, planHash } from '../src/main/queen/machine'
import { decide } from '../src/main/queen/permission'
import { Control } from '../src/main/queen/control'
import { SessionManager } from '../src/main/sessions'
import { Store } from '../src/main/store'
import { openDb } from '../src/main/db'

const plan = { summary: 's', tasks: [{ title: 't' }] }
const FAKE = resolve(__dirname, 'fixtures/fake-claude.js')

describe('QueenMachine', () => {
  it('refuses a plan before any question was asked', () => {
    const m = new QueenMachine()
    expect(() => m.submitPlan(plan)).toThrow(/ask the user/)
  })
  it('requires approval; only matching hash approves; changed plan needs re-approval', () => {
    const m = new QueenMachine()
    m.askUser(); m.submitPlan(plan)
    expect(m.canSpawnWorker()).toBe(false)
    expect(() => m.approve('bad')).toThrow(/changed/)
    m.approve(planHash(m.plan!))
    expect(m.canSpawnWorker()).toBe(true)
    m.amendPlan({ ...plan, tasks: [{ title: 'other' }] })
    expect(m.state).toBe('awaiting_approval')
    expect(m.canSpawnWorker()).toBe(false)
  })
  it('rejected plan can be revised and resubmitted', () => {
    const m = new QueenMachine(); m.askUser(); m.submitPlan(plan); m.reject()
    expect(m.canSpawnWorker()).toBe(false)
    m.submitPlan(plan); expect(m.state).toBe('awaiting_approval')
  })
})

describe('permission engine', () => {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'qproj-')))
  it('allows in-project writes, denies outside, resolves symlink escape', () => {
    expect(decide('Write', { file_path: root + '/a.txt' }, root).decision).toBe('allow')
    expect(decide('Write', { file_path: '/etc/x' }, root).decision).toBe('deny')
    expect(decide('Edit', { file_path: root + '/../x' }, root).decision).toBe('deny')
    symlinkSync('/etc', root + '/link')
    expect(decide('Write', { file_path: root + '/link/passwd' }, root).decision).toBe('deny')
  })
  it('asks for sensitive bash, allows ordinary', () => {
    expect(decide('Bash', { command: 'rm -rf build' }, root).decision).toBe('ask')
    expect(decide('Bash', { command: 'git push origin main' }, root).decision).toBe('ask')
    expect(decide('Bash', { command: 'ls -la && npm test' }, root).decision).toBe('allow')
  })
})

describe('Control + gate', () => {
  const mcp = (c: Control, token: string, method: string, params: any = {}, id = 1) =>
    fetch(`http://127.0.0.1:${c.port}/mcp/${token}`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) }).then((r) => r.json() as any)
  const until = async (f: () => boolean) => { const t = Date.now(); while (!f()) { if (Date.now() - t > 5000) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)) } }

  it('worker spawn refused before approval, allowed after; full ask→plan→approve flow over MCP', async () => {
    const c = new Control(); await c.listen()
    const store = new Store(openDb(':memory:'))
    const mgr = new SessionManager(store, FAKE, 5, c, resolve(__dirname, '../src/main/queen/hook-bridge.js'))
    const q = mgr.start({ name: 'queen', cwd: process.cwd(), role: 'queen' })
    expect(() => mgr.start({ name: 'w', cwd: process.cwd(), role: 'worker', queenId: q.id })).toThrow(/no approved plan/)

    const token = [...(c as any).byToken.entries()].find(([, r]: any) => r.sessionId === q.id)![0] as string
    expect((await mcp(c, token, 'tools/list')).result.tools.map((t: any) => t.name)).toEqual(['ask_user', 'submit_plan'])
    // submitting before asking → error result
    const early = await mcp(c, token, 'tools/call', { name: 'submit_plan', arguments: plan })
    expect(early.result.isError).toBe(true)

    const ask = mcp(c, token, 'tools/call', { name: 'ask_user', arguments: { questions: ['which db?'] } })
    await until(() => c.pending().length === 1)
    c.answer(c.pending()[0].id, ['sqlite'])
    expect((await ask).result.content[0].text).toContain('sqlite')

    const sub = mcp(c, token, 'tools/call', { name: 'submit_plan', arguments: plan })
    await until(() => c.pending().length === 1)
    expect(() => mgr.start({ name: 'w', cwd: process.cwd(), role: 'worker', queenId: q.id })).toThrow(/no approved plan/)
    const p = c.pending()[0]
    c.approvePlan(p.id, p.data.hash)
    expect((await sub).result.content[0].text).toContain('APPROVED')
    const w = mgr.start({ name: 'w', cwd: process.cwd(), role: 'worker', queenId: q.id })
    expect(w.role).toBe('worker')
    mgr.stopAll(); c.close()
  })

  it('hook bridge: denies out-of-project write, asks user for sensitive bash, fails closed when unreachable', async () => {
    const c = new Control(); await c.listen()
    const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'qproj-')))
    const { token } = c.register('s1', 'plain', root)
    const bridge = resolve(__dirname, '../src/main/queen/hook-bridge.js')
    const run = (port: number, input: any) => spawnSync(process.execPath, [bridge, String(port), token], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    const out = (r: any) => JSON.parse(r.stdout).hookSpecificOutput

    // spawnSync blocks the event loop, so run hook callers async
    const runAsync = (port: number, input: any) => new Promise<any>((res) => {
      const { spawn } = require('node:child_process')
      const p = spawn(process.execPath, [bridge, String(port), token], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
      let o = ''; p.stdout.on('data', (d: any) => (o += d)); p.on('close', () => res(JSON.parse(o).hookSpecificOutput))
      p.stdin.end(JSON.stringify(input))
    })
    expect((await runAsync(c.port, { tool_name: 'Write', tool_input: { file_path: '/etc/evil' } })).permissionDecision).toBe('deny')
    expect((await runAsync(c.port, { tool_name: 'Write', tool_input: { file_path: root + '/ok.txt' } })).permissionDecision).toBe('allow')

    const pend = runAsync(c.port, { tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/x' } })
    await until(() => c.pending().length === 1)
    expect(c.pending()[0].kind).toBe('command')
    c.decideCommand(c.pending()[0].id, false)
    expect((await pend).permissionDecision).toBe('deny')

    c.close()
    expect(out(run(c.port, { tool_name: 'Read' })).permissionDecision).toBe('deny') // server gone → fail closed
  })
})
