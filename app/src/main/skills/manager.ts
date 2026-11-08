import type { DatabaseSync } from 'node:sqlite'
import { cpSync, existsSync, lstatSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path'
import {
  MAX_FILE, MAX_FILES, NAME_RE, analyzeSkills, effective, hashFiles, parseFrontmatter, readSkillFiles, scanSkills, searchSkills,
  type SkillInfo, type SkillIssue, type SkillScope
} from './discovery'

export interface SkillChangeRequest {
  skillId: string; name: string; scope: SkillScope; isNew: boolean; requestedBy: string
  /** hash of the on-disk state the user was shown; the write is refused if it changed since */
  baseHash: string | null
  before: Record<string, string> | null
  after: Record<string, string>
  changed: string[]
}
export interface SkillVersion { version: number; hash: string; ts: number; source: string; note: string; files: string[] }
/** Asks the user. Resolves true only if they approve. Implemented by Control (kind 'skill'). */
export type SkillApprover = (sessionId: string, req: SkillChangeRequest) => Promise<boolean>

/**
 * Skills: discovery index, assignment, versioned writes.
 * Hybrid policy (enforced here, not in prompts): reusing an existing skill needs no approval;
 * creating or modifying one needs the user's approval; the user's own restore is user-initiated.
 */
export class SkillManager {
  constructor(private db: DatabaseSync, private opts: { personalRoot: string; tmpBase: string; approve?: SkillApprover }) {}

  private rootOf(scope: SkillScope, projectRoot: string): string {
    return scope === 'personal' ? this.opts.personalRoot : join(projectRoot, '.claude', 'skills')
  }
  private idOf(scope: SkillScope, name: string, projectRoot: string): string {
    return scope === 'personal' ? `personal:${name}` : `project:${resolve(projectRoot)}:${name}`
  }

  scan(projectRoot?: string): SkillInfo[] {
    const all = scanSkills({ personalRoot: this.opts.personalRoot, projectRoot: projectRoot ? resolve(projectRoot) : undefined })
    const now = Date.now()
    const up = this.db.prepare(`INSERT INTO skills_index (id,scope,name,path,description,hash,mtime,seen_at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET path=excluded.path, description=excluded.description, hash=excluded.hash, mtime=excluded.mtime, seen_at=excluded.seen_at`)
    for (const s of all) up.run(s.id, s.scope, s.name, s.dir, s.description, s.hash, s.mtime, now)
    return all
  }
  search(projectRoot: string | undefined, q: string): SkillInfo[] { return searchSkills(this.scan(projectRoot), q) }
  issues(projectRoot?: string): SkillIssue[] { return analyzeSkills(this.scan(projectRoot)) }

  // ---- versions ----
  versions(skillId: string): SkillVersion[] {
    return (this.db.prepare('SELECT version,hash,ts,source,note,files FROM skill_versions WHERE skill_id=? ORDER BY version DESC').all(skillId) as any[])
      .map((r) => ({ version: r.version, hash: r.hash, ts: r.ts, source: r.source, note: r.note, files: Object.keys(JSON.parse(r.files)) }))
  }
  private latest(skillId: string): { version: number; hash: string } | undefined {
    return this.db.prepare('SELECT version,hash FROM skill_versions WHERE skill_id=? ORDER BY version DESC LIMIT 1').get(skillId) as any
  }
  private snapshot(skillId: string, files: Record<string, string>, source: string, note: string): number {
    const v = (this.latest(skillId)?.version ?? 0) + 1
    this.db.prepare('INSERT INTO skill_versions (skill_id,version,hash,files,ts,source,note) VALUES (?,?,?,?,?,?,?)').run(skillId, v, hashFiles(files), JSON.stringify(files), Date.now(), source, note)
    return v
  }

  // ---- validation ----
  private validate(name: string, scope: string, files: Record<string, string>): void {
    if (!NAME_RE.test(name)) throw new Error('invalid skill name (use lowercase letters, digits, - and _)')
    if (scope !== 'project' && scope !== 'personal') throw new Error('scope must be project or personal')
    const paths = Object.keys(files)
    if (!paths.includes('SKILL.md')) throw new Error('SKILL.md is required')
    if (paths.length > MAX_FILES) throw new Error(`too many files (max ${MAX_FILES})`)
    for (const p of paths) {
      const n = normalize(p)
      if (isAbsolute(p) || n.startsWith('..') || n !== p.replace(/\\/g, '/') || p.includes('\0')) throw new Error('unsafe file path: ' + p)
      if (typeof files[p] !== 'string' || files[p].length > MAX_FILE) throw new Error(`file too large or not text: ${p}`)
    }
    if (!parseFrontmatter(files['SKILL.md']).meta.description) throw new Error('SKILL.md needs a frontmatter description')
  }

  /** Writes a skill dir so it contains exactly `files` (text files). Refuses symlinked targets. */
  private writeFiles(dir: string, files: Record<string, string>, previous: Record<string, string> | null): void {
    if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) throw new Error('refusing to write through a symlinked skill directory')
    mkdirSync(dir, { recursive: true })
    for (const p of Object.keys(previous ?? {})) if (!(p in files)) rmSync(join(dir, p), { force: true })
    for (const [p, c] of Object.entries(files)) {
      const f = join(dir, p)
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(f, c)
    }
  }

  /**
   * Create or modify a skill on behalf of an agent. NOTHING is written until the user approves; the approved
   * content is the exact object that is written, and the write is refused if the skill changed meanwhile.
   */
  async propose(sessionId: string, projectRoot: string, a: { name: string; scope?: SkillScope; files: Record<string, string>; note?: string }): Promise<string> {
    const scope: SkillScope = a.scope ?? 'project'
    this.validate(a.name, scope, a.files)
    if (!this.opts.approve) throw new Error('no approval channel available')
    const dir = join(this.rootOf(scope, projectRoot), a.name)
    const id = this.idOf(scope, a.name, projectRoot)
    const before = existsSync(dir) ? readSkillFiles(dir).files : null
    const baseHash = before ? hashFiles(before) : null
    const after = { ...a.files }
    if (baseHash === hashFiles(after)) return 'No change: the skill already has exactly this content.'
    const changed = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after)])].filter((p) => before?.[p] !== after[p])
    const ok = await this.opts.approve(sessionId, { skillId: id, name: a.name, scope, isNew: !before, requestedBy: sessionId, baseHash, before, after, changed })
    if (!ok) throw new Error('The user DENIED this skill change. Nothing was written.')
    // Re-check what is on disk against what the user saw.
    const now = existsSync(dir) ? readSkillFiles(dir).files : null
    if ((now ? hashFiles(now) : null) !== baseHash) throw new Error('The skill changed on disk after approval was requested. Nothing was written; propose again.')
    if (now && !this.latest(id)) this.snapshot(id, now, 'baseline', 'state before the first managed change')
    else if (now && this.latest(id)!.hash !== hashFiles(now)) this.snapshot(id, now, 'external', 'edited outside Queen')
    this.writeFiles(dir, after, now)
    const v = this.snapshot(id, after, 'agent', a.note ?? `${before ? 'modified' : 'created'} by ${sessionId.slice(0, 8)}`)
    this.scan(scope === 'project' ? projectRoot : undefined)
    return `${before ? 'Modified' : 'Created'} ${scope} skill "${a.name}" (version ${v}) after user approval.`
  }

  /** User-initiated restore of an earlier version (the click is the approval). Recorded as a new version. */
  restore(projectRoot: string, skillId: string, version: number): number {
    const row = this.db.prepare('SELECT files FROM skill_versions WHERE skill_id=? AND version=?').get(skillId, version) as any
    if (!row) throw new Error(`no version ${version} for ${skillId}`)
    const m = /^(personal):(.+)$/.exec(skillId) ?? /^(project):(.+):([^:]+)$/.exec(skillId)
    if (!m) throw new Error('bad skill id')
    const scope = m[1] as SkillScope
    const name = scope === 'personal' ? m[2] : m[3]
    if (scope === 'project' && m[2] !== resolve(projectRoot)) throw new Error('skill belongs to another project')
    const dir = join(this.rootOf(scope, projectRoot), name)
    const files = JSON.parse(row.files) as Record<string, string>
    const cur = existsSync(dir) ? readSkillFiles(dir).files : null
    if (cur && !this.latest(skillId)) this.snapshot(skillId, cur, 'baseline', 'state before restore')
    else if (cur && this.latest(skillId)!.hash !== hashFiles(cur)) this.snapshot(skillId, cur, 'external', 'edited outside Queen')
    this.writeFiles(dir, files, cur)
    const v = this.snapshot(skillId, files, 'restore', `restored version ${version}`)
    this.scan(scope === 'project' ? projectRoot : undefined)
    return v
  }

  // ---- assignment ----
  /** Resolve names exactly as Claude Code would (personal beats project). Unknown names are an error. */
  resolveNames(projectRoot: string, names: string[]): SkillInfo[] {
    const all = this.scan(projectRoot)
    return names.map((n) => {
      const s = effective(all, n)
      if (!s) throw new Error(`unknown skill "${n}". Known: ${[...new Set(all.map((x) => x.name))].join(', ') || '(none)'}`)
      return s
    })
  }
  assign(runId: string, taskId: string, projectRoot: string, names: string[]): SkillInfo[] {
    const skills = this.resolveNames(projectRoot, [...new Set(names)])
    this.db.prepare('DELETE FROM skill_assignments WHERE run_id=? AND task_id=?').run(runId, taskId)
    for (const s of skills) this.db.prepare('INSERT INTO skill_assignments VALUES (?,?,?,?)').run(runId, taskId, s.name, s.id)
    return skills
  }
  assignments(runId: string): { taskId: string; skill: string; skillId: string }[] {
    return (this.db.prepare('SELECT task_id,skill_name,skill_id FROM skill_assignments WHERE run_id=? ORDER BY task_id,skill_name').all(runId) as any[])
      .map((r) => ({ taskId: r.task_id, skill: r.skill_name, skillId: r.skill_id }))
  }

  /**
   * Builds a plugin directory (plugin name "queen" → skills appear as queen:<name>) holding a COPY of the
   * assigned skills. The copy pins the version the worker sees. Symlinks are not copied.
   */
  buildPluginDir(key: string, skills: SkillInfo[]): string {
    const dir = join(this.opts.tmpBase, 'skills-' + key)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
    writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'queen', version: '1.0.0', description: 'Skills assigned by Queen' }))
    for (const s of skills) cpSync(s.dir, join(dir, 'skills', s.name), { recursive: true, filter: (src) => !lstatSync(src).isSymbolicLink() })
    return dir
  }
}
