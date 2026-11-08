import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMsg, Person } from '../main/queen/chat'
import type { PendingItem } from '../shared/types'

const fmt = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const ICON: Record<string, string> = { boss: '🧑‍💼', queen: '♛', watchdog: '🐕', worker: '🧑‍💻', system: '⚙️' }

/** A pending question set from an agent, asked one question at a time as chat bubbles. Answers go back once all are given. */
function AskInChat({ item, asker, onAnswer }: { item: PendingItem; asker: string; onAnswer: (answers: string[]) => void }) {
  const qs = item.data.questions as string[]
  const [done, setDone] = useState<string[]>([])
  const [val, setVal] = useState('')
  const i = done.length
  const submit = () => {
    const next = [...done, val.trim()]; setVal('')
    if (next.length === qs.length) onAnswer(next); else setDone(next)
  }
  return (
    <>
      {qs.slice(0, i + 1).map((q, k) => (
        <div key={k} className="ask-pair">
          <div className="bubble q"><div className="who">♛ {asker}{qs.length > 1 && <span className="ts">question {k + 1}/{qs.length}</span>}</div><div className="txt">{q}</div></div>
          {k < i && <div className="bubble me"><div className="who">🧑‍💼 You</div><div className="txt">{done[k] || '(skipped)'}</div></div>}
        </div>
      ))}
      <div className="ask-reply">
        <input autoFocus value={val} placeholder="Type your answer…" aria-label={qs[i]} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <button className="primary" onClick={submit}>{i === qs.length - 1 ? 'Send answers' : 'Next'}</button>
      </div>
    </>
  )
}

/** Chat room: every conversation as plain chat. "Everything" shows all of it; any thread (or Everything) lets you interject. */
export function ChatRoom({ runId, focus, onError, questions = [], onAnswer }: { runId?: string; focus: string; onError: (m: string) => void; questions?: PendingItem[]; onAnswer?: (id: string, answers: string[]) => void }) {
  const [view, setView] = useState<{ messages: ChatMsg[]; people: Person[] }>({ messages: [], people: [] })
  const [thread, setThread] = useState(focus)
  const [to, setTo] = useState('queen')
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => setThread(focus), [focus])
  useEffect(() => {
    if (!runId) return
    let alive = true
    const load = () => window.queen.chatList(runId).then((v) => alive && setView(v)).catch(() => {})
    load(); const t = setInterval(load, 1200)
    return () => { alive = false; clearInterval(t) }
  }, [runId])

  const who = useMemo(() => new Map(view.people.map((p) => [p.key, p])), [view.people])
  const name = (k: string) => (k === 'boss' ? 'You' : who.get(k)?.label ?? k)
  const threads = useMemo(() => {
    const m = new Map<string, ChatMsg[]>()
    for (const x of view.messages) m.set(x.thread, [...(m.get(x.thread) ?? []), x])
    if (!m.has('boss:queen')) m.set('boss:queen', [])
    const title = (th: string) => {
      if (th === 'wd') return '🐕 Watchdog reports'
      const [a, b] = th.startsWith('boss:') ? ['boss', th.slice(5)] : th.split('|')
      return `${name(a)} ↔ ${name(b)}`
    }
    return [...m.entries()].map(([th, msgs]) => ({ th, msgs, title: title(th), last: msgs[msgs.length - 1] }))
      .sort((a, b) => (a.th === 'boss:queen' ? -1 : b.th === 'boss:queen' ? 1 : (b.last?.ts ?? 0) - (a.last?.ts ?? 0)))
  }, [view])
  const shown = thread === 'all' ? view.messages : view.messages.filter((x) => x.thread === thread)
  const sameLen = shown.length
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [sameLen, thread, questions.length])

  // who can the boss talk to here? In a thread: its participants. In Everything: Queen and every worker.
  const options = useMemo(() => {
    const keys = thread === 'all' || thread === 'wd' ? view.people.filter((p) => p.kind === 'queen' || p.kind === 'worker').map((p) => p.key)
      : thread.startsWith('boss:') ? [thread.slice(5)] : thread.split('|')
    return keys.map((k) => who.get(k)).filter((p): p is Person => !!p && (p.kind === 'queen' || p.kind === 'worker'))
  }, [thread, view.people, who])
  useEffect(() => { if (options.length && !options.some((o) => o.key === to)) setTo(options.find((o) => o.live)?.key ?? options[0].key) }, [options])

  const target = who.get(to)
  const send = () => {
    if (!runId || !text.trim()) return
    const t = text; setText('')
    window.queen.chatPost(runId, to, t, thread === 'all' ? undefined : thread).then(() => window.queen.chatList(runId).then(setView))
      .catch((e) => { setText(t); onError(String(e.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) })
  }

  if (!runId) return <div className="empty">Queen is not ready yet.</div>
  return (
    <div className="chatroom">
      <div className="threads">
        <div className={'thread' + (thread === 'all' ? ' on' : '')} onClick={() => setThread('all')}><b>💬 Everything</b><span className="muted">{view.messages.length} messages</span></div>
        {threads.map((t) => (
          <div key={t.th} className={'thread' + (thread === t.th ? ' on' : '')} onClick={() => setThread(t.th)}>
            <b>{t.th === 'boss:queen' ? '♛ ' : ''}{t.title}</b>
            <span className="muted">{t.last ? `${name(t.last.from)}: ${t.last.body.replace(/\s+/g, ' ').slice(0, 48)}` : 'Say hello'}</span>
          </div>))}
      </div>
      <div className="convo">
        <div className="convo-head"><b>{thread === 'all' ? 'Everything' : threads.find((t) => t.th === thread)?.title ?? thread}</b>
          {thread === 'all' && <span className="muted">every conversation, newest at the bottom — reply to anyone</span>}
          {thread !== 'all' && thread !== 'boss:queen' && thread !== 'wd' && <span className="muted">you can interject in this conversation</span>}</div>
        <div className="msgs">
          {shown.length === 0 && <div className="empty">No messages yet.</div>}
          {shown.map((m) => (
            <div key={m.id} className={'bubble ' + (m.from === 'boss' ? 'me' : m.from === 'watchdog' ? 'wd' : m.from === 'queen' ? 'q' : '')}>
              <div className="who">{ICON[who.get(m.from)?.kind ?? 'system']} {name(m.from)}{(thread === 'all' || m.thread.includes('|') || m.thread === 'wd') ? <span className="to"> → {name(m.to)}</span> : null}<span className="ts">{fmt(m.ts)}{m.delivered ? '' : ' · not delivered'}</span></div>
              <div className="txt">{m.body}</div>
            </div>))}
          {questions.map((q) => <AskInChat key={q.id} item={q} asker={view.people.find((p) => p.sessionId === q.sessionId)?.label ?? 'An agent'} onAnswer={(a) => onAnswer?.(q.id, a)} />)}
          <div ref={end} />
        </div>
        <div className="composer">
          <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Send to">
            {options.map((p) => <option key={p.key} value={p.key}>{p.label}{p.live ? '' : ' (not running)'}</option>)}
          </select>
          <input value={text} placeholder={target ? `Message ${target.label}…` : 'Pick someone'} aria-label="Chat message" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
          <button className="primary" disabled={!text.trim() || !target} onClick={send}>Send</button>
        </div>
      </div>
    </div>
  )
}
