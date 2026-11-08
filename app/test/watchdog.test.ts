import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { LeaseTable } from '../src/main/queen/leases'
import { classifyWrite, inScope } from '../src/main/queen/scope'
import { inactive, repeatedFailure, waitCycle } from '../src/main/queen/detectors'
import { Control } from '../src/main/queen/control'
import { SessionManager } from '../src/main/sessions'
import { Store } from '../src/main/store'
import { TaskStore } from '../src/main/queen/tasks'
import { Orchestrator } from '../src/main/queen/orchestrator'
import { Watchdog } from '../src/main/queen/watchdog'
import { openDb } from '../src/main/db'

const FAKE = resolve(__dirname, 'fixtures/fake-claude.js')
const until = async (f: () => boolean, ms = 5000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 15)) } }

describe('pure rules', () => {
  it('leases: exclusive, refresh by owner, expire, release', () => {
    let t = 0; const l = new LeaseTable(1000, () => t)
    expect(l.acquire('f', 'A')).toEqual({ ok: true })
    expect(l.acquire('f', 'B')).toEqual({ ok: false, heldBy: 'A' })
    expect(l.acquire('f', 'A').ok).toBe(true)
    t = 5000; expect(l.acquire('f', 'B').ok).toBe(true)
    l.releaseAll('B'); expect(l.heldBy('f')).toBeUndefined()
  })
  it('scope globs', () => {
    const r = '/p'
    expect(inScope(['src/**'], r, '/p/src/a/b.ts')).toBe(true)
    expect(inScope(['src'], r, '/p/src/a.ts')).toBe(true)
    expect(inScope(['src/*.ts'], r, '/p/src/a/b.ts')).toBe(false)
    expect(inScope(['hello.txt'], r, '/p/other.txt')).toBe(false)
    expect(inScope([], r, '/p/anything')).toBe(true)
  })
  it('detectors', () => {
    expect(inactive([{ id: 'a', lastEventTs: 0 }, { id: 'b', lastEventTs: 9000 }], 10000, 5000).map((x) => x.id)).toEqual(['a'])
    const ev = (n: number, err = true) => ({ sessionId: 's', seq: n, ts: n, type: 'user', payload: { message: { content: [{ type: 'tool_result', is_error: err, content: `ENOENT /tmp/x${n}/file ${n}` }] } } })
    expect(repeatedFailure([ev(1), ev(2), ev(3)])?.count).toBe(3)
    expect(repeatedFailure([ev(1), ev(2), ev(3, false)])).toBeNull()
    expect(waitCycle([['A', 'B'], ['B', 'C'], ['C', 'A']])).toEqual(['A', 'B', 'C', 'A'])
    expect(waitCycle([['A', 'B'], ['B', 'C']])).toBeNull()
  })
})

async function setup(o: { now?: () => number; inactivityMs?: number } = {}) {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'wd-')))
  mkdirSync(resolve(root, 'src')); mkdirSync(resolve(root, 'docs'))
  writeFileSync(resolve(root, 'src/a.ts'), "import { u } from './util'\nexport const a = u\n")
  writeFileSync(resolve(root, 'src/util.ts'), 'export const u = 1\n')
  writeFileSync(resolve(root, 'src/zzz.ts'), 'export const z = 1\n')
  writeFileSync(resolve(root, 'package.json'), '{}')
  const c = new Control(); await c.listen()
  const store = new Store(openDb(':memory:'))
  const tasks = new TaskStore(store.raw)
  const mgr = new SessionManager(store, FAKE, 8, c, resolve(__dirname, '../src/main/queen/hook-bridge.js'))
  new Orchestrator(c, mgr, tasks, async () => ({ ok: true, output: '' }))
  const wd = new Watchdog(store, mgr, c, tasks, { intervalMs: 0, ...o })
  const q = mgr.start({ name: 'q', cwd: root, role: 'queen' })
  const tok = (id: string) => [...(c as any).byToken.entries()].find(([, r]: any) => r.sessionId === id)![0] as string
  const mcp = (id: string, name: string, args: any = {}) => fetch(`http://127.0.0.1:${c.port}/mcp/${tok(id)}`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }).then((r) => r.json() as any)
  const hook = (id: string, tool: string, input: any) => fetch(`http://127.0.0.1:${c.port}/hook/${tok(id)}`, { method: 'POST', body: JSON.stringify({ tool_name: tool, tool_input: input }) }).then((r) => r.json() as any).then((j) => j.hookSpecificOutput)
  c.machineOf(q.id)!.askUser()
  const sub = mcp(q.id, 'submit_plan', { summary: 's', tasks: [
    { title: 'one', scope: ['src/a.ts'] }, { title: 'two', scope: ['src/**'] }, { title: 'three', scope: ['docs'] }] })
  await until(() => c.pending().length === 1)
  c.approvePlan(c.pending()[0].id, c.pending()[0].data.hash); await sub
  const worker = async (task: string) => { await mcp(q.id, 'assign_task', { task_id: task }); return tasks.get(q.id, task)!.assignee! }
  const done = () => { mgr.stopAll(); wd.close(); c.close() }
  return { root, c, store, tasks, mgr, wd, q, mcp, hook, worker, done }
}

