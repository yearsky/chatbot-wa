#!/usr/bin/env node
// Meniru `claude -p --input-format stream-json --output-format stream-json`:
// satu baris JSON masuk per pesan, satu event "result" keluar per pesan. Proses tetap hidup sampai stdin ditutup.
import readline from 'node:readline'

let turn = 0
const out = (ev) => process.stdout.write(JSON.stringify(ev) + '\n')

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line)
  if (msg.type !== 'user') return
  const text = msg.message.content
  turn++
  out({ type: 'system', subtype: 'init' })
  if (text.includes('CRASH')) process.exit(3)
  if (text.includes('ERROR')) return out({ type: 'result', is_error: true, result: 'limit tercapai' })
  const body = text.includes('catat')
    ? { action: 'add_note', text: 'beli susu', reply: 'ok' }
    : { ok: true }
  out({ type: 'result', is_error: false, result: JSON.stringify({ ...body, pid: process.pid, turn }) })
})
