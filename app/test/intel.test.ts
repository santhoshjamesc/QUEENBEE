import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, readdirSync, statSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { openDb } from '../src/main/db'
import { CodeIndex } from '../src/main/intel'

const W = (root: string, files: Record<string, string>) => { for (const [p, c] of Object.entries(files)) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c) } }

const TS: Record<string, string> = {
  'src/util.ts': `export function add(a: number, b: number) { return a + b }
export const mul = (a: number, b: number) => a * b
export interface Shape { area(): number }
export type Id = string
export enum Color { Red, Green }
function internalHelper() { return 1 }
export class Calc { run(x: number) { return add(x, internalHelper()) } }
`,
  'src/app.ts': `import { add, Calc } from './util'
import * as lib from './lib/index.js'
import fs from 'node:fs'
export function main() { return add(1, 2) + new Calc().run(3) + lib.ping() }
`,
  'src/lib/index.ts': `export { ping } from './ping'
`,
  'src/lib/ping.ts': `import { main } from '../app'
export function ping() { return typeof main }
`,
  'src/a.ts': `import { b } from './b'
export function a() { return b() }
`,
  'src/b.ts': `import { a } from './a'
export function b() { return a }
`,
  'src/unused.ts': `export function neverCalledAnywhere() { return 42 }
export function usedViaImport() { return 1 }
`,
  'src/user.ts': `import { usedViaImport } from './unused'
export const v = usedViaImport()
`,
  'src/dup1.ts': `export function computeTotal(items: number[]) {
  let total = 0
  for (const i of items) {
    total += i * 2
  }
  return total
}
`,
  'src/dup2.ts': `export function computeTotal(items: number[]) {
  let total = 0
  for (const i of items) {
    total += i * 2
  }
  return total
}
`,
  'src/ren.ts': `export function sumDoubled(values: number[]) {
  let acc = 0
  for (const v of values) {
    acc += v * 3
  }
  return acc
}
`,
  'src/dyn.js': `const x = require('./util')\nmodule.exports = { y: x.add }\n`,
  'node_modules/pkg/index.js': 'export function ignored() {}',
  'README.md': '# not code'
}
const PY: Record<string, string> = {
  'pkg/__init__.py': '',
  'pkg/core.py': `import os\nfrom .helpers import slugify\n\nclass Engine:\n    def start(self):\n        return slugify(os.name)\n\ndef run():\n    return Engine().start()\n\ndef _private():\n    pass\n`,
  'pkg/helpers.py': `def slugify(s):\n    return s.lower()\n\ndef orphan_public():\n    return 1\n`,
  'main.py': `from pkg.core import run\nfrom pkg import helpers\nprint(run(), helpers.slugify("A"))\n`,
  'pkg/c1.py': `from . import c2\n`,
  'pkg/c2.py': `from . import c1\n`
}

let idx: CodeIndex, db: ReturnType<typeof openDb>, ts: string, py: string
beforeAll(async () => {
  db = openDb(':memory:'); idx = new CodeIndex(db)
  ts = realpathSync(mkdtempSync(join(tmpdir(), 'qintel-ts-'))); W(ts, TS)
  py = realpathSync(mkdtempSync(join(tmpdir(), 'qintel-py-'))); W(py, PY)
})

function snapshot(dir: string): string {
  const h = createHash('sha1')
  const walk = (d: string) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); const s = statSync(p); if (s.isDirectory()) walk(p); else h.update(p + s.mtimeMs + s.size + readFileSync(p)) } }
  walk(dir); return h.digest('hex')
}

