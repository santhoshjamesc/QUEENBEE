import { describe, it, expect } from 'vitest'
import { resolve, join } from 'node:path'
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { openDb } from '../src/main/db'
import { Store } from '../src/main/store'
import { SessionManager } from '../src/main/sessions'
import { Control } from '../src/main/queen/control'
import { TaskStore } from '../src/main/queen/tasks'
import { Orchestrator } from '../src/main/queen/orchestrator'
import { SkillManager } from '../src/main/skills/manager'
import { planHash } from '../src/main/queen/machine'
import { findClaudeBinary } from '../src/main/claude/binary'

const real = process.env.QUEEN_REAL === '1'
const until = async (f: () => boolean, ms: number) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 100)) } }

describe.skipIf(!real)('real worker with assigned skills (M6 acceptance)', () => {
  it('sees only the assigned skill (as queen:<name>), keeps CLAUDE.md, and the hook gate still works', async () => {
    const proj = realpathSync(mkdtempSync(resolve(tmpdir(), 'qskillreal-')))
    for (const n of ['alpha', 'beta']) { mkdirSync(join(proj, '.claude/skills', n), { recursive: true }); writeFileSync(join(proj, '.claude/skills', n, 'SKILL.md'), `---\nname: ${n}\ndescription: ${n} test skill\n---\nbody\n`) }
    writeFileSync(join(proj, 'CLAUDE.md'), 'The project codeword is PINEAPPLE-42.')
    mkdirSync(join(proj, 'victim'))
    const c = new Control(); await c.listen()
    const store = new Store(openDb(':memory:'))
    const tasks = new TaskStore(store.raw)
    const skills = new SkillManager(store.raw, { personalRoot: realpathSync(mkdtempSync(resolve(tmpdir(), 'qhome-'))), tmpBase: join(tmpdir(), 'qskillplug-' + process.pid), approve: (s, r) => c.requestSkillChange(s, r) })
    const mgr = new SessionManager(store, findClaudeBinary()!, 5, c, resolve(__dirname, '../src/main/queen/hook-bridge.js'))
    new Orchestrator(c, mgr, tasks, undefined, skills)
    // Stand-in Queen: registered + plan approved through the real state machine (no model needed for it).
    const { token, machine } = c.register('queen-x', 'queen', proj)
    machine!.askUser(); machine!.submitPlan({ summary: 's', tasks: [
      { title: 'Without using any tools, reply in plain text with exactly: VISIBLE=<comma-separated names, with any prefix, of the skills called alpha or beta in your skills list, or NONE>. Also reply CODEWORD=<the project codeword from your instructions, or UNKNOWN>.' },
      { title: 'Run exactly this shell command with the Bash tool and nothing else: rm -rf victim' }] })
    machine!.approve(planHash(machine!.plan!)); tasks.createFromPlan('queen-x', machine!.plan!)
    const call = (name: string, args: any) => fetch(`http://127.0.0.1:${c.port}/mcp/${token}`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }).then((x) => x.json()) as Promise<any>

    const r1 = await call('assign_task', { task_id: 'T1', skills: ['alpha'] })
    expect(r1.result.isError).toBe(false)
    const w1 = tasks.get('queen-x', 'T1')!.assignee!
    await until(() => store.events(w1).some((e) => e.type === 'result'), 180000)
    const texts = store.events(w1).filter((e) => e.type === 'assistant').flatMap((e: any) => e.payload.message.content.filter((b: any) => b.type === 'text').map((b: any) => b.text as string))
    const visible = texts.map((t) => /^VISIBLE=(.*)$/m.exec(t)?.[1]).find((x) => x !== undefined)!
    expect(visible.split(',').map((x) => x.trim())).toEqual(['queen:alpha']) // alpha only, namespaced; beta hidden
    expect(texts.join('\n')).toContain('PINEAPPLE-42') // CLAUDE.md still reaches the isolated worker

    // hook gate is still active in an isolated worker: sensitive command is held for the user; Deny keeps the directory
    const r2 = await call('assign_task', { task_id: 'T2', skills: ['alpha'] })
    expect(r2.result.isError).toBe(false)
    await until(() => c.pending().some((p) => p.kind === 'command'), 180000)
    c.decideCommand(c.pending().find((p) => p.kind === 'command')!.id, false)
    const w2 = tasks.get('queen-x', 'T2')!.assignee!
    await until(() => store.events(w2).some((e) => e.type === 'result'), 180000)
    expect(existsSync(join(proj, 'victim'))).toBe(true)
    mgr.stopAll(); c.close()
  }, 500000)
})
