import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'

export type Decision = { decision: 'allow' | 'deny' | 'ask'; reason: string; rule: string }

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const SENSITIVE_BASH: [RegExp, string][] = [
  [/\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+/, 'recursive/forced delete'],
  [/\bsudo\b/, 'sudo'],
  [/\bgit\s+(push|reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s)/, 'destructive git'],
  [/\b(curl|wget)\b[^|]*\|\s*(sh|bash|zsh)/, 'pipe download to shell'],
  [/\b(npm|pnpm|yarn)\s+(publish|install\s+-g)|\bpip\s+install\b|\bnpm\s+(i|install|add)\s+\S/, 'dependency or publish change'],
  [/\bchmod\s+-R|\bchown\b|\bmkfs\b|\bdd\s+if=/, 'system-level change'],
  [/>\s*\/(etc|usr|bin|System)\b/, 'write to system path'],
  // Windows (cmd / PowerShell) equivalents. Unit-tested as patterns only; never run on a Windows machine.
  [/\b(del|erase)\b[^\n]*\s\/[sqf]\b/i, 'recursive/forced delete (cmd)'],
  [/\b(rmdir|rd)\b[^\n]*\s\/s\b/i, 'recursive delete (cmd)'],
  [/\bRemove-Item\b[^\n]*-Recurse/i, 'recursive delete (PowerShell)'],
  [/\bformat\s+[a-z]:/i, 'disk format'],
  [/\b(iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|\n]*\|\s*(iex|Invoke-Expression)\b/i, 'pipe download to shell (PowerShell)']
]

export function real(p: string): string {
  try { return realpathSync(p) } catch {
    try { return resolve(realpathSync(dirname(p)), p.slice(dirname(p).length + 1)) } catch { return resolve(p) }
  }
}
/** Path containment. Windows paths are case-insensitive, so compare lower-cased there. `platform` is injectable for tests. */
export function insidePath(p: string, root: string, platform: string = process.platform, separator: string = sep): boolean {
  if (platform === 'win32') { p = p.toLowerCase(); root = root.toLowerCase() }
  return p === root || p.startsWith(root.endsWith(separator) ? root : root + separator)
}
const inside = (p: string, root: string) => insidePath(p, root)

/** Single policy function. Deterministic; symlinks resolved so they can't escape the project. */
export function decide(tool: string, input: any, projectRoot: string): Decision {
  const root = real(projectRoot)
  if (WRITE_TOOLS.has(tool)) {
    const fp = String(input?.file_path ?? input?.notebook_path ?? '')
    if (!fp) return { decision: 'deny', reason: 'write without a path', rule: 'write-no-path' }
    const abs = real(isAbsolute(fp) ? fp : resolve(root, fp))
    if (!inside(abs, root)) return { decision: 'deny', reason: `write outside project: ${abs}`, rule: 'project-boundary' }
    if (inside(abs, join(root, '.claude', 'skills'))) return { decision: 'deny', reason: 'skills are changed only through the propose_skill tool (needs user approval)', rule: 'skill-protected' }
    return { decision: 'allow', reason: 'inside project', rule: 'project-write' }
  }
  if (tool === 'Bash') {
    const cmd = String(input?.command ?? '')
    for (const [re, why] of SENSITIVE_BASH) if (re.test(cmd)) return { decision: 'ask', reason: `sensitive command (${why}): ${cmd.slice(0, 200)}`, rule: 'sensitive-bash' }
    if (/\.claude[\\/]skills/i.test(cmd) && !/^\s*(ls|cat|head|tail|grep|rg|find|wc|stat|file|diff|sed\s+-n)\b[^;&|>]*$/.test(cmd))
      return { decision: 'ask', reason: `command touches a skills directory: ${cmd.slice(0, 200)}`, rule: 'skill-dir-bash' }
    return { decision: 'allow', reason: 'not sensitive', rule: 'bash-default' }
  }
  return { decision: 'allow', reason: 'tool not restricted', rule: 'default' }
}
