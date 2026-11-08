import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'

export const MANIFESTS = new Set(['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'requirements.txt', 'pyproject.toml', 'poetry.lock', 'Cargo.toml', 'Cargo.lock', 'go.mod', 'go.sum', 'Gemfile', 'Gemfile.lock'])

const toPosix = (p: string) => p.split(sep).join('/')

function globToRe(g: string): RegExp {
  g = g.replace(/^\.\//, '').replace(/\/+$/, '')
  let re = ''
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === '*' && g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++ }
    else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp('^' + re + '(/.*)?$') // an entry also covers everything beneath it (directory semantics)
}

/** Is `abs` inside the task scope? Empty scope = whole project. */
export function inScope(scope: string[], root: string, abs: string): boolean {
  if (!scope.length) return true
  const rel = toPosix(relative(root, abs))
  return scope.some((g) => globToRe(g).test(rel))
}

const IMPORT_RE = /(?:from\s+|import\s*\(?\s*|require\(\s*)['"](\.{1,2}\/[^'"]+)['"]|^\s*from\s+(\.+\w*)\s+import/gm
const EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.css', '.py', '/index.ts', '/index.js']

/** Files that an in-scope file directly imports (relative imports only). Cheap, deterministic, read-only. */
export function importedBy(root: string, scopeFiles: string[]): Set<string> {
  const out = new Set<string>()
  for (const f of scopeFiles) {
    if (!existsSync(f)) continue
    let text = ''
    try { text = readFileSync(f, 'utf8') } catch { continue }
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1]; if (!spec) continue
      for (const e of EXTS) { const c = resolve(dirname(f), spec + e); if (existsSync(c)) { out.add(c); break } }
    }
  }
  return out
}

export type ScopeVerdict = { verdict: 'in-scope' | 'dependency' | 'manifest' | 'out-of-scope'; confidence: 'low' | 'medium' | 'high'; evidence: string }

/**
 * Classify a write. `scopeFiles` = existing files currently matched by the scope (callers list them).
 * Out-of-scope but imported by an in-scope file, or a package manifest → allowed with a note, not flagged as a violation.
 */
export function classifyWrite(scope: string[], root: string, abs: string, scopeFiles: string[]): ScopeVerdict {
  if (inScope(scope, root, abs)) return { verdict: 'in-scope', confidence: 'high', evidence: 'matches task scope' }
  const rel = toPosix(relative(root, abs))
  const base = rel.split('/').pop()!
  if (MANIFESTS.has(base) && dirname(abs) === root) return { verdict: 'manifest', confidence: 'medium', evidence: `${rel} is a dependency manifest at the project root; outside declared scope ${JSON.stringify(scope)}` }
  if (importedBy(root, scopeFiles).has(abs)) return { verdict: 'dependency', confidence: 'medium', evidence: `${rel} is imported by an in-scope file` }
  return { verdict: 'out-of-scope', confidence: 'high', evidence: `${rel} does not match scope ${JSON.stringify(scope)} and is not a direct import of in-scope files` }
}
