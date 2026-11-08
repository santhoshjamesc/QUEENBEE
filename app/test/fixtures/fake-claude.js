#!/usr/bin/env node
// Scripted stand-in for `claude -p --input-format stream-json` used by tests (costs nothing).
const args = process.argv.slice(2)
const sid = args[args.indexOf('--session-id') + 1] || args[args.indexOf('--resume') + 1]
if (process.env.FAKE_ARGS_DIR) require('node:fs').writeFileSync(require('node:path').join(process.env.FAKE_ARGS_DIR, sid + '.json'), JSON.stringify(args))
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
out({ type: 'system', subtype: 'init', session_id: sid })
let buf = ''
process.stdin.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1)
    if (!line) continue
    const m = JSON.parse(line)
    if (m.message.content === 'CRASH') process.exit(3)
    if (String(m.message.content).startsWith('HANG')) continue // stays 'working' with no output
    out({ type: 'assistant', message: { content: [{ type: 'text', text: 'echo:' + m.message.content }] } })
    out({ type: 'result', subtype: 'success', session_id: sid, total_cost_usd: 0 })
  }
})
process.stdin.on('end', () => process.exit(0))