describe('TypeScript/JavaScript fixture repo', () => {
  it('indexes, ignoring node_modules and non-code files; no parse errors', async () => {
    const st = await idx.index(ts)
    expect(st.parseErrors).toEqual([])
    const files = (db.prepare('SELECT path FROM code_files WHERE root=?').all(ts) as any[]).map((r) => r.path)
    expect(files).toContain('src/util.ts'); expect(files).toContain('src/dyn.js')
    expect(files.some((f: string) => f.includes('node_modules') || f.endsWith('.md'))).toBe(false)
  })
  it('finds symbols with kind, line, export flag and parent', () => {
    const at = (n: string) => idx.symbols(ts, n).find((s) => s.name === n)!
    expect(at('add')).toMatchObject({ path: 'src/util.ts', kind: 'function', line: 1, exported: true })
    expect(at('mul')).toMatchObject({ kind: 'function', exported: true })
    expect(at('Shape').kind).toBe('interface'); expect(at('Id').kind).toBe('type'); expect(at('Color').kind).toBe('enum')
    expect(at('internalHelper')).toMatchObject({ kind: 'function', exported: false })
    expect(at('Calc').kind).toBe('class')
    expect(idx.symbols(ts, 'run').find((s) => s.parent === 'Calc')).toMatchObject({ kind: 'method', path: 'src/util.ts' })
    expect(idx.symbols(ts, 'nonexistentSymbolXyz')).toEqual([])
    expect(idx.symbols(ts, 'ad').map((s) => s.name)).toContain('add') // substring search
  })
  it('reference search excludes the declaration and lists use sites with lines', () => {
    const refs = idx.references(ts, 'add')
    const byPath = Object.fromEntries(refs.map((r) => [r.path, r.lines]))
    expect(byPath['src/app.ts']).toBeDefined(); expect(byPath['src/util.ts']).toEqual([7]) // only the call in Calc.run, not line 1 (declaration)
    expect(byPath['src/dyn.js']).toBeDefined()
  })
  it('resolves relative imports (.js→.ts, index files, re-exports), leaves packages external', () => {
    const im = idx.importsOf(ts, 'src/app.ts')
    expect(im.find((i) => i.spec === './util')).toMatchObject({ resolved: 'src/util.ts', names: ['add', 'Calc'] })
    expect(im.find((i) => i.spec === './lib/index.js')!.resolved).toBe('src/lib/index.ts')
    expect(im.find((i) => i.spec === 'node:fs')!.resolved).toBeUndefined()
    expect(idx.importsOf(ts, 'src/lib/index.ts')[0]).toMatchObject({ spec: './ping', resolved: 'src/lib/ping.ts' })
    expect(idx.importsOf(ts, 'src/dyn.js')[0]).toMatchObject({ spec: './util', resolved: 'src/util.ts' }) // require()
    expect(idx.importersOf(ts, 'src/util.ts')).toEqual(['src/app.ts', 'src/dyn.js'])
  })
  it('detects import cycles (2-file and 3-file) and nothing else', () => {
    expect(idx.cycles(ts)).toEqual([['src/a.ts', 'src/b.ts'], ['src/app.ts', 'src/lib/index.ts', 'src/lib/ping.ts']])
  })
  it('impact = transitive importers with distance', () => {
    expect(idx.impact(ts, 'src/lib/ping.ts')).toEqual([{ path: 'src/lib/index.ts', distance: 1 }, { path: 'src/app.ts', distance: 2 }])
    const u = idx.impact(ts, 'src/util.ts').map((x) => x.path)
    expect(u).toContain('src/app.ts'); expect(u).toContain('src/lib/ping.ts') // ping imports app imports util
    expect(idx.impact(ts, 'src/user.ts')).toEqual([])
  })
  it('flags dead code only when truly unreferenced, with a medium-confidence caveat; skips imported/entry symbols', () => {
    const dead = idx.findings(ts).filter((f) => f.kind === 'dead-code').map((f) => f.items[0].split(':')[0] + ' ' + /"(\w+)"/.exec(f.detail)![1])
    expect(dead).toContain('src/unused.ts neverCalledAnywhere')
    expect(dead).not.toContain('src/unused.ts usedViaImport')
    expect(dead.some((d) => d.endsWith(' main'))).toBe(false)
    expect(idx.findings(ts).filter((f) => f.kind === 'dead-code').every((f) => f.confidence === 'medium' && /cannot be ruled out/.test(f.detail))).toBe(true)
  })
  it('flags exact duplicates (high) and renamed-structure duplicates (medium)', () => {
    const d = idx.findings(ts).filter((f) => f.kind === 'duplicate')
    const exact = d.find((f) => f.confidence === 'high')!
    expect(exact.items.map((i) => i.split(':')[0]).sort()).toEqual(['src/dup1.ts', 'src/dup2.ts'])
    const norm = d.find((f) => f.confidence === 'medium')!
    expect(norm.items.map((i) => i.split(':')[0]).sort()).toEqual(['src/dup1.ts', 'src/dup2.ts', 'src/ren.ts'])
  })
  it('task context: scope globs → files, imports, importers, symbols; title fallback is labelled a guess', () => {
    const c = idx.context(ts, ['src/util.ts'])
    expect(c.files).toEqual(['src/util.ts']); expect(c.importedBy).toEqual(['src/app.ts', 'src/dyn.js']); expect(c.symbols.map((s) => s.name)).toContain('add')
    expect(idx.context(ts, ['src/lib/**']).files).toEqual(['src/lib/index.ts', 'src/lib/ping.ts'])
    const g = idx.context(ts, [], 'refactor the Calc class')
    expect(g.files).toContain('src/util.ts'); expect(g.note).toMatch(/guessed/)
    expect(idx.context(ts, [], 'zzzzqqqq').files).toEqual([])
  })
  it('is incremental: unchanged files are not re-parsed; edits and deletions are picked up', async () => {
    expect((await idx.index(ts)).parsed).toBe(0)
    W(ts, { 'src/util.ts': TS['src/util.ts'] + 'export function brandNew() { return add(1, 1) }\n' })
    const st = await idx.index(ts)
    expect(st.parsed).toBe(1)
    expect(idx.symbols(ts, 'brandNew')[0].path).toBe('src/util.ts')
    rmSync(join(ts, 'src/b.ts'))
    expect((await idx.index(ts)).removed).toBe(1)
    expect(idx.cycles(ts)).toEqual([['src/app.ts', 'src/lib/index.ts', 'src/lib/ping.ts']]) // a↔b cycle gone
  })
  it('READ-ONLY guarantee: indexing and every query leave the project byte-for-byte unchanged', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'qintel-ro-'))); W(dir, TS)
    const before = snapshot(dir)
    await idx.index(dir); idx.symbols(dir, 'add'); idx.references(dir, 'add'); idx.cycles(dir); idx.findings(dir); idx.impact(dir, 'src/util.ts'); idx.context(dir, ['src/**'])
    await idx.index(dir)
    expect(snapshot(dir)).toBe(before)
    expect(readdirSync(dir).sort()).toEqual(['README.md', 'node_modules', 'src'])
  })
  it('does not follow symlinks out of the project', async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'qintel-out-'))); W(outside, { 'secret.ts': 'export function leaked() {}' })
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'qintel-ln-'))); W(dir, { 'a.ts': 'export const a = 1' })
    symlinkSync(outside, join(dir, 'linked')); symlinkSync(join(outside, 'secret.ts'), join(dir, 'link.ts'))
    await idx.index(dir)
    expect(idx.symbols(dir, 'leaked')).toEqual([])
  })
  it('tolerates syntax errors: file still indexed and flagged', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'qintel-err-'))); W(dir, { 'bad.ts': 'export function ok() { return 1 }\nfunction broken( {{{' })
    const st = await idx.index(dir)
    expect(st.parseErrors).toEqual(['bad.ts']); expect(idx.symbols(dir, 'ok').length).toBe(1)
  })
})

