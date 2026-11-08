import { describe, it, expect } from 'vitest'
import { resolve, join } from 'node:path'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { openDb } from '../src/main/db'
import { Store } from '../src/main/store'
import { Control } from '../src/main/queen/control'
import { SessionManager } from '../src/main/sessions'
import { TaskStore } from '../src/main/queen/tasks'
import { Orchestrator } from '../src/main/queen/orchestrator'
import { CodeIndex } from '../src/main/intel'

const FAKE = resolve(__dirname, 'fixtures/fake-claude.js')
const until = async (f: () => boolean) => { const t = Date.now(); while (!f()) { if (Date.now() - t > 8000) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)) } }

describe('code intelligence through Queen/worker tools', () => {
  it('exposes code tools to both roles, answers queries, and briefs the worker with relevant code', async () => {
    const proj = realpathSync(mkdtempSync(join(tmpdir(), 'qio-')))
    mkdirSync(join(proj, 'src'))
    writeFileSync(join(proj, 'src/math.ts'), 'export function add(a: number, b: number) { return a + b }\n')
    writeFileSync(join(proj, 'src/use.ts'), "import { add } from './math'\nexport const three = add(1, 2)\n")
    const c = new Control(); await c.listen()
    const store = new Store(openDb(':memory:'))
    const tasks = new TaskStore(store.raw)
    const mgr = new SessionManager(store, FAKE, 8, c, resolve(__dirname, '../src/main/queen/hook-bridge.js'))
    new Orchestrator(c, mgr, tasks, async () => ({ ok: true, output: '' }), undefined, new CodeIndex(store.raw))
    const q = mgr.start({ name: 'q', cwd: proj, role: 'queen' })
    const tok = (id: string) => [...(c as any).byToken.entries()].find(([, r]: any) => r.sessionId === id)![0] as string
    const rpc = async (id: string, method: string, params: any = {}) => (await fetch(`http://127.0.0.1:${c.port}/mcp/${tok(id)}`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((x) => x.json())).result
    const call = async (id: string, name: string, args: any = {}) => { const r = await rpc(id, 'tools/call', { name, arguments: args }); return { err: r.isError as boolean, text: r.content[0].text as string } }

    c.machineOf(q.id)!.askUser()
    const sub = call(q.id, 'submit_plan', { summary: 's', tasks: [{ title: 'change add', scope: ['src/math.ts'] }] })
    await until(() => c.pending().length === 1)
    c.approvePlan(c.pending()[0].id, c.pending()[0].data.hash); await sub

    const names = (await rpc(q.id, 'tools/list')).tools.map((t: any) => t.name)
    for (const n of ['code_search', 'code_impact', 'code_health']) expect(names).toContain(n)
    expect(JSON.parse((await call(q.id, 'code_search', { mode: 'symbols', query: 'add' })).text)[0]).toMatchObject({ path: 'src/math.ts', kind: 'function' })
    expect(JSON.parse((await call(q.id, 'code_search', { mode: 'references', query: 'add' })).text).refs[0].path).toBe('src/use.ts')
    expect(JSON.parse((await call(q.id, 'code_search', { mode: 'imports', query: 'src/math.ts' })).text).importedBy).toEqual(['src/use.ts'])
    expect(JSON.parse((await call(q.id, 'code_impact', { path: 'src/math.ts' })).text)).toEqual([{ path: 'src/use.ts', distance: 1 }])
    expect(Array.isArray(JSON.parse((await call(q.id, 'code_health')).text))).toBe(true)
    expect((await call(q.id, 'code_search', { mode: 'bogus', query: 'x' })).err).toBe(true)

    expect((await call(q.id, 'assign_task', { task_id: 'T1' })).err).toBe(false)
    const w = tasks.get(q.id, 'T1')!.assignee!
    expect((await rpc(w, 'tools/list')).tools.map((t: any) => t.name)).toContain('code_impact')
    await until(() => store.events(w).some((e) => e.type === 'assistant'))
    const echoed = JSON.stringify(store.events(w).filter((e) => e.type === 'assistant').map((e) => e.payload))
    expect(echoed).toContain('Relevant code from the project index')
    expect(echoed).toContain('imported by (check you do not break these): src/use.ts')
    expect(echoed).toContain('add (function) src/math.ts:1')
    mgr.stopAll(); c.close()
  })
})
