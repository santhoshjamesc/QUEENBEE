import { describe, it, expect } from 'vitest'
import { deriveOffice, needsAnimation, FrameLoop, MEETING_WINDOW_MS, type OfficeInputs } from '../src/shared/office'
import type { SessionInfo } from '../src/shared/types'

const S = (id: string, status: SessionInfo['status'], extra: Partial<SessionInfo> = {}): SessionInfo => ({ id, name: id, cwd: '/p', status, startedAt: 0, ...extra })
const base = (o: Partial<OfficeInputs> = {}): OfficeInputs => ({ now: 1_000_000, queenId: 'q', sessions: [S('q', 'idle', { role: 'queen' })], tasks: [], pending: [], alerts: [], messages: [], last: {}, ...o })
const run = (o: Partial<OfficeInputs>) => deriveOffice(base(o))
const w = (id: string, status: SessionInfo['status'], taskId = 'T1', tStatus = 'working', extra: Partial<SessionInfo> = {}) => ({ s: S(id, status, { role: 'worker', ...extra }), t: { id: taskId, title: 'title ' + taskId, status: tStatus, assignee: id } })
const withW = (ws: ReturnType<typeof w>[], o: Partial<OfficeInputs> = {}) => run({ sessions: [S('q', 'idle', { role: 'queen' }), ...ws.map((x) => x.s)], tasks: ws.map((x) => x.t), ...o })
const state = (cs: ReturnType<typeof deriveOffice>, id: string) => cs.find((c) => c.sessionId === id)!

