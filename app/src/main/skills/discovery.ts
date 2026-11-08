import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export type SkillScope = 'personal' | 'project'
export interface SkillInfo {
  /** `personal:<name>` or `project:<root>:<name>` */
  id: string
  scope: SkillScope
  /** Claude Code identity = DIRECTORY name (verified on 2.1.319; frontmatter `name` is not used for identity). */
  name: string
  dir: string
  description: string
  hash: string
  mtime: number
  /** true when a same-named personal skill hides this project skill (verified: personal wins). */
  shadowed?: boolean
}
export interface SkillIssue { kind: 'duplicate' | 'conflict' | 'outdated'; confidence: 'high' | 'medium' | 'low'; skills: string[]; detail: string }

export const MAX_FILE = 200_000
export const MAX_FILES = 60
export const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** Minimal frontmatter reader: `key: value`, quoted values, and `>`/`|` block scalars. No YAML dependency. */
export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) return { meta: {}, body: text }
  const meta: Record<string, string> = {}
  const lines = m[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i])
    if (!kv) continue
    let v = kv[2].trim()
    if (v === '>' || v === '|' || v === '>-' || v === '|-') {
      const parts: string[] = []
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim())
      v = parts.join(v.startsWith('>') ? ' ' : '\n')
    } else if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1)
    meta[kv[1]] = v
  }
  return { meta, body: m[2] }
}

/** Text files of a skill directory (symlinks, binaries and oversized files are skipped, never followed). */
export function readSkillFiles(dir: string): { files: Record<string, string>; skipped: string[] } {
  const files: Record<string, string> = {}
  const skipped: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e)
      const st = lstatSync(p)
      const rel = relative(dir, p).split(sep).join('/')
      if (st.isSymbolicLink()) { skipped.push(rel + ' (symlink)'); continue }
      if (st.isDirectory()) { walk(p); continue }
      if (Object.keys(files).length >= MAX_FILES) { skipped.push(rel + ' (too many files)'); continue }
      if (st.size > MAX_FILE) { skipped.push(rel + ' (too large)'); continue }
      const buf = readFileSync(p)
      if (buf.includes(0)) { skipped.push(rel + ' (binary)'); continue }
      files[rel] = buf.toString('utf8')
    }
  }
  walk(dir)
  return { files, skipped }
}

export function hashFiles(files: Record<string, string>): string {
  const h = createHash('sha256')
  for (const k of Object.keys(files).sort()) { h.update(k + '\0' + files[k] + '\0') }
  return h.digest('hex')
}

function scanRoot(root: string, scope: SkillScope, projectRoot?: string): SkillInfo[] {
  if (!existsSync(root)) return []
  const out: SkillInfo[] = []
  for (const name of readdirSync(root).sort()) {
    const dir = join(root, name)
    try {
      if (!statSync(dir).isDirectory() || !existsSync(join(dir, 'SKILL.md'))) continue
      const { files } = readSkillFiles(dir)
      const { meta } = parseFrontmatter(files['SKILL.md'] ?? '')
      out.push({
        id: scope === 'personal' ? `personal:${name}` : `project:${projectRoot}:${name}`,
        scope, name, dir, description: meta.description ?? '', hash: hashFiles(files), mtime: statSync(join(dir, 'SKILL.md')).mtimeMs
      })
    } catch { /* unreadable entry: ignore, never crash discovery */ }
  }
  return out
}

/** Discovers personal + project skills and marks shadowing exactly as Claude Code resolves it. */
export function scanSkills(opts: { personalRoot: string; projectRoot?: string }): SkillInfo[] {
  const personal = scanRoot(opts.personalRoot, 'personal')
  const project = opts.projectRoot ? scanRoot(join(opts.projectRoot, '.claude', 'skills'), 'project', opts.projectRoot) : []
  const pnames = new Set(personal.map((s) => s.name))
  for (const s of project) if (pnames.has(s.name)) s.shadowed = true
  return [...personal, ...project]
}

/** The skill Claude Code would actually use for a name (personal beats project). */
export function effective(all: SkillInfo[], name: string): SkillInfo | undefined {
  return all.find((s) => s.name === name && s.scope === 'personal') ?? all.find((s) => s.name === name)
}

