export type SessionStatus = 'spawning' | 'idle' | 'working' | 'stopped' | 'crashed' | 'error'

export interface SessionInfo {
  id: string // Claude session UUID (we choose it via --session-id)
  name: string
  cwd: string
  status: SessionStatus
  model?: string
  startedAt: number
  role?: SessionRole
  paused?: boolean
}

export interface SessionEvent {
  sessionId: string
  seq: number
  ts: number
  type: string // raw stream-json "type"
  subtype?: string
  payload: unknown
}

export interface StartSessionOptions {
  name: string
  cwd: string
  model?: string
  resumeId?: string
  role?: SessionRole
  /** for workers: the Queen session whose approved plan authorises them */
  queenId?: string
  taskId?: string
  systemPrompt?: string
  /** worker only: generated plugin dir holding exactly the assigned skills (isolates skill discovery) */
  skillPluginDir?: string
}

export type SessionRole = 'queen' | 'worker' | 'plain'

export type PendingKind = 'question' | 'plan' | 'command' | 'skill'
export interface PendingItem {
  id: string
  sessionId: string
  kind: PendingKind
  createdAt: number
  /** question: {questions: string[]}; plan: {plan, hash}; command: {tool, summary, rule}; skill: SkillChangeRequest */
  data: any
}
