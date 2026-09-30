#!/usr/bin/env node
// Meniru `codex exec ... --output-last-message <file> -`.
import fs from 'node:fs'
let input = ''
process.stdin.on('data', (d) => (input += d))
process.stdin.on('end', () => {
  const args = process.argv.slice(2)
  const out = args[args.indexOf('--output-last-message') + 1]
  fs.writeFileSync(out, JSON.stringify({ action: 'list_notes', reply: 'ok', args, gotPrompt: input.length > 0 }))
  process.stdout.write('log codex\n')
})
