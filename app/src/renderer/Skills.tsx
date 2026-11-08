import { useEffect, useState } from 'react'
import type { SkillInfo, SkillIssue } from '../main/skills/discovery'
import type { SkillVersion } from '../main/skills/manager'

/** Skills panel: discovery, search, issues (duplicate/conflict/outdated), versions + restore. */
export function SkillsPanel({ root, onError }: { root: string | undefined; onError: (m: string) => void }) {
  const [q, setQ] = useState('')
  const [list, setList] = useState<SkillInfo[]>([])
  const [issues, setIssues] = useState<SkillIssue[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [versions, setVersions] = useState<SkillVersion[]>([])
  const load = () => {
    window.queen.searchSkills(root, q).then(setList).catch((e) => onError(String(e.message ?? e)))
    window.queen.skillIssues(root).then(setIssues).catch(() => {})
  }
  useEffect(load, [root, q])
  useEffect(() => { if (open) window.queen.skillVersions(open).then(setVersions); else setVersions([]) }, [open])
  const issuesFor = (id: string) => issues.filter((i) => i.skills.includes(id))
  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <input style={{ flex: 1, maxWidth: 420 }} placeholder="Search name, description, content" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted">{list.length} found{root ? '' : ' (no project selected: personal only)'}</span>
      </div>
      {list.length === 0 && <div className="empty">No skills match. Clear the search or add a skill to this project.</div>}
      <div className="grid">
        {list.map((s) => (
          <div key={s.id} className="card" style={{ marginBottom: 0 }}>
            <div className="card-head">
              <h3>{s.name}</h3>
              <span className="pill mute">{s.scope}</span>
              {s.shadowed && <span className="pill warn">hidden by personal skill</span>}
              {issuesFor(s.id).map((i, k) => <span key={k} className={'pill ' + (i.kind === 'outdated' ? 'bad' : 'warn')} title={i.detail}>{i.kind} · {i.confidence}</span>)}
            </div>
            <div className="muted" style={{ marginBottom: 8 }}>{s.description.slice(0, 160)}</div>
            <a className="link" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? 'Hide versions' : 'Show versions'}</a>
            {open === s.id && (
              <div className="stack" style={{ marginTop: 10 }}>
                {issuesFor(s.id).map((i, k) => <div key={k} className="note bad">{i.detail}</div>)}
                {versions.length === 0 && <div className="note">No managed versions yet. A version is recorded the first time Queen changes this skill.</div>}
                {versions.map((v) => (
                  <div key={v.version} className="note">v{v.version} · {new Date(v.ts).toLocaleString()} · {v.source} · {v.note} · {v.files.join(', ')}{' '}
                    <a className="link" onClick={() => { if (root !== undefined || s.scope === 'personal') window.queen.restoreSkill(root ?? '', s.id, v.version).then(() => { load(); window.queen.skillVersions(s.id).then(setVersions) }).catch((e) => onError(String(e.message ?? e))) }}>Restore</a></div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Approval card body for a skill create/modify request: shows exactly what will be written. */
export function SkillApproval({ data, onDecide }: { data: any; onDecide: (allow: boolean) => void }) {
  return (
    <>
      <div className="title">{data.isNew ? 'Create' : 'Modify'} {data.scope} skill "{data.name}"</div>
      <div className="note">Files: {data.changed.join(', ')}</div>
      {data.changed.map((f: string) => (
        <details key={f} open={data.changed.length <= 2}>
          <summary>{f}{data.before?.[f] === undefined ? ' (new)' : data.after[f] === undefined ? ' (deleted)' : ' (changed)'}</summary>
          {data.before?.[f] !== undefined && <pre className="before">BEFORE:{'\n'}{data.before[f]}</pre>}
          {data.after[f] !== undefined && <pre>AFTER:{'\n'}{data.after[f]}</pre>}
        </details>
      ))}
      <div className="row">
        <button className="primary" onClick={() => onDecide(true)}>Approve and write</button>
        <button className="danger" onClick={() => onDecide(false)}>Deny</button>
      </div>
    </>
  )
}
