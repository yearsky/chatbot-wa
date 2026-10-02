import test from 'node:test'
import assert from 'node:assert/strict'
import { HELP_TEXT, parseCommand } from '../src/commands.js'

const TZ = 'Asia/Jakarta'
const NOW = new Date('2026-09-30T03:00:00Z')

test('bukan perintah → null', () => {
  assert.equal(parseCommand('halo', NOW, TZ), null)
})

test('/note dan /notes', () => {
  assert.deepEqual(parseCommand('/note beli susu', NOW, TZ).intent, { action: 'add_note', text: 'beli susu' })
  assert.ok(parseCommand('/note', NOW, TZ).error)
  assert.equal(parseCommand('/NOTES', NOW, TZ).intent.action, 'list_notes')
})

test('/remind dengan repeat', () => {
  const r = parseCommand('/remind harian 07:00 minum obat', NOW, TZ).intent
  assert.equal(r.action, 'add_reminder')
  assert.equal(r.repeat, 'daily')
  assert.equal(r.text, 'minum obat')
  assert.equal(r.dueAt.toISOString(), '2026-10-01T00:00:00.000Z')
  assert.ok(parseCommand('/remind 10m', NOW, TZ).error)
  assert.ok(parseCommand('/remind kapan-kapan x', NOW, TZ).error)
})

test('/remind terjadwal: <hari> <jam,jam> <teks>', () => {
  // NOW = Rabu 30 Sep 2026 10:00 WIB
  const r = parseCommand('/remind senin-jumat 07:20,17:00 absen', NOW, TZ).intent
  assert.equal(r.action, 'add_reminder')
  assert.equal(r.repeat, 'schedule')
  assert.deepEqual(r.schedule, { days: [1, 2, 3, 4, 5], times: ['07:20', '17:00'] })
  assert.equal(r.text, 'absen')
  assert.equal(r.dueAt.toISOString(), '2026-09-30T10:00:00.000Z') // hari ini 17:00 WIB

  const w = parseCommand('/remind weekend 08:00 siram tanaman', NOW, TZ).intent
  assert.equal(w.dueAt.toISOString(), '2026-10-03T01:00:00.000Z') // Sabtu 08:00 WIB

  assert.match(parseCommand('/remind senin-jumat absen', NOW, TZ).error, /Jam tidak dikenali/)
  assert.match(parseCommand('/remind senin-jumat 07:20,17:00', NOW, TZ).error, /kosong/)
  assert.match(parseCommand('/remind senin-jumat 25:00 x', NOW, TZ).error, /Jam tidak dikenali/)
  assert.equal(parseCommand('/remind besok 09:00 x', NOW, TZ).intent.repeat, 'none')
})

test('/remind terjadwal: format yang diketik pengguna dan autocorrect keyboard HP', () => {
  const variants = [
    '/remind senin-jumat 07:20-17:00 absen',
    '/remind senin–jumat 07:20,17:00 absen',
    '/remind senin—jumat 07:20,17:00 absen',
    '/remind Senin - Jumat 07:20,17:00 absen',
    '/remind senin sampai jumat 07:20 dan 17:00 absen',
    '/remind senin s/d jumat 07:20, 17:00 absen',
    '/remind senin-jumat 07:20–17:00 absen'
  ]
  for (const v of variants) {
    const r = parseCommand(v, NOW, TZ)
    assert.ok(r.intent, `${v} → ${r.error}`)
    assert.deepEqual(r.intent.schedule, { days: [1, 2, 3, 4, 5], times: ['07:20', '17:00'] })
    assert.equal(r.intent.text, 'absen')
  }
  assert.equal(parseCommand('/remind senin-jumat 07:20 absen – pagi', NOW, TZ).intent.text, 'absen – pagi')
  assert.deepEqual(parseCommand('/remind sabtu,minggu 08:00 siram', NOW, TZ).intent.schedule.days, [6, 7])
})

test('/help memuat semua perintah dan contoh reminder terjadwal', () => {
  assert.equal(parseCommand('/help', NOW, TZ).intent.action, 'help')
  for (const cmd of ['/note', '/notes', '/cari', '/remind', '/reminders', '/done', '/del']) {
    assert.ok(HELP_TEXT.includes(cmd), `${cmd} tidak ada di /help`)
  }
  assert.match(HELP_TEXT, /\/remind senin-jumat 07:20,17:00 absen/)
  assert.match(HELP_TEXT, /Format hari/)
  // Setiap contoh /remind di bantuan harus benar-benar bisa diparse.
  for (const line of HELP_TEXT.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('/remind ') && !l.includes('<'))) {
    assert.ok(parseCommand(line, NOW, TZ).intent, `contoh di /help gagal: ${line}`)
  }
})

test('/done, /del, perintah tak dikenal', () => {
  assert.deepEqual(parseCommand('/done #3', NOW, TZ).intent, { action: 'done', id: 3 })
  assert.deepEqual(parseCommand('/del 4', NOW, TZ).intent, { action: 'delete', id: 4 })
  assert.ok(parseCommand('/del abc', NOW, TZ).error)
  assert.ok(parseCommand('/xyz', NOW, TZ).error)
})
