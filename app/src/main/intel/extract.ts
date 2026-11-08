import { createHash } from 'node:crypto'
import { posix } from 'node:path'

/** Minimal structural view of a web-tree-sitter node (keeps this file independent of the wasm runtime types). */
export interface TsNode {
  type: string; id: number; text: string; startIndex: number; endIndex: number
  startPosition: { row: number }; endPosition: { row: number }
  parent: TsNode | null; children: TsNode[]; namedChildren: TsNode[]
  childForFieldName(n: string): TsNode | null
}
export type Lang = 'typescript' | 'tsx' | 'javascript' | 'python'
export interface Sym { name: string; kind: string; line: number; endLine: number; exported: boolean; parent?: string; normHash?: string; exactHash?: string; lines: number }
export interface Imp { spec: string; names: string[]; line: number; resolved?: string }
export interface FileFacts { symbols: Sym[]; refs: Map<string, number[]>; imports: Imp[] }

export const EXT_LANG: Record<string, Lang> = { '.ts': 'typescript', '.mts': 'typescript', '.cts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.py': 'python' }

const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16)
const IDENT = new Set(['identifier', 'type_identifier', 'property_identifier', 'shorthand_property_identifier', 'shorthand_property_identifier_pattern'])

/** Token-normalised hash: identifiers/strings/numbers collapse, so renamed copies hash equal. */
function normHash(n: TsNode): string {
  const out: string[] = []
  const walk = (x: TsNode) => {
    if (!x.children.length) {
      if (IDENT.has(x.type)) out.push('ID')
      else if (/string|template/.test(x.type)) out.push('STR')
      else if (/number|integer|float/.test(x.type)) out.push('NUM')
      else if (!/comment/.test(x.type)) out.push(x.type)
      return
    }
    if (/comment/.test(x.type)) return
    for (const c of x.children) walk(c)
  }
  walk(n)
  return sha(out.join(' '))
}
const exactHash = (n: TsNode) => sha(n.text.replace(/\s+/g, ' '))

const strip = (s: string) => s.replace(/^['"`]|['"`]$/g, '')

/** Walks a parse tree once and returns symbols, identifier references and imports (unresolved). */
export function extract(root: TsNode, lang: Lang): FileFacts {
  const symbols: Sym[] = []
  const imports: Imp[] = []
  const declNameIds = new Set<number>()
  const exportedNames = new Set<string>()
  const refs = new Map<string, number[]>()
  const isPy = lang === 'python'

  const sym = (node: TsNode, nameNode: TsNode | null, kind: string, exported: boolean, parent?: string, body = true) => {
    if (!nameNode) return
    declNameIds.add(nameNode.id)
    const lines = node.endPosition.row - node.startPosition.row + 1
    const s: Sym = { name: nameNode.text, kind, line: node.startPosition.row + 1, endLine: node.endPosition.row + 1, exported, parent, lines }
    if (body && (kind === 'function' || kind === 'method') && lines >= 6) { s.normHash = normHash(node); s.exactHash = exactHash(node) }
    symbols.push(s)
  }

  const visit = (n: TsNode, ctx: { cls?: string; top: boolean; exported: boolean }) => {
    const t = n.type
    if (!isPy) {
      switch (t) {
        case 'export_statement': {
          const spec = n.children.find((c) => c.type === 'export_clause')
          if (spec) for (const e of spec.namedChildren) { const nm = e.childForFieldName('name') ?? e.namedChildren[0]; if (nm) exportedNames.add(nm.text) }
          const src = n.childForFieldName('source')
          if (src) imports.push({ spec: strip(src.text), names: spec ? spec.namedChildren.map((e) => (e.childForFieldName('name') ?? e.namedChildren[0])?.text).filter(Boolean) : ['*'], line: n.startPosition.row + 1 })
          for (const c of n.namedChildren) visit(c, { ...ctx, exported: true })
          return
        }
        case 'function_declaration': case 'generator_function_declaration':
          sym(n, n.childForFieldName('name'), 'function', ctx.exported && ctx.top); break
        case 'class_declaration': case 'abstract_class_declaration': {
          const nm = n.childForFieldName('name'); sym(n, nm, 'class', ctx.exported && ctx.top, undefined, false)
          for (const c of n.namedChildren) visit(c, { cls: nm?.text, top: false, exported: false }); return
        }
        case 'method_definition': sym(n, n.childForFieldName('name'), 'method', false, ctx.cls); break
        case 'interface_declaration': sym(n, n.childForFieldName('name'), 'interface', ctx.exported && ctx.top, undefined, false); break
        case 'type_alias_declaration': sym(n, n.childForFieldName('name'), 'type', ctx.exported && ctx.top, undefined, false); break
        case 'enum_declaration': sym(n, n.childForFieldName('name'), 'enum', ctx.exported && ctx.top, undefined, false); break
        case 'lexical_declaration': case 'variable_declaration':
          if (ctx.top) for (const d of n.namedChildren) if (d.type === 'variable_declarator') {
            const nm = d.childForFieldName('name'); const v = d.childForFieldName('value')
            if (nm?.type === 'identifier') sym(d, nm, v && /^(arrow_function|function_expression|function)$/.test(v.type) ? 'function' : 'variable', ctx.exported, undefined, !!v && /function/.test(v.type) && true)
          }
          break
        case 'import_statement': {
          const src = n.childForFieldName('source')
          if (src) {
            const names: string[] = []
            const clause = n.namedChildren.find((c) => c.type === 'import_clause')
            const walk = (x: TsNode) => { if (x.type === 'import_specifier') { const nm = x.childForFieldName('name'); if (nm) names.push(nm.text) } else if (x.type === 'namespace_import') names.push('*'); else if (x.type === 'identifier' && x.parent?.type === 'import_clause') names.push('default'); for (const c of x.namedChildren) walk(c) }
            if (clause) walk(clause)
            imports.push({ spec: strip(src.text), names, line: n.startPosition.row + 1 })
          }
          break
        }
        case 'call_expression': {
          const fn = n.childForFieldName('function'); const args = n.childForFieldName('arguments')
          const a0 = args?.namedChildren[0]
          if (fn && a0 && /string/.test(a0.type) && (fn.text === 'require' || fn.type === 'import')) imports.push({ spec: strip(a0.text), names: ['*'], line: n.startPosition.row + 1 })
          break
        }
      }
      for (const c of n.namedChildren) visit(c, { ...ctx, top: ctx.top && (t === 'program' || t === 'export_statement'), exported: false })
      return
    }
    // ---- python ----
    switch (t) {
      case 'function_definition': {
        const nm = n.childForFieldName('name')
        sym(n, nm, ctx.cls ? 'method' : 'function', ctx.top && !!nm && !nm.text.startsWith('_'), ctx.cls)
        for (const c of n.namedChildren) visit(c, { top: false, exported: false }); return
      }
      case 'class_definition': {
        const nm = n.childForFieldName('name'); sym(n, nm, 'class', ctx.top && !!nm && !nm.text.startsWith('_'), undefined, false)
        for (const c of n.namedChildren) visit(c, { cls: nm?.text, top: false, exported: false }); return
      }
      case 'import_statement':
        for (const c of n.namedChildren) { const dn = c.type === 'aliased_import' ? c.childForFieldName('name') : c; if (dn && dn.type === 'dotted_name') imports.push({ spec: dn.text, names: ['*'], line: n.startPosition.row + 1 }) }
        break
      case 'import_from_statement': {
        const mod = n.childForFieldName('module_name')
        const names: string[] = []
        for (const c of n.namedChildren) if (c !== mod) { if (c.type === 'dotted_name') names.push(c.text); else if (c.type === 'aliased_import') names.push(c.childForFieldName('name')?.text ?? ''); else if (c.type === 'wildcard_import') names.push('*') }
        if (mod) imports.push({ spec: mod.text, names: names.filter(Boolean), line: n.startPosition.row + 1 })
        break
      }
      case 'decorated_definition': for (const c of n.namedChildren) visit(c, ctx); return
    }
    for (const c of n.namedChildren) visit(c, { ...ctx, top: ctx.top && t === 'module' })
  }
  visit(root, { top: true, exported: false })

  // JS/TS `export { a }` / `export default a` retroactively marks declarations exported
  for (const s of symbols) if (!s.exported && !s.parent && exportedNames.has(s.name)) s.exported = true

  // references = every identifier that is not itself a declaration name
  const stack: TsNode[] = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (IDENT.has(n.type) && !declNameIds.has(n.id)) {
      const a = refs.get(n.text); const l = n.startPosition.row + 1
      if (a) { if (a.length < 200 && a[a.length - 1] !== l) a.push(l) } else refs.set(n.text, [l])
    }
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i])
  }
  return { symbols, refs, imports }
}

