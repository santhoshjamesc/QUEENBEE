import { useEffect, useMemo, useRef, useState } from 'react'
import { deriveOffice, layoutOffice, needsAnimation, FrameLoop, type Character, type OfficeInputs } from '../shared/office'
import { ROLE_PRESETS, type RolePreset } from '../shared/roles'
import { drawOffice, STATE_COLOR, SCALE } from './office/draw'
import { isMoving } from './office/motion'

interface Snap extends OfficeInputs { files: { ts: number; path: string; kind: string; source: string; sessions: string[] }[]; assignments: { taskId: string; skill: string }[]; tasks: (OfficeInputs['tasks'][number] & { scope?: string[] })[]; messages: (OfficeInputs['messages'][number] & { body?: string })[] }

/** Office (canvas) + equivalent list view. Both render the same derived characters; neither adds information. */
export function Office({ queenId, onOpen, onError }: { queenId?: string; onOpen: (sessionId: string) => void; onError: (m: string) => void }) {
  const [snap, setSnap] = useState<Snap | null>(null)
  const [view, setView] = useState<'office' | 'list'>('office')
  const [sel, setSel] = useState<string | null>(null)
  const [hiring, setHiring] = useState(false)
  const [hName, setHName] = useState('')
  const [hTitle, setHTitle] = useState('Developer')
  const [hFocus, setHFocus] = useState('')
  const [hRules, setHRules] = useState('')
  const [hAllow, setHAllow] = useState('')
  const [hDeny, setHDeny] = useState('')
  const hiredCount = snap?.hires?.length ?? 0
  const [custom, setCustom] = useState(false)
  const [term, setTerm] = useState<{ ts: number; command: string; result?: string }[]>([])
  const canvas = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const paint = useRef<(t: number) => void>(() => {})
  const loop = useRef<FrameLoop | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => window.queen.officeSnapshot(queenId).then((s) => alive && setSnap(s)).catch((e) => onError(String(e.message ?? e)))
    load(); const t = setInterval(load, 1500)
    return () => { alive = false; clearInterval(t) }
  }, [queenId])

  const chars = useMemo(() => (snap ? deriveOffice({ ...snap, now: snap.now }) : []), [snap])
  const L = useMemo(() => layoutOffice(chars), [chars])
  paint.current = (t: number) => {
    const c = canvas.current?.getContext('2d'); if (!c) return
    const pos = drawOffice(c, L, chars, t)
    if (!needsAnimation(chars) && !isMoving()) loop.current?.setActive(false) // everyone has arrived and nothing animates: stop drawing
    wrap.current?.querySelectorAll<HTMLElement>('.hit').forEach((el) => { const p = pos[el.dataset.sid ?? '']; if (p) { el.style.left = `${((p.x - 8) / L.width) * 100}%`; el.style.top = `${((p.y - 14) / L.height) * 100}%` } })
  }

  // one loop for the component's lifetime; it only runs while something animates and the window is visible
  useEffect(() => {
    loop.current = new FrameLoop((t) => paint.current(t), { raf: (cb) => requestAnimationFrame(cb), cancel: (id) => cancelAnimationFrame(id), hidden: () => document.hidden }, 12)
    const vis = () => loop.current?.sync()
    document.addEventListener('visibilitychange', vis)
    return () => { document.removeEventListener('visibilitychange', vis); loop.current?.setActive(false) }
  }, [view])
  useEffect(() => {
    paint.current(performance.now())
    // wake the loop on any change; paint() stops it again once everyone is still
    loop.current?.setActive(view === 'office' && chars.length > 0)
  }, [chars, L, view])

  const cur = chars.find((c) => c.sessionId === sel)
  useEffect(() => { if (sel) window.queen.officeTerminal(sel).then(setTerm).catch(() => setTerm([])); else setTerm([]) }, [sel, snap])
  const act = (f: () => Promise<unknown>) => f().catch((e) => onError(String(e.message ?? e)))
  const inMeeting = chars.filter((c) => c.state === 'meeting').length
  const recentFiles = snap ? snap.files.filter((f) => snap.now - f.ts < 300_000) : []

  const hireWith = (name: string, title: string, p: { focus: string; rules: string; allow: string; deny: string }) => queenId && window.queen.hire(queenId, name, title, { focus: p.focus, instructions: p.rules, allow: p.allow, deny: p.deny }).then(() => { setHName(''); setHFocus(''); setHRules(''); setHAllow(''); setHDeny(''); setHiring(false); setCustom(false); return window.queen.officeSnapshot(queenId).then(setSnap) }).catch((e) => onError(String(e.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
  const doHire = () => hireWith(hName, hTitle, { focus: hFocus, rules: hRules, allow: hAllow, deny: hDeny })
  const hirePreset = (p: RolePreset) => hireWith('', p.title, p)
  if (!queenId) return <div className="empty">Start or select a Queen session to see its office. The office only shows real sessions of a Queen's run.</div>
  return (
    <div>
      <div className="tycoon">
        <span className="muted">{hiredCount} on staff · hiring is free</span>
        <span className="spacer" />
        <button className="primary" onClick={() => setHiring((v) => !v)}>＋ Hire a worker</button>
      </div>
      {hiring && (
        <div className="card hire-form">
          <h3>Hire a worker</h3>
          <div className="role-grid">
            {ROLE_PRESETS.map((p) => (
              <button key={p.key} className="role" onClick={() => hirePreset(p)}><b>{p.label}</b><span className="muted">{p.blurb}</span></button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 8 }}><button className="ghost sm" onClick={() => setCustom((v) => !v)}>{custom ? 'Hide custom setup' : 'Custom setup…'}</button><button className="ghost sm" onClick={() => setHiring(false)}>Close</button></div>
          {custom && (<>
          <div className="row" style={{ marginTop: 8 }}>
            <input value={hName} placeholder="Name (optional)" aria-label="Name of the new hire" maxLength={30} onChange={(e) => setHName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doHire()} />
            <select value={hTitle} aria-label="Job title" onChange={(e) => setHTitle(e.target.value)}>{['Senior developer', 'Developer', 'Code reviewer', 'QA', 'Tester', 'BA', 'Designer', 'Writer', 'Researcher', 'Head of workers'].map((t) => <option key={t}>{t}</option>)}</select>
          </div>
          <div className="hire-fields">
            <label>What they do <input value={hFocus} maxLength={80} placeholder="e.g. mobile app only" onChange={(e) => setHFocus(e.target.value)} /></label>
            <label>Rules (they must follow these) <textarea rows={3} maxLength={2000} value={hRules} placeholder="e.g. Only improve the UI. Never change logic or workflow." onChange={(e) => setHRules(e.target.value)} /></label>
            <label>Only allowed to change (paths, comma separated; empty = anywhere in the task scope) <input value={hAllow} placeholder="e.g. mobile/**, ios/**" onChange={(e) => setHAllow(e.target.value)} /></label>
            <label>Never allowed to change <input value={hDeny} placeholder="e.g. **/api/**, **/server/**" onChange={(e) => setHDeny(e.target.value)} /></label>
          </div>
          <div className="row" style={{ marginTop: 8 }}><button className="primary" onClick={doHire}>Hire</button></div>
          </>)}
          <div className="note">Staff are shared by every window and do one task at a time overall. Allowed / blocked paths are enforced on every file write; rules are instructions to the worker. Their Claude session starts when Queen assigns them a task (after you approve her plan).</div>
        </div>
      )}
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="tabs">
          <button className={'tab' + (view === 'office' ? ' on' : '')} onClick={() => setView('office')}>Map</button>
          <button className={'tab' + (view === 'list' ? ' on' : '')} onClick={() => setView('list')}>List</button>
        </div>
        <span className="muted">{chars.length} agent{chars.length === 1 ? '' : 's'} · {inMeeting} in a meeting · every state comes from live session and task data</span>
      </div>
      {chars.length === 0 && <div className="empty">Queen is arriving…</div>}
      {chars.length > 0 && view === 'office' ? (
        <>
        <div className="office-wrap" ref={wrap} style={{ aspectRatio: `${L.width} / ${L.height}` }}>
          <canvas ref={canvas} width={L.width * SCALE} height={L.height * SCALE} role="img" aria-label={`Office with ${chars.length} agents. ${chars.map((c) => `${c.name}: ${c.state}`).join('; ')}`} />
          {chars.map((c) => { const p = L.pos[c.sessionId]; return p && (
            <button key={c.sessionId} data-sid={c.sessionId} className={'hit' + (sel === c.sessionId ? ' on' : '')} onClick={() => setSel(c.sessionId)} aria-label={`${c.name}, ${c.state}. ${c.reason}`}
              style={{ left: `${((p.x - 8) / L.width) * 100}%`, top: `${((p.y - 14) / L.height) * 100}%`, width: `${(16 / L.width) * 100}%`, height: `${(28 / L.height) * 100}%` }}>
              <span className={'say' + (p.y < 70 ? ' below' : '') + (p.x < 90 ? ' left' : p.x > L.width - 90 ? ' right' : '')} role="tooltip"><b>{c.name}{c.title ? ` · ${c.title}` : c.role === 'watchdog' ? ' · Watchdog' : ''}</b><br />{c.state}{c.reason ? ` — ${c.reason}` : ''}</span>
            </button>) })}
          <div className="zone" style={{ left: `${((L.queenRoom.x + 4) / L.width) * 100}%`, top: `${((L.queenRoom.y + 4) / L.height) * 100}%`, color: 'var(--bee)' }}>Queen's office</div>
          <div className="zone" style={{ left: `${((L.meetingRoom.x + 4) / L.width) * 100}%`, top: `${((L.meetingRoom.y + 4) / L.height) * 100}%` }}>Meeting room · {inMeeting}</div>
          <div className="zone" style={{ left: `${((L.shared.x + 4) / L.width) * 100}%`, top: `${((L.shared.y + 4) / L.height) * 100}%` }}>Shared workspace · {recentFiles.length} file change{recentFiles.length === 1 ? '' : 's'} in the last 5 min</div>
          {chars.filter((c) => c.role === 'worker' && c.taskId).map((c) => { const d = L.desks[c.desk ?? 0]; return d && (
            <div key={'l' + c.sessionId} className="tag" style={{ left: `${(d.x / L.width) * 100}%`, top: `${((d.y + 24) / L.height) * 100}%` }}>{c.taskId}</div>) })}
        </div>
        <div className="legend">
          {(['working', 'thinking', 'waiting', 'blocked', 'meeting', 'completed', 'error', 'idle'] as const).map((k) => <span key={k}><i style={{ background: STATE_COLOR[k] }} />{k}</span>)}
        </div>
        </>
      ) : chars.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead><tr><th>Agent</th><th>State</th><th>Task</th><th>Why</th><th /></tr></thead>
            <tbody>{chars.map((c) => (
              <tr key={c.sessionId}><td>{c.role === 'queen' ? '♛ ' : c.role === 'watchdog' ? '🐕 ' : ''}{c.name}{c.title ? ` · ${c.title}` : ''}</td>
                <td><span className={'pill ' + STATE_PILL[c.state]}>{c.state}</span></td>
                <td>{c.taskId ? `${c.taskId} (${c.taskStatus})` : '—'}</td><td className="muted">{c.reason}</td>
                <td><button className="sm" onClick={() => setSel(c.sessionId)}>Inspect</button></td></tr>))}</tbody>
          </table>
        </div>
      )}
      {cur && snap && <Inspector c={cur} snap={snap} term={term} onClose={() => setSel(null)} onOpen={() => onOpen(cur.sessionId)}
        onPause={() => act(() => (snap.sessions.find((s) => s.id === cur.sessionId)?.paused ? window.queen.resume(cur.sessionId) : window.queen.pause(cur.sessionId)))}
        onStop={() => act(() => window.queen.stop(cur.sessionId))}
        onRemove={cur.hireId ? () => { if (confirm(`Remove ${cur.name} from the staff? This cannot be undone.`)) act(() => window.queen.removeHire(cur.hireId!).then(() => setSel(null))) } : undefined} />}
    </div>
  )
}

const STATE_PILL: Record<string, string> = { working: 'ok', thinking: 'info', waiting: 'warn', idle: 'mute', blocked: 'bad', meeting: 'warn', completed: 'ok', error: 'bad' }

function Inspector({ c, snap, term, onClose, onOpen, onPause, onStop, onRemove }: { c: Character; snap: Snap; term: { ts: number; command: string; result?: string }[]; onClose: () => void; onOpen: () => void; onPause: () => void; onStop: () => void; onRemove?: () => void }) {
  const task = snap.tasks.find((t) => t.id === c.taskId)
  const mine = (x: string) => x === (c.role === 'queen' ? 'queen' : c.taskId)
  const msgs = snap.messages.filter((m) => mine(m.from) || mine(m.to)).slice(-8)
  const files = snap.files.filter((f) => f.sessions.includes(c.sessionId)).slice(0, 8)
  const skills = snap.assignments.filter((a) => a.taskId === c.taskId)
  const s = snap.sessions.find((x) => x.id === c.sessionId)
  const live = s && ['spawning', 'idle', 'working'].includes(s.status)
  return (
    <div className="inspector glass">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <div><h3>{c.role === 'queen' ? '♛ ' : c.role === 'watchdog' ? '🐕 ' : ''}{c.name}{c.title ? ` · ${c.title}` : c.role === 'watchdog' ? ' · Watchdog' : ''}</h3><div className="muted">{c.reason}</div></div>
        <button className="ghost sm" onClick={onClose} aria-label="Close inspector">✕</button>
      </div>
      <div className="row">
        <span className={'pill ' + STATE_PILL[c.state]}>{c.state}</span>
        {task && <span className="pill mute">{task.id} · {task.status}</span>}
      </div>
      <div className="row">
        {s && <button className="primary sm" onClick={onOpen}>Open session</button>}
        {c.role === 'worker' && live && <button className="sm" onClick={onPause}>{s?.paused ? 'Resume' : 'Pause'}</button>}
        {live && <button className="danger sm" onClick={onStop}>Stop</button>}
        {onRemove && <button className="danger sm" onClick={onRemove}>Delete worker</button>}
      </div>
      {task && <div><h4>Task</h4><div>{task.title}</div>{task.scope?.length ? <div className="muted">Scope: {task.scope.join(', ')}</div> : null}</div>}
      <div><h4>Assigned skills</h4><div className="muted">{skills.map((k) => k.skill).join(', ') || 'None (normal discovery)'}</div></div>
      <div><h4>Terminal · recent Bash commands</h4>
        {term.length === 0 ? <div className="muted">No commands run.</div> : term.slice(0, 6).map((t, i) => <div key={i} className="line">$ {t.command}{t.result ? `\n  → ${t.result.slice(0, 120)}` : ''}</div>)}</div>
      <div><h4>Communication</h4>
        {msgs.length === 0 ? <div className="muted">No routed messages.</div> : msgs.map((m, i) => <div key={i} className="line">{new Date(m.ts).toLocaleTimeString()} {m.from}→{m.to}{m.delivered ? '' : ' (undelivered)'}{m.body ? ': ' + m.body.slice(0, 100) : ''}</div>)}</div>
      <div><h4>Recent file activity</h4>
        {files.length === 0 ? <div className="muted">None attributed to this agent.</div> : files.map((f, i) => <div key={i} className="line">{new Date(f.ts).toLocaleTimeString()} {f.kind} {f.path} ({f.source})</div>)}</div>
    </div>
  )
}
