import { describe, it, expect } from 'vitest'
import { openDb } from '../src/main/db'
import { TaskStore } from '../src/main/queen/tasks'
import { Staff } from '../src/main/queen/staff'
import { Chat, threadOf } from '../src/main/queen/chat'
import { deriveOffice, layoutOffice, needsAnimation, WALK_IN_MS, type OfficeInputs } from '../src/shared/office'

const setup = () => {
  const db = openDb(':memory:'); const tasks = new TaskStore(db); const staff = new Staff(db, tasks)
  const sent: [string, string][] = []; const live = new Set<string>(['Q'])
  const chat = new Chat(db, tasks, staff, () => [], (id) => live.has(id), (id, t) => sent.push([id, t]))
  tasks.createFromPlan('Q', { summary: 's', tasks: [{ id: 'T1', title: 'one', checks: [], scope: [], deps: [] }, { id: 'T2', title: 'two', checks: [], scope: [], deps: [] }] } as any)
  return { db, tasks, staff, chat, sent, live }
}

describe('hiring', () => {
  it('is free and unlimited, with unique names', () => {
    const { staff } = setup()
    const hired = Array.from({ length: 12 }, () => staff.hire('Q', '', 'QA'))
    expect(hired).toHaveLength(12); expect(hired.every((h) => h.cost === 0)).toBe(true)
    expect(new Set(hired.map((h) => h.name)).size).toBe(12)
    expect(() => staff.hire('Q', hired[0].name.toUpperCase(), 'Tester')).toThrow(/already works/)
    expect(staff.hire('Q', 'Rev', 'Code reviewer').title).toBe('Code reviewer')
  })
  it('picks a free hire, respects busy ones, and errors on an unknown name', () => {
    const { staff, tasks } = setup()
    const a = staff.hire('Q', 'Ada', 'Developer'), b = staff.hire('Q', 'Bo', 'Tester')
    expect(staff.pickFree('Q')?.id).toBe(a.id)
    staff.bind(a, 'sess-a'); tasks.set('Q', 'T1', { status: 'working', assignee: 'sess-a' })
    expect(staff.pickFree('Q')?.id).toBe(b.id)
    expect(() => staff.pickFree('Q', 'Ada')).toThrow(/busy/)
    expect(() => staff.pickFree('Q', 'Zed')).toThrow(/no hire called/)
    tasks.set('Q', 'T1', { status: 'verified' }); expect(staff.pickFree('Q', 'ada')?.id).toBe(a.id) // done → free again
  })
})

describe('chat room', () => {
  it('a dead session does not keep its hire busy', () => {
    const { staff, tasks, live } = setup()
    const a = staff.hire('Q', 'Ada', 'Developer'); staff.bind(a, 'sess-a'); tasks.set('Q', 'T1', { status: 'working', assignee: 'sess-a' })
    staff.alive = (id) => live.has(id)
    expect(staff.busyIds().has(a.id)).toBe(false)           // process gone, task never finished
    expect(staff.pickFree('Q', 'Ada')?.id).toBe(a.id)
    live.add('sess-a'); expect(staff.busyIds().has(a.id)).toBe(true)
    live.delete('sess-a'); expect(() => staff.remove(a.id)).not.toThrow()
  })
  it('merges routed messages and boss chat; maps tasks to hires; threads are pairs', () => {
    const { staff, tasks, chat, live } = setup()
    const a = staff.hire('Q', 'Ada', 'Developer'); staff.bind(a, 'sess-a'); tasks.set('Q', 'T1', { status: 'working', assignee: 'sess-a' }); live.add('sess-a')
    tasks.logMessage('Q', 'queen', 'T1', 'please start', true)
    tasks.logMessage('Q', 'T1', 'queen', 'on it', true)
    tasks.logMessage('Q', 'app', 'queen', 'Task T1: VERIFIED', true)
    const v = chat.list('Q')
    const pair = threadOf('queen', a.id)
    expect(v.messages.filter((m) => m.thread === pair).map((m) => m.body)).toEqual(['please start', 'on it'])
    expect(v.messages.find((m) => m.body.includes('VERIFIED'))?.from).toBe('system')
    expect(v.people.find((p) => p.key === a.id)).toMatchObject({ label: 'Ada (Developer)', live: true })
    expect(v.people.some((p) => p.kind === 'watchdog')).toBe(true)
  })
  it('boss can post to Queen, to a worker, and into someone else\'s thread; replies land in that thread', () => {
    const { staff, tasks, chat, sent, live } = setup()
    const a = staff.hire('Q', 'Ada', 'Developer'); staff.bind(a, 'sess-a'); tasks.set('Q', 'T1', { status: 'working', assignee: 'sess-a' }); live.add('sess-a')
    chat.post('Q', 'queen', 'hello queen')
    expect(sent.at(-1)).toEqual(['Q', '[message from the boss] hello queen'])
    chat.onAssistantText('Q', 'Hi boss!')
    chat.post('Q', a.id, 'change of plan', threadOf('queen', a.id))       // interfere in the Queen↔Ada conversation
    expect(sent.at(-1)![0]).toBe('sess-a'); expect(sent.at(-1)![1]).toMatch(/in your conversation with Queen/)
    chat.onAssistantText('sess-a', 'ok, switching')
    const v = chat.list('Q')
    expect(v.messages.filter((m) => m.thread === 'boss:queen').map((m) => `${m.from}:${m.body}`)).toEqual(['boss:hello queen', 'queen:Hi boss!'])
    expect(v.messages.filter((m) => m.thread === threadOf('queen', a.id)).map((m) => `${m.from}→${m.to}:${m.body}`)).toEqual(['boss→H1:change of plan', 'H1→boss:ok, switching'])
  })
  it('refuses empty text, unknown/not-running targets, and the watchdog/boss as targets', () => {
    const { staff, chat } = setup()
    staff.hire('Q', 'Ada', 'Developer')
    expect(() => chat.post('Q', 'queen', '  ')).toThrow()
    expect(() => chat.post('Q', 'H1', 'hi')).toThrow(/not running/)    // hired but no session yet
    expect(() => chat.post('Q', 'nobody', 'hi')).toThrow()
    expect(() => chat.post('Q', 'watchdog', 'hi')).toThrow()
  })
})