export function searchSkills(all: SkillInfo[], query: string): SkillInfo[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return all
  const scored = all.map((s) => {
    let body = ''
    try { body = (readSkillFiles(s.dir).files['SKILL.md'] ?? '').toLowerCase() } catch { /* ignore */ }
    let score = 0
    for (const t of terms) {
      if (s.name.toLowerCase().includes(t)) score += 3
      if (s.description.toLowerCase().includes(t)) score += 2
      if (body.includes(t)) score += 1
    }
    return { s, score }
  })
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => x.s)
}

const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'or', 'for', 'in', 'on', 'with', 'use', 'when', 'is', 'this', 'that', 'it', 'be', 'you', 'your', 'are', 'as', 'at', 'by', 'any', 'all'])
const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w))
function jaccard(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b)
  if (!A.size || !B.size) return 0
  let i = 0
  for (const x of A) if (B.has(x)) i++
  return i / (A.size + B.size - i)
}

/** "always X" / "never X" directives with a normalised object, for conflict heuristics. */
export function directives(body: string): { polarity: 'always' | 'never'; text: string }[] {
  const out: { polarity: 'always' | 'never'; text: string }[] = []
  for (const line of body.split(/\r?\n/)) {
    const m = /\b(always|must|never|do not|don't|must not)\b\s+(.{4,120})/i.exec(line)
    if (!m) continue
    const neg = /^(never|do not|don't|must not)$/i.test(m[1])
    const ws = words(m[2]); while (ws.length && /^(always|never|must|not|dont)$/.test(ws[0])) ws.shift() // "must always X" = "always X"
    const text = ws.slice(0, 6).join(' ')
    if (text.split(' ').length >= 2) out.push({ polarity: neg ? 'never' : 'always', text })
  }
  return out
}

export function analyzeSkills(all: SkillInfo[]): SkillIssue[] {
  const issues: SkillIssue[] = []
  const bodies = new Map<string, string>()
  for (const s of all) { try { bodies.set(s.id, (readSkillFiles(s.dir).files['SKILL.md'] ?? '')) } catch { bodies.set(s.id, '') } }

  for (const s of all) if (s.shadowed)
    issues.push({ kind: 'duplicate', confidence: 'high', skills: [s.id], detail: `Project skill "${s.name}" is hidden by a personal skill with the same name (personal wins in Claude Code).` })

  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j]
    if (a.name === b.name) continue
    const sim = jaccard(words(a.description), words(b.description))
    if (sim >= 0.6) issues.push({ kind: 'duplicate', confidence: sim >= 0.8 ? 'high' : 'medium', skills: [a.id, b.id], detail: `"${a.name}" and "${b.name}" have very similar descriptions (${Math.round(sim * 100)}% word overlap).` })
    const da = directives(parseFrontmatter(bodies.get(a.id) ?? '').body), db = directives(parseFrontmatter(bodies.get(b.id) ?? '').body)
    for (const x of da) for (const y of db) if (x.polarity !== y.polarity && x.text === y.text)
      issues.push({ kind: 'conflict', confidence: 'low', skills: [a.id, b.id], detail: `"${a.name}" says ${x.polarity} "${x.text}" while "${b.name}" says ${y.polarity} it. Heuristic: review manually.` })
  }

  for (const s of all) {
    const body = parseFrontmatter(bodies.get(s.id) ?? '').body
    const refs = new Set<string>()
    for (const m of body.matchAll(/\]\(([^)#\s]+)\)|`((?:\.\/)?(?:scripts|references|assets|templates|examples)\/[^`\s]+)`/g)) {
      const r = m[1] ?? m[2]
      if (r && !/^[a-z]+:/i.test(r) && !r.startsWith('/') && !r.includes('..')) refs.add(r.replace(/^\.\//, ''))
    }
    for (const r of refs) {
      const p = join(s.dir, r)
      if (!existsSync(p)) issues.push({ kind: 'outdated', confidence: 'medium', skills: [s.id], detail: `"${s.name}" refers to ${r}, which does not exist.` })
      else if (statSync(p).mtimeMs > s.mtime + 1000) issues.push({ kind: 'outdated', confidence: 'low', skills: [s.id], detail: `${r} is newer than SKILL.md of "${s.name}"; the instructions may be stale.` })
    }
  }
  return issues
}