// ---------------- import resolution (pure: against the set of project files) ----------------
const TS_EXT = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

export function resolveImport(fromPath: string, spec: string, lang: Lang, files: Set<string>): string | undefined {
  if (lang === 'python') return resolvePython(fromPath, spec, files)
  if (!spec.startsWith('.')) return undefined // package import: external
  const base = posix.normalize(posix.join(posix.dirname(fromPath), spec))
  const cands = [base]
  const m = /^(.*)\.(js|jsx|mjs|cjs)$/.exec(base)
  if (m) cands.push(m[1] + '.ts', m[1] + '.tsx') // TS ESM style: ./x.js → x.ts
  for (const e of TS_EXT) cands.push(base + e)
  for (const e of TS_EXT) cands.push(posix.join(base, 'index' + e))
  return cands.find((c) => files.has(c))
}

function resolvePython(fromPath: string, spec: string, files: Set<string>): string | undefined {
  const dots = /^\.*/.exec(spec)![0].length
  const rest = spec.slice(dots).replace(/\./g, '/')
  const bases: string[] = []
  if (dots > 0) { let d = posix.dirname(fromPath); for (let i = 1; i < dots; i++) d = posix.dirname(d); bases.push(d === '.' ? '' : d) }
  else bases.push('', 'src')
  for (const b of bases) {
    const p = posix.join(b, rest)
    for (const c of rest ? [p + '.py', posix.join(p, '__init__.py')] : [posix.join(b, '__init__.py')]) if (files.has(c)) return c
  }
  return undefined
}

/** `from pkg import mod` / `from . import mod`: the imported names may themselves be modules of that package. */
export function resolvePythonNames(fromPath: string, spec: string, names: string[], files: Set<string>): string[] {
  const dots = /^\.*/.exec(spec)![0].length
  const rest = spec.slice(dots).replace(/\./g, '/')
  const bases: string[] = []
  if (dots > 0) { let d = posix.dirname(fromPath); for (let i = 1; i < dots; i++) d = posix.dirname(d); bases.push(d === '.' ? '' : d) }
  else bases.push('', 'src')
  const out: string[] = []
  for (const b of bases) {
    const pkg = posix.join(b, rest)
    for (const n of names) for (const c of [posix.join(pkg, n + '.py'), posix.join(pkg, n, '__init__.py')]) if (files.has(c) && !out.includes(c)) out.push(c)
  }
  return out
}