describe('Watchdog policy (hook-time)', () => {
  it('symlinks are resolved: a link inside scope cannot reach an out-of-scope file, and a link shares its target\'s lease', async () => {
    const { root, wd, q, hook, worker, done } = await setup()
    symlinkSync(resolve(root, 'src/zzz.ts'), resolve(root, 'src/a-alias.ts'))   // looks like it matches src/a*, targets zzz
    symlinkSync(resolve(root, 'src/a.ts'), resolve(root, 'src/a-link.ts'))
    const w1 = await worker('T1') // scope: src/a.ts only
    const bad = await hook(w1, 'Write', { file_path: root + '/src/a-alias.ts' })
    expect(bad.permissionDecision).toBe('deny'); expect(bad.permissionDecisionReason).toMatch(/outside task scope/)
    expect((await hook(w1, 'Write', { file_path: root + '/src/a-link.ts' })).permissionDecision).toBe('allow')
    expect(wd.leases.heldBy(resolve(root, 'src/a.ts'))).toBe(w1) // lease keyed by the real path
    expect(wd.alerts(q.id).some((a) => a.rule === 'out-of-scope-write')).toBe(true)
    done()
  })
  it('out-of-scope write denied with evidence + alert; in-scope allowed; dependency/manifest allowed with note only', async () => {
    const { root, wd, q, hook, worker, done } = await setup()
    const w1 = await worker('T1')
    expect((await hook(w1, 'Write', { file_path: root + '/src/a.ts' })).permissionDecision).toBe('allow')
    const bad = await hook(w1, 'Write', { file_path: root + '/src/zzz.ts' })
    expect(bad.permissionDecision).toBe('deny'); expect(bad.permissionDecisionReason).toMatch(/outside task scope/)
    expect((await hook(w1, 'Write', { file_path: root + '/src/util.ts' })).permissionDecision).toBe('allow') // imported by a.ts
    expect((await hook(w1, 'Write', { file_path: root + '/package.json' })).permissionDecision).toBe('allow')
    const rules = wd.alerts(q.id).map((a) => a.rule)
    expect(rules).toContain('out-of-scope-write')
    expect(rules).toContain('scope-note-dependency'); expect(rules).toContain('scope-note-manifest')
    const viol = wd.alerts(q.id).find((a) => a.rule === 'out-of-scope-write')!
    expect(viol.confidence).toBe('high'); expect(viol.evidence).toMatch(/zzz\.ts/)
    expect(wd.alerts(q.id).filter((a) => a.rule === 'out-of-scope-write')).toHaveLength(1)
    done()
  })

  it('lease conflict: second worker denied while first holds the file; allowed after first stops', async () => {
    const { root, mgr, wd, q, hook, worker, done } = await setup()
    const w1 = await worker('T1'), w2 = await worker('T2')
    expect((await hook(w1, 'Edit', { file_path: root + '/src/a.ts' })).permissionDecision).toBe('allow')
    const r = await hook(w2, 'Edit', { file_path: root + '/src/a.ts' })
    expect(r.permissionDecision).toBe('deny'); expect(r.permissionDecisionReason).toMatch(/owned by task T1/)
    expect(wd.alerts(q.id).some((a) => a.rule === 'lease-conflict')).toBe(true)
    mgr.stop(w1); await until(() => mgr.list().find((s) => s.id === w1)!.status === 'stopped'); wd.tick()
    expect((await hook(w2, 'Edit', { file_path: root + '/src/a.ts' })).permissionDecision).toBe('allow')
    done()
  })

  it('pause holds the next tool call until resume; messages queue', async () => {
    const { root, mgr, store, hook, worker, done } = await setup()
    const w = await worker('T2')
    mgr.pause(w)
    let settled = false
    const p = hook(w, 'Write', { file_path: root + '/src/zzz.ts' }).then((x) => { settled = true; return x })
    await new Promise((r) => setTimeout(r, 300)); expect(settled).toBe(false)
    mgr.send(w, 'queued msg')
    await new Promise((r) => setTimeout(r, 200)); expect(JSON.stringify(store.events(w))).not.toContain('queued msg')
    mgr.resume(w)
    expect((await p).permissionDecision).toBe('allow')
    await until(() => JSON.stringify(store.events(w)).includes('echo:queued msg'))
    done()
  })
})

