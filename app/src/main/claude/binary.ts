import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

/** Finds the user's installed `claude` binary. Never touches credentials. */
export function findClaudeBinary(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.QUEEN_CLAUDE_BIN && existsSync(env.QUEEN_CLAUDE_BIN)) return env.QUEEN_CLAUDE_BIN
  const exe = process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude']
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean)
  const extra =
    process.platform === 'win32'
      ? [join(homedir(), '.local', 'bin'), join(env.LOCALAPPDATA ?? '', 'Programs', 'claude')]
      : [join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.claude', 'local'), join(homedir(), '.npm-global', 'bin'), join(homedir(), '.volta', 'bin'), join(homedir(), '.bun', 'bin')]
  for (const d of [...dirs, ...extra]) for (const n of exe) {
    const p = join(d, n)
    if (existsSync(p)) return p
  }
  return null
}
