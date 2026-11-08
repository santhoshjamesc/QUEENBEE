import type { Character, OfficeLayout, OfficeState } from '../../shared/office'

/** Canvas renderer. Draws ONLY what deriveOffice/layoutOffice say; `frame` just alternates a pose of states that are really active. */
const GLYPH: Record<string, string[]> = {
  q: ['.###.', '#...#', '..##.', '.....', '..#..'],        // ?
  bang: ['..#..', '..#..', '..#..', '.....', '..#..'],     // !
  check: ['.....', '....#', '#..#.', '.##..', '..#..'],
  x: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  z: ['####.', '...#.', '..#..', '.#...', '####.'],
  dots: ['.....', '.....', '#.#.#', '.....', '.....']
}
export const STATE_COLOR: Record<OfficeState, string> = { working: '#36b879', thinking: '#69a7e8', waiting: '#e8b44b', idle: '#737e8b', blocked: '#e45b5b', meeting: '#f2c94c', completed: '#36b879', error: '#e45b5b' }
// worker accent colours: muted, so bee yellow stays the Queen's identity
const SHIRTS = ['#69a7e8', '#5fb89a', '#c987b5', '#9c8fe0', '#d99b27', '#6fb7c4', '#b4a36a', '#8798e0']
const SKINS = ['#f1c9a5', '#e0ac82', '#c68a62', '#8d5a3b', '#f6d7b8']
const HAIRS = ['#2b2118', '#6b3f1d', '#d9a441', '#a33b2a', '#1b1b22', '#8a8f98']
export const SCALE = 4 // canvas backing-store scale: characters are smooth vector cartoons, rooms stay crisp pixel blocks
const hash = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h }

const px = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h) }
function glyph(g: CanvasRenderingContext2D, name: string, x: number, y: number, c: string) {
  GLYPH[name].forEach((row, j) => [...row].forEach((ch, i) => { if (ch === '#') px(g, x + i, y + j, 1, 1, c) }))
}


const OUT = '#1b1626'
const LW = 0.75
const TAU = Math.PI * 2
function ell(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string, stroke: string | null = OUT, rot = 0) {
  g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, TAU); g.fillStyle = fill; g.fill()
  if (stroke) { g.lineWidth = LW; g.strokeStyle = stroke; g.stroke() }
}
function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string, stroke: string | null = OUT) {
  g.beginPath(); g.roundRect(x, y, w, h, r); g.fillStyle = fill; g.fill()
  if (stroke) { g.lineWidth = LW; g.strokeStyle = stroke; g.stroke() }
}
function poly(g: CanvasRenderingContext2D, pts: [number, number][], fill: string, stroke: string | null = OUT) {
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fillStyle = fill; g.fill()
  if (stroke) { g.lineWidth = LW; g.lineJoin = 'round'; g.strokeStyle = stroke; g.stroke() }
}
function arc(g: CanvasRenderingContext2D, x: number, y: number, r: number, a0: number, a1: number, c = OUT, w = 0.6) {
  g.beginPath(); g.arc(x, y, r, a0 * Math.PI, a1 * Math.PI); g.lineWidth = w; g.lineCap = 'round'; g.strokeStyle = c; g.stroke()
}
function sparkle(g: CanvasRenderingContext2D, x: number, y: number, r: number, c: string) {
  poly(g, [[x, y - r], [x + r * 0.3, y - r * 0.3], [x + r, y], [x + r * 0.3, y + r * 0.3], [x, y + r], [x - r * 0.3, y + r * 0.3], [x - r, y], [x - r * 0.3, y - r * 0.3]], c, null)
}
const shade = (hex: string, k: number) => { // darken (k<0) / lighten (k>0) #rrggbb
  const n = parseInt(hex.slice(1, 7), 16), f = (v: number) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)))
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('')
}

