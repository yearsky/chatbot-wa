#!/usr/bin/env node
// Meniru `claude -p --output-format stream-json --verbose` dengan server MCP:
// event init berisi status server (dari env FAKE_MCP_STATUS, default "connected"), lalu result.
let input = ''
process.stdin.on('data', (d) => (input += d))
process.stdin.on('end', () => {
  const args = process.argv.slice(2)
  const status = process.env.FAKE_MCP_STATUS || 'connected'
  const servers = status === 'absent' ? [] : [{ name: 'atlassian', status, source: 'dynamic' }]
  const out = (ev) => process.stdout.write(JSON.stringify(ev) + '\n')
  out({ type: 'system', subtype: 'init', mcp_servers: servers, tools: [] })
  // Seperti Claude sungguhan: tetap menjawab walau server gagal (bot harus menghentikannya lebih dulu).
  setTimeout(() => {
    out({ type: 'result', is_error: false, result: `hasil untuk: ${input} | ${JSON.stringify(args)}` })
  }, 300)
})
