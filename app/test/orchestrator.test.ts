import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { normalisePlan } from '../src/main/queen/machine'
import { Control } from '../src/main/queen/control'
import { SessionManager } from '../src/main/sessions'
import { Store } from '../src/main/store'
import { TaskStore } from '../src/main/queen/tasks'
import { Orchestrator } from '../src/main/queen/orchestrator'
import { openDb } from '../src/main/db'

const FAKE = resolve(__dirname, 'fixtures/fake-claude.js')
const until = async (f: () => boolean) => { const t = Date.now(); while (!f()) { if (Date.now() - t > 5000) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)) } }

describe('plan DAG', () => {
  it('assigns ids, rejects cycles, unknown deps, duplicates', () => {
    expect(normalisePlan({ summary: '', tasks: [{ title: 'a' }, { title: 'b', deps: ['T1'] }] }).tasks.map((t) => t.id)).toEqual(['T1', 'T2'])
    expect(() => normalisePlan({ summary: '', tasks: [{ id: 'a', title: 'a', deps: ['b'] }, { id: 'b', title: 'b', deps: ['a'] }] })).toThrow(/cycle/)
    expect(() => normalisePlan({ summary: '', tasks: [{ title: 'a', deps: ['zz'] }] })).toThrow(/unknown/)
    expect(() => normalisePlan({ summary: '', tasks: [{ id: 'x', title: 'a' }, { id: 'x', title: 'b' }] })).toThrow(/duplicate/)
  })
})

async function setup(checkOk: (cmd: string) => boolean = () => true) {
  const c = new Control(); await c.listen()
  const store = new Store(openDb(':memory:'))
  const tasks = new TaskStore(store.raw)
  const mgr = new SessionManager(store, FAKE, 8, c, resolve(__dirname, '../src/main/queen/hook-bridge.js'))
  new Orchestrator(c, mgr, tasks, async (cmd) => ({ ok: checkOk(cmd), output: 'ran ' + cmd }))
  const q = mgr.start({ name: 'q', cwd: process.cwd(), role: 'queen' })
  const tok = (id: string) => [...(c as any).byToken.entries()].find(([, r]: any) => r.sessionId === id)![0] as string
  const call = async (id: string, name: string, args: any = {}) => {
    const r: any = await fetch(`http://127.0.0.1:${c.port}/mcp/${tok(id)}`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }).then((x) => x.json())
    return { err: r.result.isError as boolean, text: r.result.content[0].text as string }
  }
  const plan = { summary: 's', tasks: [{ title: 'one', checks: ['ok1'] }, { title: 'two', deps: ['T1'], checks: ['ok2'] }, { title: 'three' }] }
  const approve = async () => {
    await call(q.id, 'ask_user', {}).catch(() => {}) // not awaited below; use machine directly
  }
  void approve
  const m = c.machineOf(q.id)!
  m.askUser()
  const sub = call(q.id, 'submit_plan', plan)
  await until(() => c.pending().length === 1)
  c.approvePlan(c.pending()[0].id, c.pending()[0].data.hash)
  await sub
  return { c, store, tasks, mgr, q, call }
}

describe('Orchestrator', () => {
  it('enforces DAG order: dependent task cannot start until dependency is verified; verified only after checks pass', async () => {
    const { c, tasks, mgr, q, call } = await setup()
    expect(JSON.parse((await call(q.id, 'get_tasks')).text).ready).toEqual(['T1', 'T3'])
    const blocked = await call(q.id, 'assign_task', { task_id: 'T2' })
    expect(blocked.err).toBe(true); expect(blocked.text).toMatch(/blocked by unverified/)
    const a = await call(q.id, 'assign_task', { task_id: 'T1' })
    expect(a.err).toBe(false)
    const w1 = tasks.get(q.id, 'T1')!.assignee!
    expect(tasks.get(q.id, 'T1')!.status).toBe('working')
    expect((await call(w1, 'report_done', { summary: 'did it' })).text).toMatch(/verified/)
    expect(tasks.get(q.id, 'T1')!.status).toBe('verified')
    expect(JSON.parse((await call(q.id, 'get_tasks')).text).ready).toEqual(['T2', 'T3'])
    expect((await call(q.id, 'assign_task', { task_id: 'T2' })).err).toBe(false)
    mgr.stopAll(); c.close()
  })

  it('failing checks → failed (not verified); no checks → awaiting_verification (never auto-verified)', async () => {
    const { c, tasks, mgr, q, call } = await setup((cmd) => cmd !== 'ok1')
    await call(q.id, 'assign_task', { task_id: 'T1' }); await call(q.id, 'assign_task', { task_id: 'T3' })
    const r = await call(tasks.get(q.id, 'T1')!.assignee!, 'report_done', { summary: 'x' })
    expect(r.text).toMatch(/FAILED/); expect(tasks.get(q.id, 'T1')!.status).toBe('failed')
    await call(tasks.get(q.id, 'T3')!.assignee!, 'report_done', { summary: 'y' })
    expect(tasks.get(q.id, 'T3')!.status).toBe('awaiting_verification')
    expect(tasks.ready(q.id).map((t) => t.id)).not.toContain('T2')
    mgr.stopAll(); c.close()
  })

  it('routes worker→worker messages through the broker and logs them', async () => {
    const { c, tasks, store, mgr, q, call } = await setup()
    await call(q.id, 'assign_task', { task_id: 'T1' }); await call(q.id, 'assign_task', { task_id: 'T3' })
    const w1 = tasks.get(q.id, 'T1')!.assignee!, w3 = tasks.get(q.id, 'T3')!.assignee!
    await until(() => store.events(w3).length > 0)
    expect((await call(w1, 'message', { to: 'T3', text: 'hello three' })).text).toBe('delivered')
    await until(() => JSON.stringify(store.events(w3)).includes('[message from T1] hello three'))
    expect(tasks.messages(q.id).some((m) => m.from === 'T1' && m.to === 'T3' && m.delivered)).toBe(true)
    expect((await call(w1, 'message', { to: 'T9', text: 'x' })).err).toBe(true)
    expect((await call(w1, 'message', { to: 'queen', text: 'x'.repeat(5000) })).err).toBe(true)
    mgr.stopAll(); c.close()
  })
})