export function drawOffice(g: CanvasRenderingContext2D, L: OfficeLayout, cs: Character[], t: number): void {
  const frame = Math.floor(t / 300) % 2
  g.setTransform(SCALE, 0, 0, SCALE, 0, 0)
  g.clearRect(0, 0, L.width, L.height)
  px(g, 0, 0, L.width, L.height, '#14181e')
  const deskOn = new Set(cs.filter((c) => c.role === 'worker' && (c.state === 'working' || c.state === 'thinking')).map((c) => c.desk ?? 0))
  const room = (r: { x: number; y: number; w: number; h: number }, fill: string, edge: string) => { px(g, r.x, r.y, r.w, r.h, edge); px(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, fill) }
  room(L.queenRoom, '#242119', '#d99b27')
  room(L.meetingRoom, '#1c2129', '#3c4654')
  room(L.table, '#2b3340', '#4a5666')
  room(L.shared, '#192027', '#303844')
  L.desks.forEach((d, n) => { room(d, '#1c2129', '#303844'); px(g, d.x + 8, d.y + 18, 16, 8, '#2b3340'); const on = deskOn.has(n); px(g, d.x + 11, d.y + 7, 10, 7, '#0e1217'); px(g, d.x + 12, d.y + 8, 8, 5, on ? (frame ? '#2f7d5c' : '#36b879') : '#1f2a36') })
  px(g, L.queenRoom.x + 30, L.queenRoom.y + 46, 36, 10, '#6b5420') // Queen's desk
  px(g, L.queenRoom.x + 30, L.queenRoom.y + 46, 36, 2, '#8a6d2b')

  for (const c of cs) {
    const p = L.pos[c.sessionId]; if (!p) continue
    // Walk-in animation for a fresh hire: slides in from the door (left edge) to the desk. Purely a reaction to the real hire time.
    let ox = 0
    if (c.fresh && c.hiredAt !== undefined) { const k = Math.min(1, Math.max(0, (t - firstSeen(c.sessionId, t)) / 2800)); ox = -(1 - k) * (p.x + 6) }
    const cx = p.x + Math.round(ox), cy = p.y
    const walking = ox !== 0
    const step = walking ? Math.floor(t / 150) % 2 : 0
    g.save()
    if (c.role === 'watchdog') { drawDog(g, cx, cy, c, frame, t); drawStatus(g, c, cx, cy - 17, frame); g.restore(); continue }
    if (c.role === 'queen') drawQueen(g, cx, cy, c, frame, t)
    else drawWorker(g, cx, cy, c, frame, step, walking, t)
    g.restore()
    drawStatus(g, c, cx, cy - (c.role === 'queen' ? 25 : 17), frame)
    if (c.fresh) { const k = Math.floor(t / 200) % 3; sparkle(g, cx - 9, cy - 8 + k, 1.6, '#ffe27a'); sparkle(g, cx + 9, cy - 4 - k, 1.2, '#fff'); sparkle(g, cx + 7, cy - 14 + k, 1.4, '#ffe27a') }
    // task status bar under desk characters
    if (c.taskStatus && c.role === 'worker' && c.seat.kind === 'desk') px(g, p.x - 10, p.y + 12, 20, 2, c.taskStatus === 'verified' ? '#36b879' : c.taskStatus === 'failed' ? '#e45b5b' : c.taskStatus === 'working' ? '#69a7e8' : c.taskStatus === 'awaiting_verification' ? '#e8b44b' : '#737e8b')
  }
}

const seen = new Map<string, number>()
function firstSeen(id: string, t: number): number { if (!seen.has(id)) seen.set(id, t); return seen.get(id)! }

/** Eyes shared by people. Closed when idle (sleepy) or blinking; X when errored; pupils drift with the state. */
function eyes(g: CanvasRenderingContext2D, cx: number, ey: number, c: Character, t: number, spread = 2.2, size = 1) {
  const blink = Math.floor(t / 180) % 19 === 0
  for (const s of [-1, 1]) {
    const x = cx + s * spread
    if (c.state === 'error') { g.lineWidth = 0.6; g.lineCap = 'round'; g.strokeStyle = OUT; g.beginPath(); g.moveTo(x - 0.9, ey - 0.9); g.lineTo(x + 0.9, ey + 0.9); g.moveTo(x + 0.9, ey - 0.9); g.lineTo(x - 0.9, ey + 0.9); g.stroke(); continue }
    if (c.state === 'idle' || blink) { arc(g, x, ey - 0.3, 1.1 * size, 0.1, 0.9); continue }
    ell(g, x, ey, 1.5 * size, 1.8 * size, '#fff', OUT)
    const dx = c.state === 'thinking' ? 0.5 : c.state === 'waiting' ? -0.5 * s : 0, dy = c.state === 'thinking' ? -0.6 : 0.2
    ell(g, x + dx, ey + dy, 0.85 * size, 0.95 * size, OUT, null)
    ell(g, x + dx + 0.3, ey + dy - 0.35, 0.3 * size, 0.3 * size, '#fff', null)
  }
}
function mouth(g: CanvasRenderingContext2D, cx: number, my: number, c: Character, frame: number) {
  switch (c.state) {
    case 'completed': ell(g, cx, my - 0.2, 1.7, 1.3, '#7a1d2b', OUT); poly(g, [[cx - 1.5, my - 0.6], [cx + 1.5, my - 0.6], [cx + 1.3, my + 0.2], [cx - 1.3, my + 0.2]], '#fff', null); break
    case 'meeting': frame ? ell(g, cx, my, 1.1, 1.0, '#7a1d2b', OUT) : arc(g, cx, my - 0.8, 1.6, 0.15, 0.85); break
    case 'blocked': arc(g, cx, my + 1.2, 1.5, 1.15, 1.85); break
    case 'error': g.beginPath(); g.moveTo(cx - 1.6, my + 0.6); g.quadraticCurveTo(cx - 0.8, my - 0.4, cx, my + 0.6); g.quadraticCurveTo(cx + 0.8, my + 1.6, cx + 1.6, my + 0.6); g.lineWidth = 0.55; g.strokeStyle = OUT; g.stroke(); break
    case 'waiting': case 'thinking': ell(g, cx + (c.state === 'thinking' ? 0.8 : 0), my + 0.2, 0.7, 0.8, '#7a1d2b', OUT); break
    case 'working': arc(g, cx, my - 0.6, 1.3, 0.2, 0.8); break
    default: arc(g, cx, my - 0.6, 1.2, 0.2, 0.8)
  }
}