describe('Python fixture repo', () => {
  it('symbols, methods, privacy, imports (absolute, relative, from . import), cycle, dead code', async () => {
    await idx.index(py)
    expect(idx.symbols(py, 'Engine')[0]).toMatchObject({ kind: 'class', exported: true, path: 'pkg/core.py' })
    expect(idx.symbols(py, 'start')[0]).toMatchObject({ kind: 'method', parent: 'Engine' })
    expect(idx.symbols(py, '_private')[0].exported).toBe(false)
    expect(idx.importsOf(py, 'pkg/core.py').find((i) => i.spec === '.helpers')).toMatchObject({ resolved: 'pkg/helpers.py', names: ['slugify'] })
    expect(idx.importsOf(py, 'pkg/core.py').find((i) => i.spec === 'os')!.resolved).toBeUndefined()
    expect(idx.importsOf(py, 'main.py').find((i) => i.spec === 'pkg.core')!.resolved).toBe('pkg/core.py')
    expect(idx.importsOf(py, 'main.py').some((i) => i.resolved === 'pkg/helpers.py')).toBe(true) // from pkg import helpers
    expect(idx.cycles(py)).toEqual([['pkg/c1.py', 'pkg/c2.py']])
    const dead = idx.findings(py).filter((f) => f.kind === 'dead-code').map((f) => /"(\w+)"/.exec(f.detail)![1])
    expect(dead).toContain('orphan_public'); expect(dead).not.toContain('slugify'); expect(dead).not.toContain('run')
    expect(idx.impact(py, 'pkg/helpers.py').map((x) => x.path)).toEqual(expect.arrayContaining(['pkg/core.py', 'main.py']))
  })
})