describe('office derivation: every state maps to a real input', () => {
  it('no sessions → no characters (nothing is invented)', () => {
    expect(deriveOffice(base({ sessions: [], queenId: undefined }))).toEqual([])
    expect(deriveOffice(base({ queenId: 'ghost' }))).toEqual([]) // unknown queen id: not drawn
  })
  it('a session with no events and idle status is idle — never working', () => {
    const c = run({})
    const people = c.filter((x) => x.role !== 'watchdog'); expect(people).toHaveLength(1); expect(c[0].state).toBe('idle'); expect(c[0].reason).toMatch(/idle/)
  })
  it('working vs thinking comes only from status + last event', () => {
    const t = (tool: boolean | undefined) => state(withW([w('a', 'working')], { last: tool === undefined ? {} : { a: { type: 'assistant', ts: 999_000, tool } } }), 'a')
    expect(t(true).state).toBe('working'); expect(t(false).state).toBe('thinking'); expect(t(undefined).state).toBe('thinking')
    expect(t(undefined).reason).toMatch(/no event recorded/)
    expect(state(withW([w('a', 'idle')], { last: { a: { type: 'assistant', ts: 1, tool: true } } }), 'a').state).toBe('idle') // stale tool event cannot make an idle session look busy
  })
  it('waiting (pending approval), blocked (paused / open alert), error, completed, stopped', () => {
    expect(state(withW([w('a', 'working')], { pending: [{ sessionId: 'a', kind: 'command' }] }), 'a')).toMatchObject({ state: 'waiting' })
    expect(state(withW([w('a', 'working', 'T1', 'working', { paused: true })]), 'a')).toMatchObject({ state: 'blocked', reason: expect.stringMatching(/paused/) })
    expect(state(withW([w('a', 'working')], { alerts: [{ sessionId: 'a', status: 'open', rule: 'out-of-scope-write', confidence: 'high' }] }), 'a').reason).toMatch(/out-of-scope-write \(high\)/)
    expect(state(withW([w('a', 'working')], { alerts: [{ sessionId: 'a', status: 'dismissed', rule: 'x', confidence: 'high' }] }), 'a').state).not.toBe('blocked')
    expect(state(withW([w('a', 'crashed')]), 'a').state).toBe('error')
    expect(state(withW([w('a', 'stopped', 'T1', 'verified')]), 'a')).toMatchObject({ state: 'completed', reason: expect.stringMatching(/verified/) })
    expect(state(withW([w('a', 'stopped', 'T1', 'failed')]), 'a')).toMatchObject({ state: 'idle', reason: expect.stringMatching(/stopped.*failed/) })
  })
  it('priority: error > completed > waiting > blocked > meeting > working', () => {
    const msg = [{ from: 'T1', to: 'T2', ts: 999_500, delivered: true }]
    const two = (a: Partial<SessionInfo>, ta = 'working') => [w('a', 'working', 'T1', ta, a), w('b', 'working', 'T2')]
    expect(state(withW(two({}), { messages: msg, last: { a: { type: 'assistant', ts: 1, tool: true } } }), 'a').state).toBe('meeting')
    expect(state(withW(two({ paused: true }), { messages: msg }), 'a').state).toBe('blocked')
    expect(state(withW(two({}), { messages: msg, pending: [{ sessionId: 'a', kind: 'skill' }] }), 'a').state).toBe('waiting')
    expect(state(withW(two({}, 'verified'), { messages: msg, pending: [{ sessionId: 'a', kind: 'skill' }] }), 'a').state).toBe('completed')
    expect(state(withW([w('a', 'crashed'), w('b', 'working', 'T2')], { messages: msg }), 'a').state).toBe('error')
  })
  it('meeting = a DELIVERED routed message between two real sessions inside the window; seats are separate from desks', () => {
    const ws = [w('a', 'working', 'T1'), w('b', 'working', 'T2'), w('c', 'working', 'T3')]
    const cs = withW(ws, { messages: [{ from: 'T1', to: 'T2', ts: 999_000, delivered: true }] })
    expect(state(cs, 'a')).toMatchObject({ state: 'meeting', seat: { kind: 'meeting', index: 0 } })
    expect(state(cs, 'b')).toMatchObject({ state: 'meeting', seat: { kind: 'meeting', index: 1 } })
    expect(state(cs, 'c').seat.kind).toBe('desk'); expect(state(cs, 'c').seat.index).toBe(2) // desk index stable
    const none = (m: any) => withW(ws, { messages: [m] }).every((c) => c.state !== 'meeting')
    expect(none({ from: 'T1', to: 'T2', ts: 999_000, delivered: false })).toBe(true)               // undelivered: no meeting
    expect(none({ from: 'T1', to: 'T2', ts: 1_000_000 - MEETING_WINDOW_MS - 1, delivered: true })).toBe(true) // too old
    expect(none({ from: 'app', to: 'queen', ts: 999_900, delivered: true })).toBe(true)            // app notices are not meetings
    expect(none({ from: 'T1', to: 'T9', ts: 999_900, delivered: true })).toBe(true)                // unknown endpoint
    expect(none({ from: 'T1', to: 'T1', ts: 999_900, delivered: true })).toBe(true)
    expect(withW(ws, { messages: [{ from: 'T1', to: 'queen', ts: 999_900, delivered: true }] }).filter((c) => c.state === 'meeting').map((c) => c.sessionId).sort()).toEqual(['a', 'q'])
  })
  it('only Queen + the run\'s task assignees are drawn; characters keep their task info', () => {
    const cs = run({ sessions: [S('q', 'idle', { role: 'queen' }), S('stray', 'working'), S('a', 'working', { role: 'worker' })], tasks: [{ id: 'T1', title: 'do x', status: 'working', assignee: 'a' }] })
    expect(cs.filter((c) => c.role !== 'watchdog').map((c) => c.sessionId)).toEqual(['q', 'a'])
    expect(cs[1]).toMatchObject({ taskId: 'T1', taskTitle: 'do x', taskStatus: 'working', role: 'worker' })
  })
  it('is deterministic: same inputs → identical output', () => {
    const i = base({ sessions: [S('q', 'idle'), S('a', 'working')], tasks: [{ id: 'T1', title: 't', status: 'working', assignee: 'a' }] })
    expect(deriveOffice(i)).toEqual(deriveOffice(i))
  })
})