type Hair = (g: CanvasRenderingContext2D, cx: number, hy: number, col: string) => void
const HAIR_STYLES: Hair[] = [
  (g, cx, hy, col) => { g.beginPath(); g.arc(cx, hy - 0.4, 5.4, Math.PI * 1.02, Math.PI * 1.98); g.quadraticCurveTo(cx + 2, hy - 3.4, cx - 5.2, hy - 1.4); g.closePath(); g.fillStyle = col; g.fill(); g.lineWidth = LW; g.strokeStyle = OUT; g.stroke() }, // neat cap
  (g, cx, hy, col) => { poly(g, [[cx - 5.2, hy - 1.6], [cx - 4.6, hy - 6], [cx - 2.6, hy - 3.6], [cx - 1, hy - 7.6], [cx + 0.8, hy - 4], [cx + 3, hy - 7], [cx + 3.6, hy - 3.4], [cx + 5.4, hy - 4.6], [cx + 5.2, hy - 1.4], [cx, hy - 3.2]], col) }, // spiky
  (g, cx, hy, col) => { ell(g, cx, hy - 6.6, 2.2, 2.2, col); HAIR_STYLES[0](g, cx, hy, col) }, // top bun
  (g, cx, hy, col) => { rr(g, cx - 6, hy - 3, 2.6, 8.5, 1.2, col); rr(g, cx + 3.4, hy - 3, 2.6, 8.5, 1.2, col); HAIR_STYLES[0](g, cx, hy, col) }, // long
  (g, cx, hy, col) => { for (const [dx, dy] of [[-3.6, -2.4], [-1.2, -4.6], [1.6, -4.4], [3.8, -2.2], [0, -2.6]]) ell(g, cx + dx, hy + dy, 2.1, 2.1, col) }, // curly
  (g, cx, hy, col) => { g.beginPath(); g.moveTo(cx - 5.4, hy + 0.4); g.quadraticCurveTo(cx - 6, hy - 6, cx + 1, hy - 5.8); g.quadraticCurveTo(cx + 6.4, hy - 5, cx + 5.4, hy + 0.4); g.quadraticCurveTo(cx + 3, hy - 3.2, cx - 1.4, hy - 2.4); g.quadraticCurveTo(cx - 3.6, hy - 2, cx - 5.4, hy + 0.4); g.fillStyle = col; g.fill(); g.lineWidth = LW; g.strokeStyle = OUT; g.stroke() }, // side sweep
]

