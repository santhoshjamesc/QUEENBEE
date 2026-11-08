import type { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join, relative, resolve, sep } from 'node:path'
import { EXT_LANG, extract, resolveImport, resolvePythonNames, type Lang, type TsNode } from './extract'

const IGNORE_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'out', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__', '.claude', '.idea', '.vscode', 'coverage', 'target'])
export const LIMITS = { files: 5000, bytes: 1_000_000 }

export interface IndexStats { files: number; parsed: number; removed: number; skipped: string[]; parseErrors: string[] }
export interface SymbolHit { path: string; name: string; kind: string; line: number; endLine: number; exported: boolean; parent?: string }
export interface Finding { kind: 'cycle' | 'dead-code' | 'duplicate'; confidence: 'high' | 'medium' | 'low'; detail: string; items: string[] }

type ParserCtor = { init(): Promise<void>; new (): { setLanguage(l: unknown): void; parse(s: string): { rootNode: TsNode & { hasError: boolean }; delete(): void } } }

/**
 * Read-only project indexer. It only ever READS project files (lstat/readFile/readdir); everything it
 * produces goes to SQLite in the app data directory. It never writes, formats or fixes code (principle 12).
 * Reference search is by NAME (no type resolution): results are candidates, and the API says so.
 */
export class CodeIndex {
  private langs = new Map<Lang, any>()
  private Parser?: ParserCtor
  constructor(private db: DatabaseSync, private opts: { wasmDir?: string } = {}) {}

  private async parser(lang: Lang) {
    if (!this.Parser) {
      const req = createRequire(__filename)
      const mod = req('web-tree-sitter')
      this.Parser = mod.Parser as ParserCtor
      await this.Parser.init()
      ;(this as any).Language = mod.Language
    }
    if (!this.langs.has(lang)) {
      const dir = this.opts.wasmDir ?? join(createRequire(__filename).resolve('tree-sitter-wasms/package.json'), '..', 'out')
      this.langs.set(lang, await (this as any).Language.load(join(dir, `tree-sitter-${lang}.wasm`)))
    }
    const p = new this.Parser!(); p.setLanguage(this.langs.get(lang)); return p
  }

  private walk(root: string): { files: string[]; skipped: string[] } {
    const files: string[] = [], skipped: string[] = []
    const go = (d: string) => {
      let names: string[] = []
      try { names = readdirSync(d).sort() } catch { return }
      for (const n of names) {
        const p = join(d, n)
        let st; try { st = lstatSync(p) } catch { continue }
        if (st.isSymbolicLink()) continue // never follow links out of the project
        if (st.isDirectory()) { if (!IGNORE_DIRS.has(n)) go(p); continue }
        if (!(extname(n) in EXT_LANG)) continue
        if (st.size > LIMITS.bytes) { skipped.push(relative(root, p).split(sep).join('/') + ' (too large)'); continue }
        if (files.length >= LIMITS.files) { skipped.push(relative(root, p).split(sep).join('/') + ' (file limit)'); continue }
        files.push(relative(root, p).split(sep).join('/'))
      }
    }
    go(root)
    return { files, skipped }
  }

  /** Incremental: only files whose content hash changed are re-parsed; deleted files are dropped. */
  async index(projectRoot: string): Promise<IndexStats> {
    const root = realpathSync(resolve(projectRoot))
    const { files, skipped } = this.walk(root)
    const known = new Map((this.db.prepare('SELECT path,hash FROM code_files WHERE root=?').all(root) as any[]).map((r) => [r.path, r.hash as string]))
    const fileSet = new Set(files)
    let removed = 0
    for (const p of known.keys()) if (!fileSet.has(p)) { this.drop(root, p); removed++ }
    const stats: IndexStats = { files: files.length, parsed: 0, removed, skipped, parseErrors: [] }
    const texts = new Map<string, { text: string; hash: string }>()
    for (const p of files) {
      const text = readFileSync(join(root, p), 'utf8')
      texts.set(p, { text, hash: createHash('sha1').update(text).digest('hex') })
    }
    let n = 0
    for (const p of files) {
      const { text, hash } = texts.get(p)!
      if (known.get(p) === hash) continue
      const lang = EXT_LANG[extname(p)]
      const parser = await this.parser(lang)
      const tree = parser.parse(text)
      const facts = extract(tree.rootNode, lang)
      const err = tree.rootNode.hasError
      tree.delete()
      this.store(root, p, lang, hash, text.length, facts, err)
      if (err) stats.parseErrors.push(p)
      stats.parsed++
      if (++n % 25 === 0) await new Promise((r) => setImmediate(r)) // keep the main process responsive
    }
    // Imports are resolved against the full file set, so re-resolve every file's imports after any change.
    if (stats.parsed || removed) this.resolveAll(root, fileSet)
    return stats
  }

