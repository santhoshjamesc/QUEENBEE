import { useEffect, useRef, useState } from 'react'
import { Office } from './Office'
import { IntelPanel } from './Intel'
import { ChatRoom } from './Chat'
import { SkillsPanel, SkillApproval } from './Skills'
import type { PendingItem, SessionEvent, SessionInfo } from '../shared/types'
import type { QueenApi } from '../preload'
import type { Task, Msg } from '../main/queen/tasks'
import type { Alert } from '../main/queen/watchdog'

declare global { interface Window { queen: QueenApi } }

/** Turn a raw stream-json event into a readable terminal-style line (or null to hide noise). */
export function render(e: SessionEvent): { cls: string; text: string } | null {
  const p: any = e.payload
  if (e.type === 'assistant') {
    const out: string[] = []
    for (const b of p.message?.content ?? []) {
      if (b.type === 'text') out.push(b.text)
      if (b.type === 'tool_use') out.push(`⚙ ${b.name} ${JSON.stringify(b.input).slice(0, 300)}`)
    }
    const hasTool = (p.message?.content ?? []).some((b: any) => b.type === 'tool_use')
    return out.length ? { cls: hasTool ? 'ev-tool' : 'ev-assistant', text: out.join('\n') } : null
  }
  if (e.type === 'user') {
    for (const b of p.message?.content ?? []) if (b.type === 'tool_result') {
      const t = typeof b.content === 'string' ? b.content : JSON.stringify(b.content)
      return { cls: 'ev-dim', text: '↳ ' + t.slice(0, 600) }
    }
    return null
  }
  if (e.type === 'result') return { cls: 'ev-result', text: `✔ done (${p.subtype}) cost $${(p.total_cost_usd ?? 0).toFixed(4)}` }
  if (e.type === 'stderr' || e.type === 'spawn_error') return { cls: 'ev-err', text: String(p.text ?? p.message) }
  if (e.type === 'process_exit') return { cls: 'ev-dim', text: `process exited code=${p.code} signal=${p.signal}` }
  if (e.type === 'rate_limit_event') return { cls: 'ev-dim', text: `rate limit: ${p.rate_limit_info?.status}` }
  return null
}