/** Title accessory: what makes each job instantly recognisable. Drawn on top of the head. */
function accessory(g: CanvasRenderingContext2D, title: string | undefined, cx: number, hy: number, frame: number) {
  switch (title) {
    case 'Developer': // headphones
      g.beginPath(); g.arc(cx, hy, 6, Math.PI * 1.05, Math.PI * 1.95); g.lineWidth = 1; g.strokeStyle = OUT; g.stroke(); g.lineWidth = 0.5; g.strokeStyle = '#7d8ea3'; g.stroke()
      rr(g, cx - 7, hy - 1.6, 2.4, 4.4, 1.1, '#e45b5b'); rr(g, cx + 4.6, hy - 1.6, 2.4, 4.4, 1.1, '#e45b5b'); break
    case 'Designer': // beret
      ell(g, cx + 0.6, hy - 4.6, 5.6, 2.6, '#d94f7a', OUT, -0.15); ell(g, cx + 1.8, hy - 7.3, 0.8, 0.8, '#d94f7a'); break
    case 'Tester': // goggles on forehead
      g.beginPath(); g.moveTo(cx - 5.6, hy - 2.2); g.lineTo(cx + 5.6, hy - 2.2); g.lineWidth = 1.1; g.strokeStyle = OUT; g.stroke()
      ell(g, cx - 2.4, hy - 2.6, 2, 1.7, '#7fe3f0'); ell(g, cx + 2.4, hy - 2.6, 2, 1.7, '#7fe3f0'); ell(g, cx - 3, hy - 3.1, 0.6, 0.4, '#fff', null); ell(g, cx + 1.8, hy - 3.1, 0.6, 0.4, '#fff', null); break
    case 'Writer': // pencil behind the ear + little notebook cap
      g.save(); g.translate(cx + 5, hy - 1); g.rotate(0.7); rr(g, -0.6, -4.2, 1.4, 6, 0.4, '#f2c94c'); poly(g, [[-0.6, 1.8], [0.8, 1.8], [0.1, 3]], '#f5d7b0'); rr(g, -0.6, -4.8, 1.4, 1, 0.3, '#e45b5b'); g.restore(); break
    case 'Researcher': // round glasses
      for (const s of [-1, 1]) { g.beginPath(); g.arc(cx + s * 2.3, hy + 0.1, 2.1, 0, TAU); g.lineWidth = 0.55; g.strokeStyle = '#2b2f3a'; g.stroke(); ell(g, cx + s * 2.3 - 0.7, hy - 0.8, 0.5, 0.35, '#fff', null) }
      g.beginPath(); g.moveTo(cx - 0.3, hy); g.lineTo(cx + 0.3, hy); g.stroke(); break
    case 'Head of workers': // gold hard hat + star
      g.beginPath(); g.arc(cx, hy - 1, 5.6, Math.PI, TAU); g.closePath(); g.fillStyle = '#f2c94c'; g.fill(); g.lineWidth = LW; g.strokeStyle = OUT; g.stroke()
      rr(g, cx - 6.6, hy - 1.4, 13.2, 1.6, 0.8, '#d99b27'); rr(g, cx - 0.9, hy - 6.8, 1.8, 2.6, 0.6, '#d99b27'); sparkle(g, cx, hy - 3, 1.5, frame ? '#fff' : '#fff7c4'); break
  }
}

