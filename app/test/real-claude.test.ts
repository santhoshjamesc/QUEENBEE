import { describe, it, expect } from 'vitest'
import { openDb } from '../src/main/db'
import { Store } from '../src/main/store'
import { SessionManager } from '../src/main/sessions'
import { findClaudeBinary } from '../src/main/claude/binary'

// Costs a tiny amount of the user's own subscription usage. Opt in: QUEEN_REAL=1 npm test
const bin = findClaudeBinary()
const until = async (f: () => boolean, ms = 90000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 100)) } }

describe.skipIf(!process.env.QUEEN_REAL || !bin)('real Claude Code (M1 acceptance)', () => {
  it('answers, stops, resumes the same conversation', async () => {
    const store = new Store(openDb(':memory:'))
    const m = new SessionManager(store, bin!)
    const s = m.start({ name: 'real', cwd: process.cwd(), model: 'haiku' })
    m.send(s.id, 'Remember the secret word: PINEAPPLE. Reply with only: ok')
    await until(() => store.events(s.id).some((e) => e.type === 'result'))
    m.stop(s.id)
    await until(() => store.getSession(s.id)!.status === 'stopped')
    const n = store.events(s.id).length
    m.start({ name: 'real', cwd: process.cwd(), model: 'haiku', resumeId: s.id })
    m.send(s.id, 'What was the secret word? Reply with only the word.')
    await until(() => store.events(s.id).filter((e) => e.type === 'result').length >= 2)
    const text = JSON.stringify(store.events(s.id, n))
    expect(text.toUpperCase()).toContain('PINEAPPLE')
    m.stopAll()
  }, 200000)
})