  private drop(root: string, p: string): void {
    for (const t of ['code_files', 'code_symbols', 'code_refs', 'code_imports']) this.db.prepare(`DELETE FROM ${t} WHERE root=? AND path=?`).run(root, p)
  }

  private store(root: string, p: string, lang: Lang, hash: string, size: number, f: ReturnType<typeof extract>, err: boolean): void {
    this.db.exec('BEGIN')
    try {
      this.drop(root, p)
      this.db.prepare('INSERT INTO code_files (root,path,lang,hash,size,indexed_at,parse_error) VALUES (?,?,?,?,?,?,?)').run(root, p, lang, hash, size, Date.now(), err ? 1 : 0)
      const ins = this.db.prepare('INSERT INTO code_symbols (root,path,name,kind,line,end_line,exported,parent,norm_hash,exact_hash,lines) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      for (const s of f.symbols) ins.run(root, p, s.name, s.kind, s.line, s.endLine, s.exported ? 1 : 0, s.parent ?? null, s.normHash ?? null, s.exactHash ?? null, s.lines)
      const r = this.db.prepare('INSERT INTO code_refs (root,path,name,lines,count) VALUES (?,?,?,?,?)')
      for (const [name, lines] of f.refs) r.run(root, p, name, lines.join(','), lines.length)
      const im = this.db.prepare('INSERT INTO code_imports (root,path,spec,resolved,names,line) VALUES (?,?,?,?,?,?)')
      for (const i of f.imports) im.run(root, p, i.spec, null, JSON.stringify(i.names), i.line)
      this.db.exec('COMMIT')
    } catch (e) { this.db.exec('ROLLBACK'); throw e }
  }

  private resolveAll(root: string, files: Set<string>): void {
    const rows = this.db.prepare('SELECT i.rowid AS rid, i.path, i.spec, i.names, f.lang FROM code_imports i JOIN code_files f ON f.root=i.root AND f.path=i.path WHERE i.root=?').all(root) as any[]
    const up = this.db.prepare('UPDATE code_imports SET resolved=? WHERE rowid=?')
    const extra = this.db.prepare('INSERT INTO code_imports (root,path,spec,resolved,names,line) VALUES (?,?,?,?,?,0)')
    this.db.exec('BEGIN')
    try {
      this.db.prepare("DELETE FROM code_imports WHERE root=? AND line=0").run(root) // derived `from . import x` rows
      for (const r of rows) {
        const res = resolveImport(r.path, r.spec, r.lang, files)
        up.run(res ?? null, r.rid)
        if (r.lang === 'python') for (const t of resolvePythonNames(r.path, r.spec, JSON.parse(r.names), files)) extra.run(root, r.path, r.spec, t, r.names)
      }
      this.db.exec('COMMIT')
    } catch (e) { this.db.exec('ROLLBACK'); throw e }
  }

  // ---------------- queries ----------------
  private rootOf(p: string): string { return realpathSync(resolve(p)) }

  symbols(projectRoot: string, query: string, limit = 50): SymbolHit[] {
    const root = this.rootOf(projectRoot)
    const q = query.trim()
    const rows = this.db.prepare(`SELECT * FROM code_symbols WHERE root=? AND (name = ? OR name LIKE ? ESCAPE '\\') ORDER BY (name = ?) DESC, length(name), path LIMIT ?`)
      .all(root, q, '%' + q.replace(/[\\%_]/g, '\\$&') + '%', q, limit) as any[]
    return rows.map((r) => ({ path: r.path, name: r.name, kind: r.kind, line: r.line, endLine: r.end_line, exported: !!r.exported, parent: r.parent ?? undefined }))
  }

  /** Name-based candidates: every identifier with this name outside its declaration. Not type-resolved. */
  references(projectRoot: string, name: string, limit = 100): { path: string; lines: number[] }[] {
    const root = this.rootOf(projectRoot)
    return (this.db.prepare('SELECT path,lines FROM code_refs WHERE root=? AND name=? ORDER BY count DESC, path LIMIT ?').all(root, name, limit) as any[])
      .map((r) => ({ path: r.path, lines: r.lines.split(',').map(Number) }))
  }

  importsOf(projectRoot: string, path: string): { spec: string; resolved?: string; names: string[] }[] {
    const root = this.rootOf(projectRoot)
    return (this.db.prepare('SELECT spec,resolved,names FROM code_imports WHERE root=? AND path=? ORDER BY line').all(root, path) as any[]).map((r) => ({ spec: r.spec, resolved: r.resolved ?? undefined, names: JSON.parse(r.names) }))
  }
  importersOf(projectRoot: string, path: string): string[] {
    const root = this.rootOf(projectRoot)
    return (this.db.prepare('SELECT DISTINCT path FROM code_imports WHERE root=? AND resolved=? AND path<>? ORDER BY path').all(root, path, path) as any[]).map((r) => r.path)
  }

  /** file → files it imports (project-internal only) */
  graph(projectRoot: string): Map<string, Set<string>> {
    const root = this.rootOf(projectRoot)
    const g = new Map<string, Set<string>>()
    for (const r of this.db.prepare('SELECT path FROM code_files WHERE root=?').all(root) as any[]) g.set(r.path, new Set())
    for (const r of this.db.prepare('SELECT DISTINCT path,resolved FROM code_imports WHERE root=? AND resolved IS NOT NULL AND resolved<>path').all(root) as any[]) g.get(r.path)?.add(r.resolved)
    return g
  }

  /** Files that (transitively) import `path`: what a change to it can break. Shortest distance per file. */
  impact(projectRoot: string, path: string): { path: string; distance: number }[] {
    const g = this.graph(projectRoot)
    const rev = new Map<string, string[]>()
    for (const [a, bs] of g) for (const b of bs) (rev.get(b) ?? rev.set(b, []).get(b)!).push(a)
    const seen = new Map<string, number>([[path, 0]]); const q = [path]
    while (q.length) { const x = q.shift()!; for (const y of rev.get(x) ?? []) if (!seen.has(y)) { seen.set(y, seen.get(x)! + 1); q.push(y) } }
    seen.delete(path)
    return [...seen].map(([p, distance]) => ({ path: p, distance })).sort((a, b) => a.distance - b.distance || a.path.localeCompare(b.path))
  }

  /** Strongly connected components with >1 file (or a self-import) = import cycles (iterative Tarjan). */
  cycles(projectRoot: string): string[][] {
    const g = this.graph(projectRoot)
    let idx = 0; const index = new Map<string, number>(), low = new Map<string, number>(), on = new Set<string>(), st: string[] = [], out: string[][] = []
    for (const start of g.keys()) {
      if (index.has(start)) continue
      const work: { v: string; it: Iterator<string> }[] = []
      const enter = (v: string) => { index.set(v, idx); low.set(v, idx); idx++; st.push(v); on.add(v); work.push({ v, it: (g.get(v) ?? new Set()).values() }) }
      enter(start)
      while (work.length) {
        const top = work[work.length - 1]; const nx = top.it.next()
        if (!nx.done) {
          const w = nx.value
          if (!g.has(w)) continue
          if (!index.has(w)) enter(w); else if (on.has(w)) low.set(top.v, Math.min(low.get(top.v)!, index.get(w)!))
        } else {
          work.pop()
          if (work.length) { const p = work[work.length - 1].v; low.set(p, Math.min(low.get(p)!, low.get(top.v)!)) }
          if (low.get(top.v) === index.get(top.v)) {
            const comp: string[] = []; let w: string
            do { w = st.pop()!; on.delete(w); comp.push(w) } while (w !== top.v)
            if (comp.length > 1) out.push(comp.sort())
          }
        }
      }
    }
    return out.sort((a, b) => a[0].localeCompare(b[0]))
  }

  /**
   * Heuristic findings, always labelled with a confidence and never auto-acted on:
   *  - dead code: exported/public top-level symbol with no identifier of that name anywhere else, not imported by name, not an entry/test file
   *  - duplicates: functions (>=6 lines) with identical text (high) or identical token structure (medium)
   */
  findings(projectRoot: string): Finding[] {
    const root = this.rootOf(projectRoot)
    const out: Finding[] = []
    for (const c of this.cycles(root)) out.push({ kind: 'cycle', confidence: 'high', detail: `Import cycle across ${c.length} files`, items: c })

    const imported = new Set<string>()
    for (const r of this.db.prepare('SELECT names FROM code_imports WHERE root=?').all(root) as any[]) for (const n of JSON.parse(r.names)) imported.add(n)
    const syms = this.db.prepare("SELECT path,name,kind,line FROM code_symbols WHERE root=? AND exported=1 AND parent IS NULL").all(root) as any[]
    const refStmt = this.db.prepare('SELECT COUNT(*) c FROM code_refs WHERE root=? AND name=?')
    for (const s of syms) {
      if (/(^|\/)(index|main|__init__|__main__|cli|app)\.[a-z]+$|(^|\/)(test|tests|spec|__tests__)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_/.test(s.path)) continue
      if (s.name === 'default' || s.name === 'main') continue
      if (imported.has(s.name) || imported.has('*')) { if (imported.has(s.name)) continue }
      const refs = (refStmt.get(root, s.name) as any).c as number
      if (refs === 0) out.push({ kind: 'dead-code', confidence: 'medium', detail: `${s.kind} "${s.name}" (exported) is never referenced by name anywhere in the project. Dynamic or external use (public API, reflection, other repos) cannot be ruled out.`, items: [`${s.path}:${s.line}`] })
    }

    for (const col of ['exact_hash', 'norm_hash'] as const) {
      const groups = this.db.prepare(`SELECT ${col} h, COUNT(*) c FROM code_symbols WHERE root=? AND ${col} IS NOT NULL GROUP BY ${col} HAVING c>1`).all(root) as any[]
      for (const g of groups) {
        const items = (this.db.prepare(`SELECT path,name,line FROM code_symbols WHERE root=? AND ${col}=? ORDER BY path,line`).all(root, g.h) as any[]).map((r) => `${r.path}:${r.line} ${r.name}`)
        if (col === 'norm_hash' && out.some((f) => f.kind === 'duplicate' && f.confidence === 'high' && items.every((i) => f.items.includes(i)))) continue
        out.push({ kind: 'duplicate', confidence: col === 'exact_hash' ? 'high' : 'medium', detail: col === 'exact_hash' ? 'Functions with identical text' : 'Functions with identical structure (names/literals differ)', items })
      }
    }
    return out
  }

  /**
   * Bounded context for a task: the files in scope, what they import, who imports them, and their symbols.
   * Used to brief a worker without handing it a whole transcript.
   */
  context(projectRoot: string, scope: string[], title = '', maxFiles = 25): { files: string[]; imports: string[]; importedBy: string[]; symbols: SymbolHit[]; note?: string } {
    const root = this.rootOf(projectRoot)
    const all = (this.db.prepare('SELECT path FROM code_files WHERE root=? ORDER BY path').all(root) as any[]).map((r) => r.path as string)
    const esc = (x: string) => x.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    const globRe = (g: string) => new RegExp('^' + esc(g).replace(/\/\*\*$/, '/.*').replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\u0000/g, '(?:.*/)?') + '$')
    const res = scope.map((s) => (/[*?]/.test(s) ? globRe(s) : new RegExp('^' + s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\/$/, '') + '(?:/|$)')))
    let files = scope.length ? all.filter((f) => res.some((r) => r.test(f))) : []
    let note: string | undefined
    if (!files.length && title) {
      const words = [...new Set(title.toLowerCase().match(/[a-z_][a-z0-9_]{3,}/g) ?? [])].slice(0, 8)
      const scored = new Map<string, number>()
      for (const w of words) for (const s of this.symbols(root, w, 20)) scored.set(s.path, (scored.get(s.path) ?? 0) + 1)
      files = [...scored].sort((a, b) => b[1] - a[1]).map((x) => x[0]).slice(0, 10)
      note = files.length ? 'No scope given: files guessed from words in the task title (symbol-name match).' : 'No scope given and nothing matched the title.'
    }
    files = files.slice(0, maxFiles)
    const set = new Set(files)
    const imports = new Set<string>(), importedBy = new Set<string>()
    for (const f of files) {
      for (const i of this.importsOf(root, f)) if (i.resolved && !set.has(i.resolved)) imports.add(i.resolved)
      for (const i of this.importersOf(root, f)) if (!set.has(i)) importedBy.add(i)
    }
    const symbols = files.flatMap((f) => (this.db.prepare('SELECT * FROM code_symbols WHERE root=? AND path=? ORDER BY line LIMIT 40').all(root, f) as any[]).map((r) => ({ path: r.path, name: r.name, kind: r.kind, line: r.line, endLine: r.end_line, exported: !!r.exported, parent: r.parent ?? undefined })))
    return { files, imports: [...imports].sort().slice(0, 40), importedBy: [...importedBy].sort().slice(0, 40), symbols: symbols.slice(0, 120), note }
  }
}