function drawWorker(g: CanvasRenderingContext2D, cx: number, cy: number, c: Character, frame: number, step: number, walking: boolean, t: number) {
  const seed = c.look ?? hash(c.sessionId)
  const shirt = SHIRTS[seed % SHIRTS.length]
  const skin = SKINS[(seed >> 3) % SKINS.length], hair = HAIRS[(seed >> 5) % HAIRS.length]
  const style = HAIR_STYLES[(seed >> 7) % HAIR_STYLES.length]
  const idle = c.state === 'idle' || c.state === 'completed'
  const bob = (c.state === 'working' || c.state === 'meeting' || walking) && (frame || step) ? 0.8 : 0
  const body = c.state === 'error' ? '#8a2a2a' : idle ? shade(shirt, -0.18) : shirt
  const hy = cy - 4.2 + bob
  ell(g, cx, cy + 8, 6.5, 1.5, '#00000044', null)                                                    // shadow
  rr(g, cx - 3.6 + (step ? 0.8 : 0), cy + 5, 2.6, 3.4, 1.2, '#2b2f3a'); rr(g, cx + 1 - (step ? 0.8 : 0), cy + 5, 2.6, 3.4, 1.2, '#2b2f3a') // legs
  rr(g, cx - 5, cy - 0.8 + bob, 10, 7.4, 3, body)                                                      // torso
  poly(g, [[cx - 1.8, cy - 0.7 + bob], [cx + 1.8, cy - 0.7 + bob], [cx, cy + 1.6 + bob]], '#fff', OUT)  // collar
  if (c.title === 'Head of workers') poly(g, [[cx - 0.5, cy + 1.2 + bob], [cx + 0.5, cy + 1.2 + bob], [cx + 0.9, cy + 4.6 + bob], [cx, cy + 5.4 + bob], [cx - 0.9, cy + 4.6 + bob]], '#e45b5b')
  else rr(g, cx - 3.4, cy + 4.2 + bob, 6.8, 1, 0.5, shade(shirt, 0.25), null)                           // hem stripe
  // arms + hands
  if (c.state === 'working') { const a = frame ? 0 : 1; rr(g, cx - 6.4, cy + 2 + bob, 2.2, 4, 1.1, body); rr(g, cx + 4.2, cy + 2 + bob, 2.2, 4, 1.1, body); ell(g, cx - 5.3, cy + 6.4 - a, 1.4, 1.4, skin); ell(g, cx + 5.3, cy + 6.4 - (1 - a), 1.4, 1.4, skin) }
  else if (c.state === 'meeting') { rr(g, cx - 6.4, cy + 1 + bob, 2.2, 5, 1.1, body); ell(g, cx - 5.3, cy + 6.4 + bob, 1.4, 1.4, skin); g.save(); g.translate(cx + 5, cy + 1 + bob); g.rotate(frame ? -2.4 : -2.9); rr(g, -1.1, 0, 2.2, 5, 1.1, body); ell(g, 0, 5.2, 1.4, 1.4, skin); g.restore() } // waving
  else if (c.state === 'blocked') { rr(g, cx - 6.4, cy + 1 + bob, 2.2, 5, 1.1, body); ell(g, cx - 5.3, cy + 6.4 + bob, 1.4, 1.4, skin); g.save(); g.translate(cx + 5, cy + 1 + bob); g.rotate(-2.9); rr(g, -1.1, 0, 2.2, 5, 1.1, body); ell(g, 0, 5.4, 1.7, 1.7, '#e45b5b'); g.restore() } // stop hand
  else if (c.state === 'completed') { rr(g, cx - 6.4, cy + 1 + bob, 2.2, 5, 1.1, body); g.save(); g.translate(cx + 5, cy + 1 + bob); g.rotate(-2.5); rr(g, -1.1, 0, 2.2, 5, 1.1, body); ell(g, 0, 5.3, 1.4, 1.4, skin); g.restore(); ell(g, cx - 5.3, cy + 6.4 + bob, 1.4, 1.4, skin) }
  else { rr(g, cx - 6.4, cy + 0.6 + bob, 2.2, 5.4, 1.1, body); rr(g, cx + 4.2, cy + 0.6 + bob, 2.2, 5.4, 1.1, body); ell(g, cx - 5.3, cy + 6.2 + bob, 1.3, 1.3, skin); ell(g, cx + 5.3, cy + 6.2 + bob, 1.3, 1.3, skin) }
  // head
  ell(g, cx - 5.2, hy + 0.8, 1.2, 1.5, skin); ell(g, cx + 5.2, hy + 0.8, 1.2, 1.5, skin)             // ears
  ell(g, cx, hy, 5.3, 5.1, skin)                                                                       // head
  style(g, cx, hy, hair)
  eyes(g, cx, hy + 0.5, c, t)
  ell(g, cx - 3.5, hy + 2.3, 1, 0.65, '#ff7a8a55', null); ell(g, cx + 3.5, hy + 2.3, 1, 0.65, '#ff7a8a55', null) // blush
  mouth(g, cx, hy + 3, c, frame)
  if (c.state === 'thinking') ell(g, cx + 5.4, hy - 3.6 + (frame ? 0 : -0.4), 0.7, 0.7, '#fff', OUT) // thought pops
  if (c.state === 'blocked') { poly(g, [[cx - 4, hy - 1.5], [cx - 1, hy - 0.5], [cx - 1, hy - 1.1], [cx - 4, hy - 2.2]], OUT, null); poly(g, [[cx + 4, hy - 1.5], [cx + 1, hy - 0.5], [cx + 1, hy - 1.1], [cx + 4, hy - 2.2]], OUT, null) } // angry brows
  if (c.state === 'error') { ell(g, cx + 5.4, hy - 2.2, 0.55, 0.9, '#7fd0ff', null) } // sweat drop
  accessory(g, c.title, cx, hy, frame)
}

