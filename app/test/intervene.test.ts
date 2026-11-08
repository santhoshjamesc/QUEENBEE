import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { Control } from '../src/main/queen/control'
import { SessionManager } from '../src/main/sessions'
import { Store } from '../src/main/store'
import { TaskStore } from '../src/main/queen/tasks'
import { Orchestrator } from '../src/main/queen/orchestrator'
import { openDb } from '../src/main/db'

const FAKE = resolve(__dirname, 'fixtures/fake-claude.js')
const until = async (f: () => boolean) => { const t = Date.now(); while (!f()) { if (Date.now() - t > 5000) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)) } }

describe('Queen intervention (acceptance 8)', () => {
  it('Queen can pause, resume, and stop+reassign a worker; actions are logged; foreign/unknown tasks are refused', async () => {
    const c = new Control(); await c.listen()
    const store = new Store(openDb(':memory:')); const tasks = new TaskStore(store.raw)
    const mgr = new SessionManager(store, FAKE, 8, c, resolve(__dirname, '../src/main/queen/hook-bridge.js'))
    new Orchestrator(c, mgr, tasks, async () => ({ ok: true, output: '' }))
    const q = mgr.start({ name: 'q', cwd: process.cwd(), role: 'queen' })
    const tok = (id: string) => [...(c as any).byToken.entries()].find(([, r]: any) => r.sessionId === id)![0] as string
    const call = async (id: string, name: string, args: any = {}) => { const r: any = await fetch(`http://127.0.0.1:${c.port}/mcp/${tok(id)}`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }).then((x) => x.json()); return { err: r.result.isError as boolean, text: r.result.content[0].text as string } }
    const list = async (id: string) => (await fetch(`http://127.0.0.1:${c.port}/mcp/${tok(id)}`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }).then((x) => x.json())).result.tools.map((t: any) => t.name)
    c.machineOf(q.id)!.askUser()
    const sub = call(q.id, 'submit_plan', { summary: 's', tasks: [{ title: 'one', checks: ['x'] }, { title: 'two' }] })
    await until(() => c.pending().length === 1); c.approvePlan(c.pending()[0].id, c.pending()[0].data.hash); await sub

    const names = await list(q.id); for (const n of ['pause_worker', 'resume_worker', 'stop_worker']) expect(names).toContain(n)
    const wnames = await list((await (async () => { await call(q.id, 'assign_task', { task_id: 'T1' }); return tasks.get(q.id, 'T1')!.assignee! })())); for (const n of ['pause_worker', 'resume_worker', 'stop_worker']) expect(wnames).not.toContain(n) // workers cannot intervene

    const w1 = tasks.get(q.id, 'T1')!.assignee!
    expect((await call(q.id, 'pause_worker', { task_id: 'T1', reason: 'drifting' })).err).toBe(false)
    expect(mgr.isPaused(w1)).toBe(true)
    expect((await call(q.id, 'resume_worker', { task_id: 'T1' })).err).toBe(false)
    expect(mgr.isPaused(w1)).toBe(false)

    expect((await call(q.id, 'stop_worker', { task_id: 'T1', reason: 'wrong approach' })).err).toBe(false)
    await until(() => store.getSession(w1)!.status === 'stopped')
    expect(tasks.get(q.id, 'T1')).toMatchObject({ status: 'pending', assignee: undefined })
    expect((await call(q.id, 'assign_task', { task_id: 'T1' })).err).toBe(false) // reassigned to a NEW worker
    const w1b = tasks.get(q.id, 'T1')!.assignee!; expect(w1b).not.toBe(w1)
    expect(tasks.messages(q.id).filter((m) => m.body.startsWith('[intervention]')).map((m) => m.body)).toEqual(['[intervention] paused: drifting', '[intervention] resumed', '[intervention] stopped; task returned to pending: wrong approach'])

    expect((await call(q.id, 'pause_worker', { task_id: 'T9' })).err).toBe(true)      // unknown task
    expect((await call(q.id, 'pause_worker', { task_id: 'T2' })).text).toMatch(/no worker/) // not assigned
    mgr.stopAll(); c.close()
  })
})
