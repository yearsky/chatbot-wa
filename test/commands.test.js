import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCommand } from '../src/commands.js'

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
  // format lama tetap jalan
  assert.equal(parseCommand('/remind besok 09:00 x', NOW, TZ).intent.repeat, 'none')
})

test('/remind terjadwal: toleran terhadap autocorrect keyboard HP', () => {
  const variants = [
    '/remind senin\u2013jumat 07:20,17:00 absen', // en dash
    '/remind senin\u2014jumat 07:20,17:00 absen', // em dash
    '/remind Senin - Jumat 07:20,17:00 absen',
    '/remind senin sampai jumat 07:20,17:00 absen',
    '/remind senin s/d jumat 07:20, 17:00 absen',
    '/remind senin-jumat 07:20\u201317:00 absen' // en dash di antara jam
  ]
  for (const v of variants) {
    const r = parseCommand(v, NOW, TZ)
    assert.ok(r.intent, `${v} → ${r.error}`)
    assert.deepEqual(r.intent.schedule, { days: [1, 2, 3, 4, 5], times: ['07:20', '17:00'] })
    assert.equal(r.intent.text, 'absen')
  }
  // Teks reminder tidak ikut diubah
  assert.equal(parseCommand('/remind senin-jumat 07:20 absen \u2013 pagi', NOW, TZ).intent.text, 'absen \u2013 pagi')
  // Format lama tidak terpengaruh
  assert.equal(parseCommand('/remind 10m tes', NOW, TZ).intent.repeat, 'none')
  assert.ok(parseCommand('/remind kapan-kapan x', NOW, TZ).error)
})

test('/done, /del, perintah tak dikenal', () => {
  assert.deepEqual(parseCommand('/done #3', NOW, TZ).intent, { action: 'done', id: 3 })
  assert.deepEqual(parseCommand('/del 4', NOW, TZ).intent, { action: 'delete', id: 4 })
  assert.ok(parseCommand('/del abc', NOW, TZ).error)
  assert.ok(parseCommand('/xyz', NOW, TZ).error)
})
