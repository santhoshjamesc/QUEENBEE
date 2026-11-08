import { describe, it, expect } from 'vitest'
import { resolve, join } from 'node:path'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { openDb } from '../src/main/db'
import { Store } from '../src/main/store'
import { SessionManager } from '../src/main/sessions'
import { Control } from '../src/main/queen/control'
import { TaskStore } from '../src/main/queen/tasks'
import { Orchestrator } from '../src/main/queen/orchestrator'
import { CodeIndex } from '../src/main/intel'
import { planHash } from '../src/main/queen/machine'
import { findClaudeBinary } from '../src/main/claude/binary'

const real = process.env.QUEEN_REAL === '1'
const until = async (f: () => boolean, ms: number) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 100)) } }

describe.skipIf(!real)('real worker uses code intelligence tools (M7 acceptance)', () => {
  it('calls mcp__queen__code_impact and reports the true importer', async () => {
    const proj = realpathSync(mkdtempSync(resolve(tmpdir(), 'qintelreal-'))); mkdirSync(join(proj, 'src'))
    writeFileSync(join(proj, 'src/core.ts'), 'export function coreFn() { return 1 }\n')
    writeFileSync(join(proj, 'src/feature.ts'), "import { coreFn } from './core'\nexport const f = coreFn()\n")
    const c = new Control(); await c.listen()
    const store = new Store(openDb(':memory:')); const tasks = new TaskStore(store.raw)
    const mgr = new SessionManager(store, findClaudeBinary()!, 5, c, resolve(__dirname, '../src/main/queen/hook-bridge.js'))
    new Orchestrator(c, mgr, tasks, undefined, undefined, new CodeIndex(store.raw))
    const { token, machine } = c.register('queen-y', 'queen', proj)
    machine!.askUser(); machine!.submitPlan({ summary: 's', tasks: [{ title: 'Use the mcp__queen__code_impact tool with path "src/core.ts" and reply in plain text exactly: IMPACT=<comma-separated affected file paths>. Do not read files.', scope: ['src/core.ts'] }] })
    machine!.approve(planHash(machine!.plan!)); tasks.createFromPlan('queen-y', machine!.plan!)
    const r: any = await fetch(`http://127.0.0.1:${c.port}/mcp/${token}`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'assign_task', arguments: { task_id: 'T1' } } }) }).then((x) => x.json())
    expect(r.result.isError).toBe(false)
    const w = tasks.get('queen-y', 'T1')!.assignee!
    await until(() => store.events(w).some((e) => e.type === 'result'), 180000)
    const used = JSON.stringify(store.events(w).map((e) => e.payload))
    expect(used).toContain('mcp__queen__code_impact')
    const texts = store.events(w).filter((e) => e.type === 'assistant').flatMap((e: any) => e.payload.message.content.filter((b: any) => b.type === 'text').map((b: any) => b.text as string))
    expect(texts.map((t) => /IMPACT=(.*)/.exec(t)?.[1]).find(Boolean)!.trim()).toBe('src/feature.ts')
    mgr.stopAll(); c.close()
  }, 300000)
})