function drawQueen(g: CanvasRenderingContext2D, cx: number, cy: number, c: Character, frame: number, t: number) {
  const idle = c.state === 'idle' || c.state === 'completed'
  const flap = c.state === 'working' || c.state === 'meeting' || c.state === 'thinking' ? (frame ? 1 : 0.7) : 0.85
  const bob = (c.state === 'working' || c.state === 'meeting') && frame ? 0.8 : 0
  const skin = '#f6d7b8', gold = '#f5b942', body = c.state === 'error' ? '#8a2a2a' : idle ? '#d9a032' : gold
  g.translate(cx, cy + 8); g.scale(1.18, 1.18); g.translate(-cx, -(cy + 8))
  ell(g, cx, cy + 8, 7.5, 1.7, '#00000044', null)
  // wings
  for (const s of [-1, 1]) { g.save(); g.translate(cx + s * 3.5, cy + 1 + bob); g.rotate(s * (0.5 + (1 - flap) * 0.5)); ell(g, s * 4.4, -3.4, 3.2 * flap + 0.6, 6, 'rgba(190,230,255,0.75)', '#5b7fa0'); ell(g, s * 4, -5.2, 1, 2, 'rgba(255,255,255,0.7)', null); g.restore() }
  rr(g, cx - 3.6, cy + 5, 2.6, 3.4, 1.2, '#2b2f3a'); rr(g, cx + 1, cy + 5, 2.6, 3.4, 1.2, '#2b2f3a')
  // striped bee body
  g.save(); g.beginPath(); g.roundRect(cx - 5.4, cy - 1 + bob, 10.8, 7.8, 3.4); g.clip()
  g.fillStyle = body; g.fillRect(cx - 6, cy - 2 + bob, 12, 10)
  g.fillStyle = OUT; g.fillRect(cx - 6, cy + 1.2 + bob, 12, 1.5); g.fillRect(cx - 6, cy + 4.4 + bob, 12, 1.5)
  g.restore(); g.beginPath(); g.roundRect(cx - 5.4, cy - 1 + bob, 10.8, 7.8, 3.4); g.lineWidth = LW; g.strokeStyle = OUT; g.stroke()
  // royal collar + gem
  poly(g, [[cx - 3.2, cy - 0.8 + bob], [cx + 3.2, cy - 0.8 + bob], [cx + 1.6, cy + 0.9 + bob], [cx, cy + 1.6 + bob], [cx - 1.6, cy + 0.9 + bob]], '#fff', OUT); ell(g, cx, cy + 0.2 + bob, 0.7, 0.7, '#e45b5b', null)
  // arms
  const wave = c.state === 'working' || c.state === 'meeting'
  rr(g, cx - 6.8, cy + 0.8 + bob, 2.2, 5, 1.1, body); ell(g, cx - 5.7, cy + 6.2 + bob, 1.3, 1.3, skin)
  if (wave) { g.save(); g.translate(cx + 5.4, cy + 1 + bob); g.rotate(frame ? -2.5 : -3); rr(g, -1.1, 0, 2.2, 5, 1.1, body); ell(g, 0, 5.2, 1.4, 1.4, skin); g.restore() } // sceptre-wave
  else { rr(g, cx + 4.6, cy + 0.8 + bob, 2.2, 5, 1.1, body); ell(g, cx + 5.7, cy + 6.2 + bob, 1.3, 1.3, skin) }
  const hy = cy - 4.6 + bob
  // antennae
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * 2, hy - 4); g.quadraticCurveTo(cx + s * 4, hy - 8 - (frame ? 0.6 : 0), cx + s * 5, hy - 9.4 - (frame ? 0.6 : 0)); g.lineWidth = 0.6; g.strokeStyle = OUT; g.stroke(); ell(g, cx + s * 5, hy - 9.6 - (frame ? 0.6 : 0), 1.2, 1.2, gold) }
  ell(g, cx - 5.4, hy + 0.8, 1.2, 1.5, skin); ell(g, cx + 5.4, hy + 0.8, 1.2, 1.5, skin)
  ell(g, cx, hy, 5.6, 5.3, skin)
  // royal hair: dark bob with a golden fringe
  g.beginPath(); g.arc(cx, hy - 0.3, 5.8, Math.PI * 0.98, Math.PI * 2.02); g.quadraticCurveTo(cx + 3, hy - 3.2, cx, hy - 2.4); g.quadraticCurveTo(cx - 3, hy - 3.2, cx - 5.8, hy - 0.3); g.fillStyle = '#4a2c17'; g.fill(); g.lineWidth = LW; g.strokeStyle = OUT; g.stroke()
  rr(g, cx - 6.4, hy - 1, 2.2, 6.4, 1.1, '#4a2c17'); rr(g, cx + 4.2, hy - 1, 2.2, 6.4, 1.1, '#4a2c17')
  ell(g, cx, hy, 5.3, 5.1, skin, null); g.save(); g.beginPath(); g.rect(cx - 6, hy - 6, 12, 3.6); g.clip(); g.beginPath(); g.arc(cx, hy - 0.3, 5.8, Math.PI * 0.98, Math.PI * 2.02); g.quadraticCurveTo(cx + 3, hy - 3.2, cx, hy - 2.4); g.quadraticCurveTo(cx - 3, hy - 3.2, cx - 5.8, hy - 0.3); g.fillStyle = '#4a2c17'; g.fill(); g.restore()
  eyes(g, cx, hy + 0.7, c, t, 2.3, 1.05)
  ell(g, cx - 3.6, hy + 2.4, 1, 0.65, '#ff7a8a66', null); ell(g, cx + 3.6, hy + 2.4, 1, 0.65, '#ff7a8a66', null)
  mouth(g, cx, hy + 3.1, c, frame)
  // crown
  const crown: [number, number][] = [[cx - 4, hy - 3.6], [cx - 4.4, hy - 8], [cx - 2, hy - 6], [cx, hy - 9], [cx + 2, hy - 6], [cx + 4.4, hy - 8], [cx + 4, hy - 3.6]]
  poly(g, crown, '#ffd54a'); rr(g, cx - 4.2, hy - 4.2, 8.4, 1.4, 0.6, '#d99b27')
  ell(g, cx, hy - 3.5, 0.7, 0.7, '#e45b5b', null); ell(g, cx - 2.4, hy - 3.5, 0.5, 0.5, '#69a7e8', null); ell(g, cx + 2.4, hy - 3.5, 0.5, 0.5, '#5fd39a', null)
  if (frame && !idle) sparkle(g, cx + 3.6, hy - 8.6, 1.1, '#fff')
}

