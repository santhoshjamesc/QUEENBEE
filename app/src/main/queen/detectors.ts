import type { SessionEvent } from '../../shared/types'

/** Sessions that claim to be working but produced no event for `thresholdMs`. Callers exclude paused/waiting-on-user ones. */
export function inactive(sessions: { id: string; lastEventTs: number }[], now: number, thresholdMs: number): { id: string; idleMs: number }[] {
  return sessions.filter((s) => now - s.lastEventTs > thresholdMs).map((s) => ({ id: s.id, idleMs: now - s.lastEventTs }))
}

const norm = (t: string) => t.replace(/\d+/g, 'N').replace(/\/[^\s'"]+/g, '<path>').replace(/\s+/g, ' ').trim().slice(0, 200)

/** The last `n` tool results are all errors with the same normalised text → stuck in a failure loop. */
export function repeatedFailure(events: SessionEvent[], n = 3): { text: string; count: number } | null {
  const results: { err: boolean; text: string }[] = []
  for (const e of events) {
    if (e.type !== 'user') continue
    for (const b of (e.payload as any)?.message?.content ?? []) if (b?.type === 'tool_result') {
      const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content)
      results.push({ err: !!b.is_error, text: norm(text) })
    }
  }
  const tail = results.slice(-n)
  if (tail.length < n || !tail.every((r) => r.err && r.text === tail[0].text)) return null
  return { text: tail[0].text, count: n }
}

/** Wait-for graph cycle (A waits on B waits on A). Returns the cycle path or null. */
export function waitCycle(edges: [string, string][]): string[] | null {
  const adj = new Map<string, string[]>()
  for (const [a, b] of edges) adj.set(a, [...(adj.get(a) ?? []), b])
  const state = new Map<string, number>()
  const stack: string[] = []
  const dfs = (n: string): string[] | null => {
    state.set(n, 1); stack.push(n)
    for (const m of adj.get(n) ?? []) {
      if (state.get(m) === 1) return [...stack.slice(stack.indexOf(m)), m]
      if (!state.has(m)) { const c = dfs(m); if (c) return c }
    }
    stack.pop(); state.set(n, 2); return null
  }
  for (const n of adj.keys()) if (!state.has(n)) { const c = dfs(n); if (c) return c }
  return null
}
