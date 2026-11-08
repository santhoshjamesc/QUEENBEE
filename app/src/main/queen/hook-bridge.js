// Runs as Claude Code's PreToolUse command hook: forwards the hook JSON to Queen's control server and prints its decision.
const [port, token] = process.argv.slice(2)
let body = ''
process.stdin.on('data', (d) => (body += d))
process.stdin.on('end', async () => {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/hook/${token}`, { method: 'POST', body, headers: { 'content-type': 'application/json' } })
    process.stdout.write(await r.text())
  } catch (e) {
    // fail closed: if Queen is unreachable, deny rather than silently allow
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Queen control server unreachable' } }))
  }
})
