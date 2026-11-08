import type { Alert } from '../main/queen/watchdog'
import type { Task, Msg } from '../main/queen/tasks'
import type { SkillInfo, SkillIssue } from '../main/skills/discovery'
import type { SkillVersion } from '../main/skills/manager'
import type { SymbolHit, Finding, IndexStats } from '../main/intel'
import { contextBridge, ipcRenderer } from 'electron'
import type { PendingItem, SessionEvent, SessionInfo, StartSessionOptions } from '../shared/types'

const api = {
  project: () => ipcRenderer.invoke('project:get') as Promise<string | null>,
  recents: () => ipcRenderer.invoke('project:recents') as Promise<string[]>,
  pickProject: () => ipcRenderer.invoke('project:pick') as Promise<void>,
  openProject: (p: string) => ipcRenderer.invoke('project:open', p) as Promise<void>,
  newWindow: () => ipcRenderer.invoke('project:newWindow') as Promise<void>,
  onProjectChanged: (cb: (p: string) => void) => {
    const h = (_: unknown, p: string) => cb(p)
    ipcRenderer.on('project:changed', h)
    return () => ipcRenderer.removeListener('project:changed', h)
  },
  env: () => ipcRenderer.invoke('env:status') as Promise<{ claudeBinary: string | null }>,
  list: () => ipcRenderer.invoke('sessions:list') as Promise<SessionInfo[]>,
  events: (id: string, after = 0) => ipcRenderer.invoke('sessions:events', id, after) as Promise<SessionEvent[]>,
  start: (o: StartSessionOptions) => ipcRenderer.invoke('sessions:start', o) as Promise<SessionInfo>,
  send: (id: string, text: string) => ipcRenderer.invoke('sessions:send', id, text),
  stop: (id: string) => ipcRenderer.invoke('sessions:stop', id),
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<{ maxSessions: number }>,
  setMax: (n: number) => ipcRenderer.invoke('settings:setMax', n),
  rateLimit: () => ipcRenderer.invoke('rate:latest') as Promise<{ ts: number; info: any } | null>,
  pending: () => ipcRenderer.invoke('pending:list') as Promise<PendingItem[]>,
  answer: (id: string, a: string[]) => ipcRenderer.invoke('pending:answer', id, a),
  decideCommand: (id: string, allow: boolean) => ipcRenderer.invoke('pending:command', id, allow),
  approvePlan: (id: string, hash: string) => ipcRenderer.invoke('pending:approvePlan', id, hash),
  rejectPlan: (id: string, fb: string) => ipcRenderer.invoke('pending:rejectPlan', id, fb),
  decideSkill: (id: string, allow: boolean) => ipcRenderer.invoke('pending:skill', id, allow),
  skills: (root?: string) => ipcRenderer.invoke('skills:list', root) as Promise<SkillInfo[]>,
  searchSkills: (root: string | undefined, q: string) => ipcRenderer.invoke('skills:search', root, q) as Promise<SkillInfo[]>,
  skillIssues: (root?: string) => ipcRenderer.invoke('skills:issues', root) as Promise<SkillIssue[]>,
  skillVersions: (id: string) => ipcRenderer.invoke('skills:versions', id) as Promise<SkillVersion[]>,
  restoreSkill: (root: string, id: string, version: number) => ipcRenderer.invoke('skills:restore', root, id, version) as Promise<number>,
  skillAssignments: (runId: string) => ipcRenderer.invoke('skills:assignments', runId) as Promise<{ taskId: string; skill: string; skillId: string }[]>,
  indexCode: (root: string) => ipcRenderer.invoke('intel:index', root) as Promise<IndexStats>,
  codeSymbols: (root: string, q: string) => ipcRenderer.invoke('intel:symbols', root, q) as Promise<SymbolHit[]>,
  codeRefs: (root: string, name: string) => ipcRenderer.invoke('intel:refs', root, name) as Promise<{ path: string; lines: number[] }[]>,
  codeImpact: (root: string, path: string) => ipcRenderer.invoke('intel:impact', root, path) as Promise<{ path: string; distance: number }[]>,
  codeFindings: (root: string) => ipcRenderer.invoke('intel:findings', root) as Promise<Finding[]>,
  staffState: (runId: string) => ipcRenderer.invoke('staff:state', runId) as Promise<{ hires: any[]; economy: { coins: number; earned: number; spent: number; nextCost: number; hires: number }; titles: string[] }>,
  hire: (runId: string, name: string, title: string, profile?: { focus?: string; instructions?: string; allow?: string; deny?: string }) => ipcRenderer.invoke('staff:hire', runId, name, title, profile),
  configureHire: (hireId: string, profile: { focus?: string; instructions?: string; allow?: string; deny?: string }) => ipcRenderer.invoke('staff:configure', hireId, profile),
  chatList: (runId: string) => ipcRenderer.invoke('chat:list', runId) as Promise<import('../main/queen/chat').ChatView>,
  chatPost: (runId: string, to: string, text: string, thread?: string) => ipcRenderer.invoke('chat:post', runId, to, text, thread) as Promise<void>,
  officeSnapshot: (queenId?: string) => ipcRenderer.invoke('office:snapshot', queenId) as Promise<any>,
  officeTerminal: (id: string) => ipcRenderer.invoke('office:terminal', id) as Promise<{ ts: number; command: string; result?: string }[]>,
  onPending: (cb: (l: PendingItem[]) => void) => {
    const h = (_: unknown, l: PendingItem[]) => cb(l)
    ipcRenderer.on('pending:changed', h)
    return () => ipcRenderer.removeListener('pending:changed', h)
  },
  tasks: (runId: string) => ipcRenderer.invoke('tasks:list', runId) as Promise<Task[]>,
  messages: (runId: string) => ipcRenderer.invoke('messages:list', runId) as Promise<Msg[]>,
  alerts: (runId: string) => ipcRenderer.invoke('alerts:list', runId) as Promise<Alert[]>,
  dismissAlert: (id: number) => ipcRenderer.invoke('alerts:dismiss', id),
  pause: (id: string) => ipcRenderer.invoke('sessions:pause', id),
  resume: (id: string) => ipcRenderer.invoke('sessions:resume', id),
  onEvent: (cb: (e: SessionEvent) => void) => {
    const h = (_: unknown, e: SessionEvent) => cb(e)
    ipcRenderer.on('session:event', h)
    return () => ipcRenderer.removeListener('session:event', h)
  },
  onStatus: (cb: (s: SessionInfo) => void) => {
    const h = (_: unknown, s: SessionInfo) => cb(s)
    ipcRenderer.on('session:status', h)
    return () => ipcRenderer.removeListener('session:status', h)
  }
}
contextBridge.exposeInMainWorld('queen', api)
export type QueenApi = typeof api
