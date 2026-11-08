import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { basename } from 'node:path'
import { writeFileSync } from 'node:fs'
import hookSource from './queen/hook-bridge.js?raw'
import { Control } from './queen/control'
import { TaskStore } from './queen/tasks'
import { Orchestrator } from './queen/orchestrator'
import { Watchdog } from './queen/watchdog'
import { Staff, TITLES, type HireProfile } from './queen/staff'
import { Chat } from './queen/chat'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { SkillManager } from './skills/manager'
import { CodeIndex } from './intel'
import { openDb } from './db'
import { Store } from './store'
import { SessionManager } from './sessions'
import { findClaudeBinary } from './claude/binary'
import type { StartSessionOptions } from '../shared/types'

app.setName('Queen')
const ICON_PATH = join(__dirname, '../../build/icon.png')

/** One window per project (like VS Code). `project` is null for an empty "welcome" window. */
const windows = new Map<number, { win: BrowserWindow; project: string | null }>()
const broadcast = (ch: string, payload: unknown) => { for (const { win } of windows.values()) if (!win.isDestroyed()) win.webContents.send(ch, payload) }

app.whenReady().then(async () => {
  if (process.platform === 'darwin') { try { app.dock?.setIcon(ICON_PATH) } catch { /* icon missing in packaged build; bundle icon is used */ } }
  const store = new Store(openDb(join(app.getPath('userData'), 'queen.db')))
  store.recoverOrphans()
  const binary = findClaudeBinary()
  const control = new Control()
  await control.listen()
  const hookScript = join(app.getPath('userData'), 'hook-bridge.js')
  writeFileSync(hookScript, hookSource)
  const sessions = binary ? new SessionManager(store, binary, Number(store.getSetting('maxSessions') ?? 5), control, hookScript) : null

  const taskStore = new TaskStore(store.raw)
  const intel = new CodeIndex(store.raw, { wasmDir: app.isPackaged ? join(process.resourcesPath, 'grammars') : undefined })
  ipcMain.handle('intel:index', (_e, root: string) => intel.index(root))
  ipcMain.handle('intel:symbols', (_e, root: string, q: string) => intel.symbols(root, q))
  ipcMain.handle('intel:refs', (_e, root: string, name: string) => intel.references(root, name))
  ipcMain.handle('intel:impact', (_e, root: string, path: string) => intel.impact(root, path))
  ipcMain.handle('intel:findings', (_e, root: string) => intel.findings(root))
  const skills = new SkillManager(store.raw, {
    personalRoot: join(homedir(), '.claude', 'skills'), tmpBase: join(tmpdir(), 'queen-' + process.pid),
    approve: (sid, req) => control.requestSkillChange(sid, req)
  })
  const staff = new Staff(store.raw, taskStore)
  const liveStatus = new Set(['spawning', 'idle', 'working'])
  const chat = new Chat(store.raw, taskStore, staff, (id) => watchdog?.alerts(id) ?? [],
    (sid) => { const x = store.listSessions().find((y) => y.id === sid); return !!x && liveStatus.has(x.status) },
    (sid, text) => need(sessions).send(sid, text))
  if (sessions) new Orchestrator(control, sessions, taskStore, undefined, skills, intel, staff)
  ipcMain.handle('staff:state', (_e, runId: string) => ({ hires: staff.list(runId), economy: staff.economy(runId), titles: TITLES }))
  ipcMain.handle('staff:hire', (_e, runId: string, name: string, title: string, profile?: HireProfile) => {
    if (!store.listSessions().some((x) => x.id === runId && x.role === 'queen')) throw new Error('unknown Queen')
    return staff.hire(runId, String(name ?? ''), String(title ?? ''), profile ?? {})
  })
  ipcMain.handle('staff:configure', (_e, hireId: string, profile: HireProfile) => staff.configure(String(hireId), profile ?? {}))
  ipcMain.handle('chat:list', (_e, runId: string) => chat.list(runId))
  ipcMain.handle('chat:post', (_e, runId: string, to: string, text: string, thread?: string) => chat.post(runId, String(to), String(text), thread))
  ipcMain.handle('skills:list', (_e, root?: string) => skills.scan(root))
  ipcMain.handle('skills:search', (_e, root: string | undefined, q: string) => skills.search(root, q))
  ipcMain.handle('skills:issues', (_e, root?: string) => skills.issues(root))
  ipcMain.handle('skills:versions', (_e, id: string) => skills.versions(id))
  ipcMain.handle('skills:restore', (_e, root: string, id: string, version: number) => {
    const v = skills.restore(root, id, version)
    store.logDecision('user', 'skill-restore', `${id} -> version ${version}`, 'restored as v' + v)
    return v
  })
  ipcMain.handle('skills:assignments', (_e, runId: string) => skills.assignments(runId))
  const watchdog = sessions ? new Watchdog(store, sessions, control, taskStore) : null
  const watched = new Set<string>()
  if (watchdog) watchdog.profileOf = (sid) => staff.ofSession(sid)
  watchdog?.on('alert', (a) => broadcast('watchdog:alert', a))
  ipcMain.handle('alerts:list', (_e, runId: string) => watchdog?.alerts(runId) ?? [])
  ipcMain.handle('alerts:dismiss', (_e, id: number) => watchdog?.dismiss(id))
  ipcMain.handle('sessions:pause', (_e, id: string) => need(sessions).pause(id))
  ipcMain.handle('sessions:resume', (_e, id: string) => need(sessions).resume(id))
  // ---- office: raw, real inputs only (the office derives everything from these) ----
  ipcMain.handle('office:snapshot', (_e, queenId?: string) => {
    const sess = store.listSessions().map((x) => ({ ...x, paused: sessions?.isPaused(x.id) ?? false }))
    const tasks = queenId ? taskStore.list(queenId) : []
    const ids = [...new Set([...(queenId ? [queenId] : []), ...tasks.flatMap((t) => (t.assignee ? [t.assignee] : []))])]
    const last: Record<string, { type: string; ts: number; tool: boolean }> = {}
    for (const id of ids) { const e = store.lastActivityEvent(id); if (e) last[id] = e }
    const files = queenId ? (store.raw.prepare('SELECT ts,path,kind,source,sessions FROM file_activity WHERE run_id=? ORDER BY id DESC LIMIT 60').all(queenId) as any[]).map((r) => ({ ts: r.ts, path: r.path, kind: r.kind, source: r.source, sessions: JSON.parse(r.sessions) as string[] })) : []
    return {
      now: Date.now(), queenId, sessions: sess, hires: queenId ? (() => { const busy = staff.busyIds(); const mine = new Set(tasks.map((t) => t.assignee)); return staff.list(queenId).map((h) => ({ ...h, elsewhere: busy.has(h.id) && !mine.has(h.sessionId) })) })() : [], economy: queenId ? staff.economy(queenId) : null,
      tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, assignee: t.assignee, scope: t.scope })),
      pending: control.pending(), alerts: queenId ? watchdog?.alerts(queenId) ?? [] : [],
      messages: queenId ? taskStore.messages(queenId).slice(-60) : [], last, files, assignments: queenId ? skills.assignments(queenId) : []
    }
  })
  ipcMain.handle('office:terminal', (_e, id: string) => store.recentCommands(id))
  ipcMain.handle('tasks:list', (_e, runId: string) => taskStore.list(runId))
  ipcMain.handle('messages:list', (_e, runId: string) => taskStore.messages(runId))
  const RECENT_KEY = 'recentProjects'
  const recents = (): string[] => { try { return JSON.parse(store.getSetting(RECENT_KEY) ?? '[]') } catch { return [] } }
  const addRecent = (p: string) => { store.setSetting(RECENT_KEY, JSON.stringify([p, ...recents().filter((x) => x !== p)].slice(0, 10))); buildMenu() }
  const titleOf = (project: string | null) => (project ? `${basename(project)} — Queen` : 'Queen')

  const createWindow = (project: string | null = null): BrowserWindow => {
    const w = new BrowserWindow({
      width: 1280, height: 800, title: titleOf(project), icon: ICON_PATH,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    const id = w.webContents.id
    windows.set(id, { win: w, project })
    w.on('closed', () => windows.delete(id))
    if (process.env.ELECTRON_RENDERER_URL) w.loadURL(process.env.ELECTRON_RENDERER_URL)
    else w.loadFile(join(__dirname, '../renderer/index.html'))
    if (project) addRecent(project)
    return w
  }
  /** Open a folder: focus its window if already open, reuse the calling window if it is empty, else a new window. */
  const openProject = (project: string, from?: BrowserWindow | null) => {
    for (const x of windows.values()) if (x.project === project) { if (x.win.isMinimized()) x.win.restore(); x.win.focus(); return }
    const entry = from ? windows.get(from.webContents.id) : undefined
    if (entry && !entry.project) {
      entry.project = project; entry.win.setTitle(titleOf(project)); addRecent(project)
      entry.win.webContents.send('project:changed', project)
    } else createWindow(project)
  }
  const pickAndOpen = async (from?: BrowserWindow | null) => {
    const opts = { properties: ['openDirectory' as const, 'createDirectory' as const], title: 'Open project folder' }
    const r = from ? await dialog.showOpenDialog(from, opts) : await dialog.showOpenDialog(opts)
    if (!r.canceled && r.filePaths[0]) openProject(r.filePaths[0], from)
  }
  const buildMenu = () => {
    const focused = () => BrowserWindow.getFocusedWindow()
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { label: 'File', submenu: [
        { label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow() },
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: () => pickAndOpen(focused()) },
        { label: 'Open Recent', submenu: recents().length
          ? recents().map((p) => ({ label: p, click: () => openProject(p, focused()) }))
          : [{ label: 'No recent projects', enabled: false }] },
        { type: 'separator' }, { role: 'close' }
      ] },
      { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }
    ]))
  }
  buildMenu()
  ipcMain.handle('project:get', (e) => windows.get(e.sender.id)?.project ?? null)
  ipcMain.handle('project:recents', () => recents())
  ipcMain.handle('project:pick', (e) => pickAndOpen(BrowserWindow.fromWebContents(e.sender)))
  ipcMain.handle('project:open', (e, p: string) => openProject(p, BrowserWindow.fromWebContents(e.sender)))
  ipcMain.handle('project:newWindow', () => { createWindow() })
  ipcMain.handle('env:status', () => ({ claudeBinary: binary }))
  ipcMain.handle('sessions:list', () => store.listSessions())
  ipcMain.handle('sessions:events', (_e, id: string, after: number) => store.events(id, after))
  ipcMain.handle('sessions:start', (_e, o: StartSessionOptions) => {
    const info = need(sessions).start(o)
    if (o.role === 'queen' && !watched.has(o.cwd)) { watched.add(o.cwd); watchdog?.watchProject(o.cwd, info.id) }
    return info
  })
  ipcMain.handle('sessions:send', (_e, id: string, text: string) => {
    need(sessions).send(id, text)
    const sess = store.listSessions().find((x) => x.id === id)
    if (sess?.role === 'queen') chat.logBossToSession(id, id, text)
    else if (sess?.role === 'worker') { const r = taskStore.byAssignee(id)?.runId ?? staff.ofSession(id)?.runId; if (r) chat.logBossToSession(r, id, text) }
  })
  ipcMain.handle('sessions:stop', (_e, id: string) => need(sessions).stop(id))

  ipcMain.handle('settings:get', () => ({ maxSessions: sessions?.max ?? 5 }))
  ipcMain.handle('settings:setMax', (_e, n: number) => need(sessions).setMax(n))
  ipcMain.handle('rate:latest', () => store.latestRateLimit() ?? null)
  ipcMain.handle('pending:list', () => control.pending())
  ipcMain.handle('pending:answer', (_e, id: string, answers: string[]) => { logP(id, 'answered'); control.answer(id, answers) })
  ipcMain.handle('pending:command', (_e, id: string, allow: boolean) => { logP(id, allow ? 'allowed' : 'denied'); control.decideCommand(id, allow) })
  ipcMain.handle('pending:approvePlan', (_e, id: string, hash: string) => { control.approvePlan(id, hash); logP(id, 'approved') })
  ipcMain.handle('pending:rejectPlan', (_e, id: string, fb: string) => { logP(id, 'rejected: ' + fb); control.rejectPlan(id, fb) })
  ipcMain.handle('pending:skill', (_e, id: string, allow: boolean) => { logP(id, allow ? 'allowed' : 'denied'); control.decideSkill(id, allow) })
  ipcMain.handle('decisions:list', (_e, id: string) => store.decisions(id))
  const logP = (id: string, outcome: string) => {
    const p = control.pending().find((x) => x.id === id)
    if (p) store.logDecision(p.sessionId, p.kind, p.kind === 'skill' ? `${p.data.scope} skill ${p.data.name}: ${p.data.changed.join(', ')}` : JSON.stringify(p.data), outcome)
  }
  control.on('pending', (l) => broadcast('pending:changed', l))
  control.on('decision', (d) => store.logDecision(d.sessionId, 'policy', `${d.tool}: ${d.reason}`, d.decision))

  // Packaged-app self test (no window): proves sqlite, grammars, hook script and binary discovery work in this build.
  if (process.env.QUEEN_SELFTEST) {
    try {
      const dir = process.env.QUEEN_SELFTEST
      const st = await intel.index(dir)
      const out = { packaged: app.isPackaged, electron: process.versions.electron, node: process.versions.node, claudeBinary: binary, hookScriptBytes: hookSource.length,
        dbVersion: (store.raw.prepare('select max(v) v from schema_version').get() as any).v, indexed: st.files, parsed: st.parsed, parseErrors: st.parseErrors.length,
        symbols: intel.symbols(dir, 'add').length, controlPort: control.port }
      process.stdout.write('SELFTEST ' + JSON.stringify(out) + '\n'); app.exit(0)
    } catch (e: any) { process.stdout.write('SELFTEST_FAIL ' + String(e?.stack ?? e) + '\n'); app.exit(1) }
    return
  }
  sessions?.on('event', (e) => {
    broadcast('session:event', e)
    if (e.type === 'assistant') {
      const text = ((e.payload as any)?.message?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
      if (text.trim()) { try { chat.onAssistantText(e.sessionId, text) } catch { /* chat logging must never break a session */ } }
    }
  })
  sessions?.on('status', (x) => broadcast('session:status', x))
  createWindow(null)
  app.on('activate', () => { if (windows.size === 0) createWindow(null) })
  app.on('before-quit', () => { sessions?.stopAll(); watchdog?.close(); control.close() })
})

app.on('window-all-closed', () => app.quit())

function need<T>(x: T | null): T {
  if (!x) throw new Error('Claude Code binary not found. Install Claude Code and log in with `claude`.')
  return x
}
