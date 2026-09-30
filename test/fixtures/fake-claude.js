#!/usr/bin/env node
// Meniru `claude -p --output-format json`: baca prompt dari stdin, cetak hasil JSON.
let input = ''
process.stdin.on('data', (d) => (input += d))
process.stdin.on('end', () => {
  const args = process.argv.slice(2)
  const intent = input.includes('catat')
    ? { action: 'add_note', text: 'beli susu', due_at: null, repeat: 'none', id: null, reply: 'ok' }
    : { action: 'add_reminder', text: 'olahraga', due_at: '2026-10-01T07:00:00+07:00', repeat: 'none', id: null, reply: 'ok' }
  const result = '```json\n' + JSON.stringify({ ...intent, args }) + '\n```'
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result }))
})
