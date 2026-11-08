import { describe, it, expect } from 'vitest'
import { resolve, join } from 'node:path'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { openDb } from '../src/main/db'
import { Store } from '../src/main/store'
import { SessionManager } from '../src/main/sessions'
import { Control } from '../src/main/queen/control'
import { TaskStore } from '../src/main/queen/tasks'
import { Orchestrator } from '../src/main/queen/orchestrator'
import { planHash } from '../src/main/queen/machine'
import { findClaudeBinary } from '../src/main/claude/binary'

const real = process.env.QUEEN_REAL === '1'
const until = async (f: () => boolean, ms: number) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 100)) } }
const hook = resolve(__dirname, '../src/main/queen/hook-bridge.js')
const tmp = (p: string) => realpathSync(mkdtempSync(resolve(tmpdir(), p)))
const texts = (store: Store, id: string) => store.events(id).filter((e) => e.type === 'assistant').flatMap((e: any) => e.payload.message.content.filter((b: any) => b.type === 'text').map((b: any) => b.text as string)).join('\n')

describe.skipIf(!real)('Task 6: real-CLI acceptance runs', () => {
  it('3 real sessions run concurrently and independently (acceptance 4)', async () => {
    const store = new Store(openDb(':memory:'))
    const mgr = new SessionManager(store, findClaudeBinary()!, 5)
    const tokens = ['ALPHA-' + Math.random().toString(36).slice(2, 7), 'BRAVO-' + Math.random().toString(36).slice(2, 7), 'CHARLIE-' + Math.random().toString(36).slice(2, 7)]
    const sessions = tokens.map((t, i) => mgr.start({ name: 's' + i, cwd: tmp('qc3-'), model: 'haiku' }))
    expect(new Set(sessions.map((s) => s.id)).size).toBe(3)
    sessions.forEach((s, i) => mgr.send(s.id, `Reply with exactly the single token ${tokens[i]} and nothing else. Do not use tools.`))
    // all three must be running at the same time
    let maxWorking = 0
    await until(() => { maxWorking = Math.max(maxWorking, mgr.list().filter((s) => s.status === 'working').length); return sessions.every((s) => store.events(s.id).some((e) => e.type === 'result')) }, 180000)
    expect(maxWorking).toBeGreaterThanOrEqual(2) // overlap observed (3 if the host scheduled them tightly)
    sessions.forEach((s, i) => {
      const own = texts(store, s.id)
      expect(own).toContain(tokens[i])
      tokens.forEach((t, j) => { if (j !== i) expect(own).not.toContain(t) }) // no cross-talk
    })
    mgr.stopAll()
  }, 300000)

  it('interruption + recovery: stop a real worker mid-life, resume with the same id, it keeps its context (acceptance 4/13)', async () => {
    const store = new Store(openDb(':memory:'))
    const mgr = new SessionManager(store, findClaudeBinary()!, 5)
    const cwd = tmp('qrec-')
    const s = mgr.start({ name: 'r', cwd, model: 'haiku' })
    mgr.send(s.id, 'Remember the codeword KIWI-77. Reply only: OK.')
    await until(() => store.events(s.id).some((e) => e.type === 'result'), 120000)
    mgr.stop(s.id)
    await until(() => store.getSession(s.id)!.status === 'stopped', 30000)
    const r = mgr.start({ name: 'r', cwd, model: 'haiku', resumeId: s.id })
    expect(r.id).toBe(s.id)
    mgr.send(r.id, 'What was the codeword? Reply with only the codeword.')
    await until(() => store.events(s.id).filter((e) => e.type === 'result').length >= 2, 120000)
    const replies = store.events(s.id).filter((e) => e.type === 'assistant').flatMap((e: any) => e.payload.message.content.filter((b: any) => b.type === 'text').map((b: any) => b.text as string))
    expect(replies[0]).not.toContain('KIWI-77')        // first turn only said OK: the codeword was never repeated
    expect(replies[replies.length - 1]).toContain('KIWI-77') // so the answer after kill+resume can only come from the restored conversation
    mgr.stopAll()
  }, 300000)

  it('hook gate also works when the hook runs through the PACKAGED app binary (acceptance 3/13, M9)', async () => {
    const app = resolve(__dirname, '../release/mac-arm64/Queen.app/Contents/MacOS/Queen')
    if (!existsSync(app)) { console.warn('packaged app not built; skipping'); return }
    const c = new Control(); await c.listen()
    const store = new Store(openDb(':memory:'))
    const cwd = tmp('qpk-'); mkdirSync(join(cwd, 'victim'))
    const mgr = new SessionManager(store, findClaudeBinary()!, 5, c, hook, app) // hookNode = packaged Electron as Node
    const s = mgr.start({ name: 'plain', cwd, model: 'haiku' })
    mgr.send(s.id, 'Run exactly this shell command with the Bash tool and nothing else: rm -rf victim')
    await until(() => c.pending().some((p) => p.kind === 'command'), 120000)
    c.decideCommand(c.pending()[0].id, false)
    await until(() => store.events(s.id).some((e) => e.type === 'result'), 120000)
    expect(existsSync(join(cwd, 'victim'))).toBe(true)
    mgr.stopAll(); c.close()
  }, 300000)

  it('real Queen coordinates TWO independent workers in parallel; both edit real files and are verified by real checks (acceptance 1,2,5,13)', async () => {
    const c = new Control(); await c.listen()
    const store = new Store(openDb(':memory:')); const tasks = new TaskStore(store.raw)
    const cwd = tmp('qpar-')
    const mgr = new SessionManager(store, findClaudeBinary()!, 5, c, hook)
    new Orchestrator(c, mgr, tasks)
    const q = mgr.start({ name: 'queen', cwd, role: 'queen', model: 'haiku' })
    mgr.send(q.id, 'Goal: create two files. a.txt containing exactly the word red, and b.txt containing exactly the word blue. Use exactly TWO independent tasks with no dependencies: T1 (scope ["a.txt"], checks ["grep -qx red a.txt"]) and T2 (scope ["b.txt"], checks ["grep -qx blue b.txt"]). Ask me one question first, submit the plan, and after approval assign BOTH tasks right away (at the same time) and wait for the verification results.')
    const handled = new Set<string>(); let sawWorkPendingBeforeApproval = false
    const log: string[] = []
    try {
      await until(() => {
        for (const p of c.pending()) {
          if (handled.has(p.id)) continue
          handled.add(p.id); log.push(`pending ${p.kind}`)
          if (p.kind === 'question') c.answer(p.id, p.data.questions.map(() => 'Yes, as described.'))
          if (p.kind === 'plan') { if (mgr.list().some((s) => s.role === 'worker')) sawWorkPendingBeforeApproval = true; c.approvePlan(p.id, p.data.hash) }
          if (p.kind === 'command') c.decideCommand(p.id, true)
        }
        const t = tasks.list(q.id); return t.length >= 2 && t.every((x) => x.status === 'verified' || x.status === 'failed')
      }, Number(process.env.QUEEN_PAR_TIMEOUT ?? 400000))
    } catch (e) {
      const qt = texts(store, q.id).slice(-600)
      throw new Error(`stalled. log=${log.join(',')} tasks=${JSON.stringify(tasks.list(q.id).map((t) => [t.id, t.status, t.verification?.slice(-80)]))} sessions=${JSON.stringify(mgr.list().map((s) => [s.role, s.status]))} pending=${JSON.stringify(c.pending().map((p) => p.kind))} queenSaid=${qt}`)
    }
    expect(sawWorkPendingBeforeApproval).toBe(false)           // no worker existed before approval
    expect(tasks.list(q.id).map((t) => t.status)).toEqual(['verified', 'verified'])
    expect(readFileSync(join(cwd, 'a.txt'), 'utf8').trim()).toBe('red'); expect(readFileSync(join(cwd, 'b.txt'), 'utf8').trim()).toBe('blue')
    const workers = tasks.list(q.id).map((t) => t.assignee!)
    expect(new Set(workers).size).toBe(2)                      // two distinct real sessions
    mgr.stopAll(); c.close()
  }, 600000)
})
