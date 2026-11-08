import { useState } from 'react'
import type { Finding, SymbolHit } from '../main/intel'

const CONF: Record<string, string> = { high: 'bad', medium: 'warn', low: 'info' }

/** Read-only code intelligence panel: index, symbol/reference search, impact, cycles/dead-code/duplicate findings. */
export function IntelPanel({ root, onError }: { root: string | undefined; onError: (m: string) => void }) {
  const [q, setQ] = useState('')
  const [syms, setSyms] = useState<SymbolHit[]>([])
  const [refs, setRefs] = useState<{ path: string; lines: number[] }[] | null>(null)
  const [impact, setImpact] = useState<{ path: string; distance: number }[] | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [status, setStatus] = useState('')
  if (!root) return <div className="empty">Select a session to choose its project.</div>
  const guard = (f: () => Promise<unknown>) => f().catch((e) => onError(String(e.message ?? e)))
  return (
    <div>
      <div className="card">
        <div className="card-head">
          <button className="primary" onClick={() => guard(async () => { setStatus('Indexing…'); const s = await window.queen.indexCode(root); setStatus(`${s.files} files, ${s.parsed} parsed, ${s.parseErrors.length} with syntax errors${s.skipped.length ? `, ${s.skipped.length} skipped` : ''}`); setFindings(await window.queen.codeFindings(root)) })}>Index / refresh</button>
          <span className="muted">{status || 'Not indexed yet'} · read-only · TypeScript, JavaScript, Python</span>
        </div>
        <div className="row">
          <input style={{ flex: 1, minWidth: 220 }} placeholder="Symbol name or file path" value={q} onChange={(e) => setQ(e.target.value)} />
          <button onClick={() => guard(async () => { setRefs(null); setImpact(null); setSyms(await window.queen.codeSymbols(root, q)) })}>Symbols</button>
          <button onClick={() => guard(async () => { setSyms([]); setImpact(null); setRefs(await window.queen.codeRefs(root, q)) })}>References</button>
          <button onClick={() => guard(async () => { setSyms([]); setRefs(null); setImpact(await window.queen.codeImpact(root, q)) })}>Impact</button>
        </div>
      </div>
      {syms.length > 0 && <div className="card"><h3>Symbols</h3>{syms.map((s, i) => <div key={i} className="muted"><span className="pill mute">{s.kind}</span> <b style={{ color: 'var(--fg)' }}>{s.parent ? s.parent + '.' : ''}{s.name}</b> · {s.path}:{s.line}{s.exported ? ' · exported' : ''}</div>)}</div>}
      {refs && <div className="card"><h3>References</h3><div className="note" style={{ marginBottom: 6 }}>Name-based candidates, not type-resolved.</div>{refs.length === 0 ? <div className="muted">None found.</div> : refs.map((r, i) => <div key={i} className="muted">{r.path}:{r.lines.slice(0, 5).join(',')}</div>)}</div>}
      {impact && <div className="card"><h3>Impact</h3>{impact.length === 0 ? <div className="muted">Nothing imports this file.</div> : impact.map((x, i) => <div key={i} className="muted">{x.path} <span className="pill info">distance {x.distance}</span></div>)}</div>}
      {findings.length > 0 && <div className="grid">{findings.map((f, i) => (
        <div key={i} className="card" style={{ marginBottom: 0 }}>
          <div className="card-head"><h3>{f.kind}</h3><span className={'pill ' + (CONF[f.confidence] ?? 'mute')}>{f.confidence} confidence</span></div>
          <div className="muted" style={{ marginBottom: 6 }}>{f.detail}</div>
          <div className="note">{f.items.join(' · ')}</div>
        </div>))}</div>}
    </div>
  )
}
