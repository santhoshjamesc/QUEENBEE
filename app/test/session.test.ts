import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { openDb } from '../src/main/db'
import { Store } from '../src/main/store'
import { SessionManager } from '../src/main/sessions'
import { LineParser } from '../src/main/claude/stream'

const FAKE = resolve(__dirname, 'fixtures/fake-claude.js')
const until = async (f: () => boolean, ms = 8000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 25)) } }

describe('LineParser', () => {
  it('handles partial chunks and bad lines', () => {
    const got: any[] = [], bad: string[] = []
    const p = new LineParser((o) => got.push(o), (l) => bad.push(l))
    p.push('{"a":1}\n{"b"'); p.push(':2}\nnot json\n{"c":3}'); p.flush()
    expect(got).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]); expect(bad).toEqual(['not json'])
  })
})

describe('db', () => {
  it('migrates idempotently', () => { const d = openDb(':memory:'); expect(d.prepare('select max(v) v from schema_version').get()).toEqual({ v: 8 }) })
})

describe('SessionManager with fake claude', () => {
  const mk = (max = 5) => { const store = new Store(openDb(':memory:')); return { store, m: new SessionManager(store, FAKE, max) } }

  it('runs a session, stores events, stops, resumes same id', async () => {
    const { store, m } = mk()
    const s = m.start({ name: 'a', cwd: process.cwd() })
    await until(() => store.events(s.id).some((e) => e.subtype === 'init'))
    m.send(s.id, 'hi')
    await until(() => store.events(s.id).some((e) => e.type === 'result'))
    expect(JSON.stringify(store.events(s.id))).toContain('echo:hi')
    m.stop(s.id)
    await until(() => store.getSession(s.id)!.status === 'stopped')
    const r = m.start({ name: 'a', cwd: process.cwd(), resumeId: s.id })
    expect(r.id).toBe(s.id)
    await until(() => store.getSession(s.id)!.status === 'idle')
    m.stopAll()
  })

  it('detects a crash and runs sessions independently', async () => {
    const { store, m } = mk()
    const a = m.start({ name: 'a', cwd: process.cwd() }), b = m.start({ name: 'b', cwd: process.cwd() })
    await until(() => store.events(a.id).length > 0 && store.events(b.id).length > 0)
    m.send(a.id, 'CRASH')
    await until(() => store.getSession(a.id)!.status === 'crashed')
    m.send(b.id, 'still alive')
    await until(() => JSON.stringify(store.events(b.id)).includes('echo:still alive'))
    expect(store.getSession(b.id)!.status).toBe('idle')
    m.stopAll()
  })

  it('marks orphaned live sessions as crashed on recovery', () => {
    const { store } = mk()
    store.upsertSession({ id: 'x', name: 'x', cwd: '/', status: 'working', startedAt: 1 })
    expect(store.recoverOrphans()).toBe(1)
    expect(store.getSession('x')!.status).toBe('crashed')
  })

  it('enforces max concurrent sessions', async () => {
    const { m } = mk(1)
    m.start({ name: 'a', cwd: process.cwd() })
    expect(() => m.start({ name: 'b', cwd: process.cwd() })).toThrow(/max concurrent/)
    m.stopAll()
  })
})