/** Speech-bubble status marker above a character; glyphs/colours are the same real-state encoding as before. */
function drawStatus(g: CanvasRenderingContext2D, c: Character, cx: number, topY: number, frame: number) {
  const col = STATE_COLOR[c.state]
  if (c.state === 'idle' && c.role === 'watchdog') return
  const gx = Math.round(cx - 2), gy = Math.round(topY + 1)
  g.save(); g.globalAlpha = 0.95
  poly(g, [[cx - 1.4, topY + 7.6], [cx + 1.4, topY + 7.6], [cx, topY + 9.4]], '#0f131a', col)
  rr(g, cx - 4.8, topY - 1, 9.6, 8.6, 2.4, '#0f131a', col)
  poly(g, [[cx - 1.1, topY + 7.5], [cx + 1.1, topY + 7.5], [cx, topY + 8.8]], '#0f131a', null)
  g.restore()
  if (c.state === 'thinking') glyph(g, 'dots', gx, gy, frame ? col : col + '88')
  else if (c.state === 'waiting') glyph(g, 'q', gx, gy, frame ? col : col + 'aa')
  else if (c.state === 'blocked') glyph(g, 'bang', gx, gy, col)
  else if (c.state === 'completed') glyph(g, 'check', gx, gy, col)
  else if (c.state === 'error') glyph(g, 'x', gx, gy, col)
  else if (c.state === 'idle') glyph(g, 'z', gx, gy, col)
  else if (c.state === 'working' && c.role === 'watchdog') glyph(g, 'bang', gx, gy, '#e45b5b')
  else ell(g, cx, topY + 3.3, 1.6, 1.6, col, null) // working / meeting: solid status dot
}