describe('office: hires and watchdogs', () => {
  const S = (id: string, status: any, role: any, extra = {}) => ({ id, name: id, cwd: '/p', status, startedAt: 0, role, ...extra })
  const base = (o: Partial<OfficeInputs> = {}): OfficeInputs => ({ now: 1_000_000, queenId: 'q', sessions: [S('q', 'idle', 'queen')], tasks: [], pending: [], alerts: [], messages: [], last: {}, ...o })
  it('a hire without a session is drawn idle at a desk, with a walk-in only for a few seconds; desks follow hiring order', () => {
    const hires = [{ id: 'H2', name: 'Bo', title: 'Tester', look: 2, ts: 900_000 }, { id: 'H1', name: 'Ada', title: 'Developer', look: 1, ts: 999_000 - 10_000 }]
    const cs = deriveOffice(base({ hires }))
    const ada = cs.find((c) => c.name === 'Ada')!, bo = cs.find((c) => c.name === 'Bo')!
    expect(ada).toMatchObject({ state: 'idle', role: 'worker', title: 'Developer', fresh: false }); expect(ada.reason).toMatch(/waiting for Queen/)
    expect(bo.desk).toBe(0); expect(ada.desk).toBe(1) // by hire time
    const fresh = deriveOffice(base({ hires: [{ id: 'H1', name: 'New', title: 'Writer', look: 3, ts: 1_000_000 - 100 }] }))
    expect(fresh.find((c) => c.name === 'New')!.fresh).toBe(true); expect(needsAnimation(fresh)).toBe(true)
    expect(needsAnimation(deriveOffice(base({ hires: [{ id: 'H1', name: 'Old', title: 'Writer', look: 3, ts: 1_000_000 - WALK_IN_MS - 1 }] })))).toBe(false)
  })
  it('a hire bound to a working session shows that session\'s real state and keeps its name', () => {
    const cs = deriveOffice(base({ hires: [{ id: 'H1', name: 'Ada', title: 'Developer', look: 1, ts: 0, sessionId: 'w' }], sessions: [S('q', 'idle', 'queen'), S('w', 'working', 'worker')], tasks: [{ id: 'T1', title: 't', status: 'working', assignee: 'w' }], last: { w: { type: 'assistant', ts: 999_000, tool: true } } }))
    expect(cs.filter((c) => c.sessionId === 'w')).toHaveLength(1)
    expect(cs.find((c) => c.sessionId === 'w')).toMatchObject({ name: 'Ada', state: 'working', title: 'Developer', taskId: 'T1' })
  })
  it('two watchdogs are always present; they work only while a real alert is open', () => {
    const calm = deriveOffice(base()).filter((c) => c.role === 'watchdog')
    expect(calm).toHaveLength(2); expect(calm.every((c) => c.state === 'idle')).toBe(true)
    const hot = deriveOffice(base({ alerts: [{ status: 'open', rule: 'out-of-scope', confidence: 'high' }] })).filter((c) => c.role === 'watchdog')
    expect(hot.filter((c) => c.state === 'working')).toHaveLength(1); expect(hot.find((c) => c.state === 'working')!.reason).toMatch(/out-of-scope/)
    expect(deriveOffice(base({ queenId: undefined, sessions: [] }))).toEqual([])
  })
  it('layout: every character has a position inside the canvas, nobody overlaps', () => {
    const hires = Array.from({ length: 12 }, (_, n) => ({ id: 'H' + n, name: 'P' + n, title: 'Developer', look: n, ts: n }))
    const cs = deriveOffice(base({ hires })); const L = layoutOffice(cs)
    const seen = new Set<string>()
    for (const c of cs) { const p = L.pos[c.sessionId]; expect(p).toBeTruthy(); expect(p.x).toBeGreaterThan(0); expect(p.x).toBeLessThan(L.width); expect(p.y).toBeLessThan(L.height); const k = `${p.x},${p.y}`; expect(seen.has(k)).toBe(false); seen.add(k) }
  })
})