describe('animation costs nothing when nothing is happening', () => {
  it('needsAnimation is false for idle/completed/error offices only', () => {
    expect(needsAnimation(run({}))).toBe(false)
    expect(needsAnimation(withW([w('a', 'stopped', 'T1', 'verified'), w('b', 'crashed', 'T2')]))).toBe(false)
    expect(needsAnimation(withW([w('a', 'working')]))).toBe(true)
  })
  it('FrameLoop: no frames scheduled when inactive or hidden; throttled; stops when work ends', () => {
    let now = 0, hidden = false, id = 0; const q = new Map<number, (t: number) => void>(); let scheduled = 0
    const env = { raf: (cb: (t: number) => void) => { scheduled++; q.set(++id, cb); return id }, cancel: (n: number) => void q.delete(n), hidden: () => hidden }
    let draws = 0
    const loop = new FrameLoop(() => draws++, env, 10)
    loop.setActive(false); expect(scheduled).toBe(0); expect(loop.running).toBe(false) // idle office: zero scheduled frames
    const step = (t: number) => { now = t; const cbs = [...q.values()]; q.clear(); cbs.forEach((cb) => cb(now)) }
    loop.setActive(true); expect(loop.running).toBe(true)
    step(100); step(120); step(140); step(210)   // 100ms apart needed at 10fps
    expect(draws).toBe(2)
    hidden = true; loop.sync(); expect(loop.running).toBe(false); expect(q.size).toBe(0) // hidden window: loop cancelled
    hidden = false; loop.sync(); expect(loop.running).toBe(true)
    loop.setActive(false); expect(loop.running).toBe(false); expect(q.size).toBe(0)
  })
})

import { layoutOffice, GRID_W } from '../src/shared/office'
describe('office layout', () => {
  it('every character is inside the canvas, nobody shares a spot, meeting seats are inside the meeting room', () => {
    const ws = Array.from({ length: 20 }, (_, i) => w('w' + i, 'working', 'T' + (i + 1)))
    const msgs = [{ from: 'T1', to: 'T2', ts: 999_900, delivered: true }, { from: 'T3', to: 'T4', ts: 999_900, delivered: true }, { from: 'T5', to: 'T6', ts: 999_900, delivered: true }, { from: 'T7', to: 'T8', ts: 999_900, delivered: true }]
    const cs = withW(ws, { messages: msgs })
    const L = layoutOffice(cs)
    const seen = new Set<string>()
    for (const c of cs) {
      const p = L.pos[c.sessionId]; expect(p).toBeDefined()
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(GRID_W); expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(L.height)
      const key = p.x + ',' + p.y; if (seen.has(key)) throw new Error('overlap at ' + key + ' ' + c.name); seen.add(key)
      if (c.seat.kind === 'meeting' && c.seat.index < 6) { expect(p.x).toBeGreaterThan(L.meetingRoom.x); expect(p.x).toBeLessThan(L.meetingRoom.x + L.meetingRoom.w) }
    }
    expect(cs.filter((c) => c.state === 'meeting').length).toBe(8) // 8 in a meeting; only 6 seats → 2 stay at their desks but are still labelled meeting
    expect(L.desks.length).toBe(20); expect(L.height).toBeGreaterThan(L.shared.y)
  })
})

import { openDb } from '../src/main/db'
import { Store } from '../src/main/store'
describe('store queries behind the office inspector', () => {
  it('lastActivityEvent flags tool calls; recentCommands pairs Bash commands with their results', () => {
    const st = new Store(openDb(':memory:'))
    st.upsertSession({ id: 's', name: 's', cwd: '/p', status: 'working', startedAt: 0 })
    expect(st.lastActivityEvent('s')).toBeUndefined()
    st.appendEvent('s', 'system', 'hook_started', {})
    st.appendEvent('s', 'assistant', undefined, { message: { content: [{ type: 'text', text: 'hi' }] } })
    expect(st.lastActivityEvent('s')).toMatchObject({ type: 'assistant', tool: false })
    st.appendEvent('s', 'assistant', undefined, { message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls -la' } }, { type: 'tool_use', id: 't2', name: 'Read', input: {} }] } })
    expect(st.lastActivityEvent('s')!.tool).toBe(true)
    st.appendEvent('s', 'user', undefined, { message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'total 0' }] } })
    expect(st.lastActivityEvent('s')).toMatchObject({ type: 'user', tool: false }) // result arrived → model is thinking again
    expect(st.recentCommands('s')).toEqual([{ ts: expect.any(Number), command: 'ls -la', result: 'total 0' }]) // Read is not a command
    expect(st.recentCommands('nobody')).toEqual([])
  })
})