export function App() {
  const [bin, setBin] = useState<string | null | undefined>(undefined)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [project, setProject] = useState<string | null | undefined>(undefined)
  const [recents, setRecents] = useState<string[]>([])
  const cwd = project ?? ''
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [pending, setPending] = useState<PendingItem[]>([])
  const [maxS, setMaxS] = useState(5)
  const [rate, setRate] = useState<{ ts: number; info: any } | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [tasks, setTasks] = useState<Task[]>([])
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [view, setView] = useState<'map' | 'chat' | 'terminal' | 'code' | 'skills'>('map')
  const [chatFocus, setChatFocus] = useState('boss:queen')
  const [loaded, setLoaded] = useState(false)
  const autoQueen = useRef<string | null>(null)
  const [dockOpen, setDockOpen] = useState(true)
  const [assigned, setAssigned] = useState<{ taskId: string; skill: string }[]>([])
  const logRef = useRef<HTMLDivElement>(null)
  const refresh = () => window.queen.list().then((l) => { setSessions(l.filter((x) => x.cwd === projectRef.current)); setLoaded(true) })
  const projectRef = useRef<string | null>(null)

  useEffect(() => {
    const set = (p: string | null) => { projectRef.current = p; setProject(p); setSel(null); setEvents([]); refresh() }
    window.queen.project().then(set)
    window.queen.recents().then(setRecents)
    const off = window.queen.onProjectChanged(set)
    return () => { off() }
  }, [])
  useEffect(() => {
    window.queen.env().then((e) => setBin(e.claudeBinary))
    refresh()
    window.queen.pending().then(setPending)
    // pending items are global; each window only shows those of its own project's sessions
    window.queen.getSettings().then((x) => setMaxS(x.maxSessions))
    window.queen.rateLimit().then(setRate)
    const pp = window.queen.onPending(setPending)
    const a = window.queen.onStatus(() => refresh())
    const b = window.queen.onEvent((e) => setEvents((prev) => (e.sessionId === selRef.current ? [...prev, e] : prev)))
    return () => { a(); b(); pp() }
  }, [])
  const selRef = useRef<string | null>(null)
  useEffect(() => {
    selRef.current = sel
    if (sel) window.queen.events(sel).then(setEvents)
  }, [sel])
  useEffect(() => { if (events.some((e) => e.type === 'rate_limit_event')) window.queen.rateLimit().then(setRate) }, [events])
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight) }, [events])

  useEffect(() => {
    const q = sessions.find((x) => x.id === sel && x.role === 'queen')
    if (!q) { setTasks([]); setMsgs([]); setAlerts([]); return }
    const load = () => { window.queen.tasks(q.id).then(setTasks); window.queen.messages(q.id).then(setMsgs); window.queen.alerts(q.id).then(setAlerts); window.queen.skillAssignments(q.id).then(setAssigned) }
    load(); const t = setInterval(load, 1500); return () => clearInterval(t)
  }, [sel, sessions])

  // There is always exactly one Queen per project: reuse (resume) the existing one, or start the first. No way to add another.
  useEffect(() => {
    if (!loaded || !project || bin === undefined || bin === null || autoQueen.current === project) return
    autoQueen.current = project
    const qs = sessions.filter((x) => x.role === 'queen').sort((a, b) => b.startedAt - a.startedAt)
    const q = qs[0]
    const go = async () => {
      if (q && q.status !== 'stopped' && q.status !== 'crashed') setSel(q.id)
      else { const s = await window.queen.start({ name: 'Queen', cwd: project, role: 'queen', resumeId: q?.id }); setSel(s.id) }
      refresh()
    }
    go().catch((e) => setErr(String(e.message ?? e)))
  }, [loaded, project, bin, sessions])

  const run = async (f: () => Promise<unknown>) => { setErr(''); try { await f() } catch (e: any) { setErr(String(e.message ?? e)) } }
  const cur = sessions.find((s) => s.id === sel)

  const visiblePending = pending.filter((p) => sessions.some((x) => x.id === p.sessionId))
  if (project === undefined) return null
  if (project === null) return (
    <div className="welcome">
      <div className="hex-lg">♛</div>
      <div><h1>QueenBee</h1><p>Open a project folder to coordinate Claude Code agents.</p></div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="primary" onClick={() => window.queen.pickProject()}>Open folder…</button>
        <button onClick={() => window.queen.newWindow()}>New window</button>
      </div>
      {recents.length > 0 && <div className="recent">
        <div className="label">Recent projects</div>
        {recents.map((p) => <div key={p} className="item" onClick={() => window.queen.openProject(p)}><div style={{ fontWeight: 600 }}>{p.split('/').pop()}</div><div className="muted">{p}</div></div>)}
      </div>}
    </div>
  )
  if (bin === null) return <div className="card notice"><h3>Claude Code was not found</h3><p className="muted">Install it, sign in by running <code>claude</code> once, then restart Queen.</p></div>

  const openAlerts = cur?.role === 'queen' ? alerts.filter((a) => a.status === 'open') : []
  const attention = visiblePending.length + openAlerts.length
  const live = (s: SessionInfo) => s.status !== 'stopped' && s.status !== 'crashed'
  const dotColor = (s: SessionInfo) => s.status === 'working' ? 'var(--ok)' : s.status === 'idle' ? 'var(--fg3)' : s.status === 'spawning' ? 'var(--info)' : 'var(--bad)'
  const taskTone = (st: string) => st === 'verified' ? 'ok' : st === 'failed' ? 'bad' : st === 'working' ? 'info' : st === 'awaiting_verification' ? 'warn' : 'mute'
  const queenId = cur?.role === 'queen' ? cur.id : sessions.find((x) => x.role === 'queen')?.id
  const lastLine = [...events].reverse().map(render).find(Boolean)
  const working = sessions.filter((s) => s.status === 'working').length

  return (
    <div className="app">
      <header className="top">
        <div className="brand"><span className="hex">♛</span>QueenBee</div>
        <span className="project" title={cwd}>{cwd.split('/').pop()}</span>
        <nav className="tabs">
          {([['map', 'Office'], ['chat', 'Chat room'], ['terminal', 'Terminal'], ['code', 'Code'], ['skills', 'Skills']] as const).map(([k, l]) => (
            <button key={k} className={'tab' + (view === k ? ' on' : '')} onClick={() => setView(k)}>{l}</button>
          ))}
        </nav>
        <span className="spacer" />
        <button className="primary sm" onClick={() => { setChatFocus('boss:queen'); setView('chat') }}>♛ Chat with Queen</button>
        {rate && <span className={'pill ' + (rate.info?.status === 'allowed' ? 'ok' : 'warn')} title="From the latest rate_limit_event emitted by Claude Code">
          Rate limit {rate.info?.status ?? '?'}{rate.info?.resetsAt ? ` · resets ${new Date(rate.info.resetsAt * 1000).toLocaleTimeString()}` : ''}</span>}
      </header>

      <aside className="side">
        <div className="side-actions">
          <button className="wide" onClick={() => run(async () => { const s = await window.queen.start({ name: 'Session', cwd }); setSel(s.id); setView('terminal'); refresh() })}>New session</button>
        </div>
        <div>
          <div className="label">Sessions</div>
          <div className="stack" style={{ gap: 4 }}>
            {sessions.length === 0 && <div className="empty">Starting Queen…</div>}
            {sessions.map((s) => (
              <div key={s.id} className={'session' + (s.id === sel ? ' sel' : '')} onClick={() => setSel(s.id)}>
                <span className="dot" style={{ background: dotColor(s) }} />
                <div style={{ minWidth: 0 }}>
                  <div className="nm">{s.role === 'queen' && <span style={{ color: 'var(--bee)', flex: 'none' }}>♛</span>}<span>{s.name}</span></div>
                  <div className="sub">{s.paused ? 'paused' : s.status} · {s.id.slice(0, 8)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="setting" style={{ marginTop: 'auto' }}>Max sessions
          <input type="number" min={1} max={20} value={maxS} aria-label="Max sessions"
            onChange={(e) => { const n = Number(e.target.value); setMaxS(n); run(() => window.queen.setMax(n)) }} />
        </div>
      </aside>

      <main className="main">
        <div className="toolbar">
          <h2>{view === 'chat' ? 'Chat room' : view === 'map' ? 'Office' : cur ? cur.name : view === 'code' ? 'Code intelligence' : view === 'skills' ? 'Skills' : 'No session selected'}</h2>
          {cur && <span className={'pill ' + (cur.paused ? 'warn' : cur.status === 'working' ? 'ok' : live(cur) ? 'mute' : 'bad')}>{cur.paused ? 'paused' : cur.status}</span>}
          {cur?.paused && <span className="muted">Holds at the next tool call</span>}
          <span className="spacer" />
          {cur && live(cur) && <button className="danger" onClick={() => run(() => window.queen.stop(cur.id))}>Stop</button>}
          {cur?.role === 'worker' && live(cur) && (cur.paused
            ? <button className="primary" onClick={() => run(() => window.queen.resume(cur.id))}>Resume work</button>
            : <button onClick={() => run(() => window.queen.pause(cur.id))}>Pause</button>)}
          {cur && !live(cur) && (
            <button className="primary" onClick={() => run(async () => { const s = await window.queen.start({ name: cur.name, cwd: cur.cwd, resumeId: cur.id }); setSel(s.id); refresh() })}>Resume session</button>
          )}
        </div>
        {err && <div className="err">{err}</div>}

        {view === 'chat' && <div className="view"><ChatRoom runId={queenId} focus={chatFocus} onError={setErr} questions={visiblePending.filter((p) => p.kind === 'question')} onAnswer={(id, ans) => run(() => window.queen.answer(id, ans))} /></div>}
        {view === 'map' && <div className="view"><Office queenId={queenId} onOpen={(id) => { setSel(id); setView('terminal') }} onError={setErr} /></div>}
        {view === 'code' && <div className="view"><IntelPanel root={cur?.cwd ?? cwd} onError={setErr} /></div>}
        {view === 'skills' && <div className="view"><SkillsPanel root={cur?.cwd ?? cwd} onError={setErr} /></div>}
        {view === 'terminal' && (
          <div className="term-view">
            {cur?.role === 'queen' && tasks.length > 0 && (
              <div className="card" style={{ maxHeight: 220, overflow: 'auto' }}>
                <h3>Tasks</h3>
                {tasks.map((t) => (
                  <div key={t.id} className="task">
                    <span className="tid">{t.id}</span>
                    <span>{t.title}</span>
                    <span className="row" style={{ gap: 8 }}>
                      <span className={'pill ' + taskTone(t.status)}>{t.status.replace('_', ' ')}</span>
                      {t.assignee && <a className="link" onClick={() => setSel(t.assignee!)}>Open worker</a>}
                    </span>
                    <span className="meta">
                      {t.deps.length > 0 && <>After {t.deps.join(', ')}. </>}
                      {assigned.some((x) => x.taskId === t.id) && <>Skills: {assigned.filter((x) => x.taskId === t.id).map((x) => x.skill).join(', ')}. </>}
                      {t.verification && t.verification.slice(-200)}
                    </span>
                  </div>
                ))}
                {msgs.length > 0 && <div className="note" style={{ marginTop: 8 }}>Messages: {msgs.slice(-5).map((m) => `${m.from}→${m.to}${m.delivered ? '' : ' (undelivered)'}: ${m.body.slice(0, 80)}`).join(' | ')}</div>}
              </div>
            )}
            {cur ? (
              <div className="log" ref={logRef}>
                {events.map((e) => { const r = render(e); return r ? <div key={e.seq} className={r.cls}>{r.text}</div> : null })}
              </div>
            ) : <div className="empty" style={{ margin: '0 0 16px' }}>Select a session, or start a Queen to plan work across agents.</div>}
            <div className="composer">
              <input value={msg} placeholder={cur ? 'Message this session…' : 'Select a session to send a message'} disabled={!cur} aria-label="Message to this session"
                onChange={(e) => setMsg(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && cur && msg) { const m = msg; setMsg(''); run(() => window.queen.send(cur.id, m)) } }} />
              <button className="primary" disabled={!cur || !msg} onClick={() => { if (cur && msg) { const m = msg; setMsg(''); run(() => window.queen.send(cur.id, m)) } }}>Send</button>
            </div>
          </div>
        )}

        {/* Issues and approvals: floating glass panel */}
        {!dockOpen && <div className="fab"><button onClick={() => setDockOpen(true)}>Issues &amp; approvals{attention > 0 && <span className={'badge-n' + (openAlerts.length ? '' : ' warn')}>{attention}</span>}</button></div>}
        {dockOpen && (
          <section className="dock glass" aria-label="Issues and approvals">
            <div className="dock-head"><h3>Issues &amp; approvals</h3>
              {attention > 0 && <span className="badge-n warn" style={{ margin: 0 }}>{attention}</span>}
              <span className="spacer" /><button className="ghost sm" onClick={() => setDockOpen(false)} aria-label="Hide panel">✕</button></div>
            <div className="dock-body">
              {attention === 0 && <div className="note" style={{ textAlign: 'center', padding: '16px 0' }}>Nothing needs your attention.</div>}
              {visiblePending.map((p) => p.kind === 'question' ? (
                <div key={p.id} className="req approval"><div className="hd"><span className="pill warn">Question</span><span className="muted">session {p.sessionId.slice(0, 8)}</span></div><div className="note">An agent has {(p.data.questions as string[]).length} question(s) for you.</div><button className="primary sm" onClick={() => { setChatFocus('boss:queen'); setView('chat') }}>Answer in chat</button></div>
              ) : (
                <div key={p.id} className="req approval">
                  <div className="hd"><span className="pill warn">Needs your approval</span><span className="pill mute">{p.kind}</span><span className="muted">session {p.sessionId.slice(0, 8)}</span></div>
                  {p.kind === 'plan' && (<>
                    <div><span className="title">Plan</span> · {p.data.plan.summary}</div>
                    <ol>{p.data.plan.tasks.map((t: any, i: number) => (
                      <li key={i}>{t.title}{t.worker ? ` — ${t.worker}` : ''}<span className="muted">{t.scope?.length ? ` [scope: ${t.scope.join(', ')}]` : ' [scope: whole project]'}{t.deps?.length ? ` (after ${t.deps.join(', ')})` : ''}</span>
                        {t.checks?.length
                          ? <div className="note">Runs on your machine when the worker finishes: {t.checks.map((c: string, k: number) => <code key={k} style={{ marginRight: 6 }}>{c}</code>)}</div>
                          : <div className="note bad">No checks: this task can never be marked verified automatically.</div>}
                      </li>))}</ol>
                    <div className="note">Check commands run with your user permissions. Approve only commands you are happy to run.</div>
                    <input placeholder="Feedback if rejecting" aria-label="Rejection feedback" value={answers[p.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [p.id]: e.target.value })} />
                    <div className="row">
                      <button className="primary" onClick={() => run(() => window.queen.approvePlan(p.id, p.data.hash))}>Approve plan</button>
                      <button className="danger" onClick={() => run(() => window.queen.rejectPlan(p.id, answers[p.id] ?? ''))}>Reject</button>
                    </div>
                  </>)}
                  {p.kind === 'skill' && <SkillApproval data={p.data} onDecide={(allow) => run(() => window.queen.decideSkill(p.id, allow))} />}
                  {p.kind === 'command' && (<>
                    <div><span className="title">{p.data.tool}</span></div>
                    <pre>{p.data.summary}</pre>
                    <div className="row">
                      <button className="primary" onClick={() => run(() => window.queen.decideCommand(p.id, true))}>Allow once</button>
                      <button className="danger" onClick={() => run(() => window.queen.decideCommand(p.id, false))}>Deny</button>
                    </div>
                  </>)}
                </div>
              ))}
              {openAlerts.slice(0, 6).map((a) => (
                <div key={a.id} className={'req' + (a.confidence === 'high' ? ' critical' : '')}>
                  <div className="hd"><span className={'pill ' + (a.confidence === 'high' ? 'bad' : a.confidence === 'medium' ? 'warn' : 'info')}>{a.confidence === 'high' ? 'Critical' : a.confidence === 'medium' ? 'Warning' : 'Info'}</span><span className="title">{a.rule}</span></div>
                  <div className="note">{a.evidence}</div>
                  <div className="muted">{a.taskId ? `Task ${a.taskId} · ` : ''}action: {a.response} · {new Date(a.ts).toLocaleTimeString()}</div>
                  <div><button className="sm" onClick={() => window.queen.dismissAlert(a.id)}>Dismiss</button></div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="strip">
        <span className="stat"><b>{sessions.length}</b>session{sessions.length === 1 ? '' : 's'}</span>
        <span className="stat"><b>{working}</b>working</span>
        {tasks.length > 0 && <span className="stat"><b>{tasks.filter((t) => t.status === 'verified').length}/{tasks.length}</b>tasks verified</span>}
        <span className="stat"><b>{attention}</b>need attention</span>
        <span className="live">{lastLine ? lastLine.text.replace(/\s+/g, ' ').slice(0, 200) : 'No activity from the selected session yet'}</span>
      </footer>
    </div>
  )
}