/** Watch dogs: Rex (tan beagle, floppy ears, white blaze) and Bolt (grey husky, pointy ears, lightning mark). They sit by Queen's door; ears perk, tail wags and they bark only while a real alert is open. */
function drawDog(g: CanvasRenderingContext2D, cx: number, cy: number, c: Character, frame: number, t: number) {
  const alert = c.state === 'working'
  const rex = c.name === 'Rex'
  const fur = rex ? '#c98f56' : '#7f8896', furDark = rex ? '#7a4a24' : '#4b525e', light = rex ? '#f6e3c4' : '#eef2f7'
  const hy = cy - 4.4
  const wag = alert ? (frame ? 1 : -1) : Math.sin(t / 700) * 0.15
  ell(g, cx, cy + 8, 8, 1.7, '#00000044', null)
  // tail
  g.save(); g.translate(cx + 5.6, cy + 5); g.rotate(-0.9 + wag * 0.9)
  rr(g, -0.8, -6, 2.6, 6.8, 1.3, rex ? furDark : fur); if (!rex) rr(g, -0.8, -6, 2.6, 2, 1, light, OUT); else rr(g, -0.8, -6, 2.6, 2, 1, light, OUT)
  g.restore()
  // body + chest + paws
  ell(g, cx, cy + 3.8, 5.6, 5.0, fur); ell(g, cx, cy + 4.6, 3.2, 3.6, light, null)
  ell(g, cx - 2.6, cy + 8, 1.9, 1.3, light); ell(g, cx + 2.6, cy + 8, 1.9, 1.3, light)
  if (!rex) { poly(g, [[cx + 3.2, cy + 0.6], [cx + 5, cy + 0.8], [cx + 4, cy + 2.6], [cx + 5.4, cy + 2.8], [cx + 3, cy + 5.8], [cx + 3.6, cy + 3.4], [cx + 2.6, cy + 3.2]], '#ffd54a', null) } // lightning flash on the flank
  // ears (behind head)
  if (rex) { for (const s of [-1, 1]) { g.save(); g.translate(cx + s * 5.2, hy - 1.4); g.rotate(s * (alert ? (frame ? -0.35 : -0.15) : 0.35)); ell(g, 0, alert ? 1.4 : 2.6, 1.9, alert ? 3.2 : 3.8, furDark); g.restore() } }
  else { for (const s of [-1, 1]) { g.save(); g.translate(cx + s * 3.6, hy - 4.2); g.rotate(s * (alert && frame ? 0.1 : 0.22)); poly(g, [[-2.2, 1.6], [0, -(alert ? 5.8 : 4.8)], [2.2, 1.6]], furDark); poly(g, [[-1, 1], [0, -2.6], [1, 1]], '#d9a0b4', null); g.restore() } }
  // head
  ell(g, cx, hy, 6.2, 5.6, fur)
  if (rex) { poly(g, [[cx - 1.1, hy - 5.2], [cx + 1.1, hy - 5.2], [cx + 1.5, hy + 1], [cx - 1.5, hy + 1]], light, null); ell(g, cx + 3, hy - 1.2, 1.9, 1.7, furDark, null) } // blaze + eye patch
  else { poly(g, [[cx - 5.6, hy - 1], [cx - 1.6, hy - 2.2], [cx - 0.4, hy + 1.2], [cx - 2.4, hy + 3], [cx - 5.4, hy + 2]], light, null); poly(g, [[cx + 5.6, hy - 1], [cx + 1.6, hy - 2.2], [cx + 0.4, hy + 1.2], [cx + 2.4, hy + 3], [cx + 5.4, hy + 2]], light, null); poly(g, [[cx, hy - 5.4], [cx + 1.2, hy - 3.2], [cx + 0.2, hy - 3.3], [cx + 1, hy - 1.4], [cx - 1.2, hy - 3.4], [cx - 0.2, hy - 3.4]], '#ffd54a', null) } // husky mask + forehead bolt
  g.beginPath(); g.ellipse(cx, hy, 6.2, 5.6, 0, 0, TAU); g.lineWidth = LW; g.strokeStyle = OUT; g.stroke()
  // eyes
  for (const s of [-1, 1]) {
    const ex = cx + s * 2.7, ey = hy - 0.6
    ell(g, ex, ey, 1.7, 1.9, '#fff'); ell(g, ex + (alert ? s * -0.1 : 0), ey + 0.2, 1.05, 1.2, rex ? '#3a2412' : '#58b6e8', null); ell(g, ex, ey + 0.2, 0.55, 0.65, OUT, null); ell(g, ex + 0.4, ey - 0.4, 0.4, 0.4, '#fff', null)
    if (alert) poly(g, [[ex - s * 2, ey - 3.4], [ex + s * 1.8, ey - 2.2], [ex + s * 1.8, ey - 1.5], [ex - s * 2, ey - 2.6]], OUT, null) // angry brow
  }
  // snout, nose, mouth, tongue
  ell(g, cx, hy + 2.6, 3.2, 2.4, light)
  ell(g, cx, hy + 1.2, 1.5, 1, OUT, OUT); ell(g, cx - 0.4, hy + 0.9, 0.4, 0.25, '#fff', null)
  if (alert) { ell(g, cx, hy + 3.6, 1.4, 1.1 + (frame ? 0.7 : 0), '#7a1d2b'); } // barking
  else { arc(g, cx - 0.9, hy + 3.1, 0.9, 0.05, 0.95, OUT, 0.5); arc(g, cx + 0.9, hy + 3.1, 0.9, 0.05, 0.95, OUT, 0.5); rr(g, cx - 0.9, hy + 3.8, 1.8, 1.9 + (Math.sin(t / 400) > 0.5 ? 0.3 : 0), 0.9, '#ff7a93') } // happy panting tongue
  // collar + badge
  rr(g, cx - 3.8, cy - 0.2, 7.6, 1.7, 0.8, '#e45b5b'); g.save(); g.translate(cx, cy + 2.4); sparkle(g, 0, 0, 1.9, '#ffd54a'); ell(g, 0, 0, 0.5, 0.5, '#d99b27', null); g.restore()
  if (alert) { // bark lines
    g.lineCap = 'round'; g.lineWidth = 0.5; g.strokeStyle = '#ffe27a'
    for (const [dx, dy] of [[-1, 0], [0, -1], [1, 0]]) { g.beginPath(); g.moveTo(cx + 8 + dx * 1, hy + 3 + dy * 2); g.lineTo(cx + 10.4 + dx * 1.6, hy + 3 + dy * 3.2); g.stroke() }
  }
}
