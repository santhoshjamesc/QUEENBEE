import { DESKS_PER_ROW, type Character, type OfficeLayout } from '../../shared/office'

/**
 * Renderer-only movement. Nobody wanders: a character stays at its seat unless a real event gives it somewhere to go,
 * and then it walks there (and back when the event is over). Events: a meeting (seat comes from deriveOffice), a worker
 * who is blocked / waiting / in error (the Queen walks over and they talk), an open alert (the watchdog runs to that desk).
 */
interface P { x: number; y: number }
interface Ideal extends P { speed: number; dwelling: boolean; talkTo?: string }
export interface Motion { x: number; y: number; moving: boolean; step: number; dir: number; talking: boolean; running: boolean }

const WALK = 30, QUEEN_WALK = 22, PATROL = 22, RUN = 54
const cur = new Map<string, { x: number; y: number; dist: number; t: number; dir: number }>()
let busy = false
/** true while anyone is still walking to a target, so the frame loop must keep going */
export const isMoving = () => busy

export function animate(L: OfficeLayout, cs: Character[], t: number): Map<string, Motion> {
  const rail = (row: number) => L.deskArea.y + 32 + row * 40
  const deskStand = (d: number, side: number): P => ({ x: L.desks[d].x + 16 + side * 11, y: rail(Math.floor(d / DESKS_PER_ROW)) })
  const queenStand: P = { x: L.queenRoom.x + 22, y: L.queenRoom.y + 36 }
  const deskers = cs.filter((c) => c.role === 'worker' && c.seat.kind === 'desk')

  // Everyone stays put unless a real event gives them somewhere to go; the chase below turns that into a walk.
  const needsHelp = (c: Character) => c.role === 'worker' && c.seat.kind === 'desk' && !c.fresh && ['blocked', 'waiting', 'error'].includes(c.state)
  const patient = deskers.find(needsHelp)
  const ideals = new Map<string, Ideal>()
  for (const c of cs) {
    const home = L.pos[c.sessionId]; if (!home) continue
    let ideal: Ideal = { x: home.x, y: home.y, speed: WALK, dwelling: true }
    if (c.role === 'queen' && patient) {
      const at = deskStand(patient.desk ?? 0, 1)
      ideal = { x: at.x, y: at.y, speed: QUEEN_WALK, dwelling: true, talkTo: patient.sessionId }
    } else if (c.role === 'queen') ideal.speed = QUEEN_WALK
    else if (c.role === 'watchdog') {
      const target = (c.watching ?? []).map((id) => cs.find((x) => x.sessionId === id)).find((x) => x && (x.role === 'queen' || x.seat.kind === 'desk'))
      if (c.state === 'working' && target) {
        const at = target.role === 'queen' ? queenStand : deskStand(target.desk ?? 0, -1)
        ideal = { x: at.x, y: at.y, speed: RUN, dwelling: true }
      } else ideal.speed = PATROL
    }
    ideals.set(c.sessionId, ideal)
  }

  // conversations: a visitor only talks when the host is actually at their spot; the host talks back
  const talking = new Set<string>()
  for (const c of cs) {
    const i = ideals.get(c.sessionId), h = i?.talkTo && ideals.get(i.talkTo), hp = i?.talkTo ? L.pos[i.talkTo] : undefined
    if (i?.dwelling && h && hp && Math.hypot(h.x - hp.x, h.y - hp.y) < 14) { talking.add(c.sessionId); talking.add(i.talkTo!) }
  }

  const out = new Map<string, Motion>()
  for (const c of cs) {
    const i = ideals.get(c.sessionId); if (!i) continue
    let s = cur.get(c.sessionId), moved = 0
    if (!s || t <= s.t || t - s.t > 500) s = { x: i.x, y: i.y, dist: s?.dist ?? 0, t, dir: s?.dir ?? 0 }
    else {
      const dx = i.x - s.x, dy = i.y - s.y, d = Math.hypot(dx, dy), max = i.speed * 1.7 * ((t - s.t) / 1000)
      if (d <= max) { moved = d; s.x = i.x; s.y = i.y } else { moved = max; s.x += (dx / d) * max; s.y += (dy / d) * max }
      if (Math.abs(dx) > 0.3) s.dir = Math.sign(dx)
      s.dist += moved; s.t = t
    }
    cur.set(c.sessionId, s)
    out.set(c.sessionId, { x: s.x, y: s.y, moving: moved > 0.05, step: Math.floor(s.dist / 3.2) % 2, dir: s.dir, talking: talking.has(c.sessionId) && moved <= 0.05, running: i.speed === RUN })
  }
  busy = [...out.values()].some((m) => m.moving)
  return out
}