describe('Watchdog detectors + filesystem ground truth', () => {
  it('inactivity, repeated failure alerts with evidence; ask-worker message delivered', async () => {
    let skew = 0
    const { store, mgr, wd, q, mcp, worker, done } = await setup({ now: () => Date.now() + skew, inactivityMs: 60_000 })
    void mcp
    const w = await worker('T3')
    await until(() => store.events(w).some((e) => e.type === 'result'))
    mgr.send(w, 'HANG now'); await until(() => mgr.list().find((s) => s.id === w)!.status === 'working')
    wd.tick(); expect(wd.alerts(q.id).some((a) => a.rule === 'inactivity')).toBe(false)
    skew = 5 * 60_000; wd.tick()
    const a = wd.alerts(q.id).find((x) => x.rule === 'inactivity')!
    expect(a.evidence).toMatch(/no events for/); expect(a.sessionId).toBe(w)
    for (let i = 1; i <= 3; i++) store.appendEvent(w, 'user', undefined, { message: { content: [{ type: 'tool_result', is_error: true, content: `fail ${i}` }] } })
    wd.tick(); expect(wd.alerts(q.id).some((x) => x.rule === 'repeated-failure' && x.confidence === 'high')).toBe(true)
    done()
  })

  const hang = async (store: any, mgr: any, w: string) => {
    await until(() => store.events(w).some((e: any) => e.type === 'result'))
    mgr.send(w, 'HANG'); await until(() => mgr.list().find((s: any) => s.id === w)!.status === 'working')
  }

  it('bash-made out-of-scope change is attributed to the single working worker (medium confidence)', async () => {
    const { root, mgr, store, wd, q, worker, done } = await setup()
    const w1 = await worker('T1'); await hang(store, mgr, w1)
    wd.onFsChange(q.id, root, root + '/src/zzz.ts', 'change')
    const a = wd.alerts(q.id).find((x) => x.rule === 'bash-out-of-scope-change')!
    expect(a.confidence).toBe('medium'); expect(a.sessionId).toBe(w1); expect(a.evidence).toMatch(/zzz\.ts/)
    // in-scope bash change is not flagged
    wd.onFsChange(q.id, root, root + '/src/a.ts', 'change')
    expect(wd.alerts(q.id).filter((x) => x.rule === 'bash-out-of-scope-change')).toHaveLength(1)
    done()
  })

  it('two workers active → attribution flagged uncertain (low, note only); hook-visible writes are not re-flagged', async () => {
    const { root, mgr, store, wd, q, hook, worker, done } = await setup()
    const w1 = await worker('T1'), w3 = await worker('T3')
    await hang(store, mgr, w1); await hang(store, mgr, w3)
    await hook(w1, 'Write', { file_path: root + '/src/a.ts' }) // hook-visible write by w1
    wd.onFsChange(q.id, root, root + '/src/a.ts', 'change')
    expect(wd.alerts(q.id).some((x) => x.rule === 'bash-out-of-scope-change')).toBe(false)
    wd.onFsChange(q.id, root, root + '/src/zzz.ts', 'change')
    const unc = wd.alerts(q.id).filter((x) => x.rule === 'bash-out-of-scope-change')
    expect(unc.length).toBeGreaterThan(0)
    expect(unc.every((x) => x.confidence === 'low' && x.response === 'note' && /attribution uncertain/.test(x.evidence))).toBe(true)
    const rows = store.raw.prepare('SELECT certain, source FROM file_activity ORDER BY id').all() as any[]
    expect(rows.map((r) => r.source)).toEqual(['hook', 'bash-or-other']); expect(rows[1].certain).toBe(0)
    done()
  })

  it('real chokidar watcher records an external change', async () => {
    const { root, store, wd, q, done } = await setup()
    const w = wd.watchProject(root, q.id)
    await new Promise<void>((r) => w.on('ready', () => r()))
    writeFileSync(resolve(root, 'docs/new.md'), 'x')
    await until(() => (store.raw.prepare('SELECT COUNT(*) c FROM file_activity').get() as any).c > 0, 8000)
    const row = store.raw.prepare('SELECT * FROM file_activity').get() as any
    expect(row.source).toBe('external'); expect(row.path).toMatch(/docs\/new\.md$/)
    done()
  })
})
