import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Store, ftsQuery } from '../src/db.js'

const TZ = 'Asia/Jakarta'

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wa-store-'))
}

test('catatan & reminder tersimpan ke SQLite dan bisa dibaca ulang', () => {
  const file = path.join(tempDir(), 'assistant.db')
  const s = new Store(file)
  const n = s.addNote('beli susu')
  const r = s.addReminder('bayar listrik', new Date('2026-10-01T02:00:00Z'))
  assert.notEqual(n.id, r.id)
  s.close()

  const s2 = new Store(file)
  assert.equal(s2.listNotes()[0].text, 'beli susu')
  assert.equal(s2.listReminders()[0].text, 'bayar listrik')
  assert.equal(s2.listReminders()[0].dueAt, '2026-10-01T02:00:00.000Z')
  s2.close()
})

test('remove, markDone, dueReminders, afterFire', () => {
  const s = new Store(null)
  const now = new Date('2026-09-30T03:00:00Z')
  const once = s.addReminder('sekali', new Date('2026-09-30T02:59:00Z'))
  const daily = s.addReminder('harian', new Date('2026-09-30T00:00:00Z'), 'daily')
  const later = s.addReminder('nanti', new Date('2026-10-30T00:00:00Z'))

  assert.deepEqual(s.dueReminders(now).map((r) => r.id), [daily.id, once.id])

  s.afterFire(once.id, now, TZ)
  s.afterFire(daily.id, now, TZ)
  assert.equal(s.find(once.id).item.status, 'done')
  assert.equal(s.find(daily.id).item.dueAt, '2026-10-01T00:00:00.000Z')
  assert.equal(s.dueReminders(now).length, 0)

  assert.equal(s.markDone(later.id).status, 'done')
  assert.equal(s.markDone(later.id), null)
  assert.equal(s.remove(daily.id).type, 'reminder')
  assert.equal(s.remove(999), null)
})

test('memory bank: pencarian FTS5, konteks relevan, dan sinkron setelah hapus', () => {
  const s = new Store(null)
  s.addNote('Nomor meja kantor 12 di lantai 3')
  const wifi = s.addNote('Password wifi rumah ada di belakang router')
  s.addNote('Golongan darah Kai: O')
  for (let i = 0; i < 15; i++) s.addNote(`catatan acak ${i}`)

  assert.deepEqual(s.searchNotes('meja aku berapa?').map((n) => n.id), [1])
  assert.deepEqual(s.searchNotes('WIFI').map((n) => n.id), [wifi.id]) // tidak peka huruf besar
  assert.deepEqual(s.searchNotes('rout').map((n) => n.id), [wifi.id]) // prefiks
  assert.deepEqual(s.searchNotes('apa itu ya'), []) // hanya stopword

  // Catatan relevan yang lama tetap ikut, ditambah 10 terbaru.
  const ctx = s.relevantNotes('nomor meja aku berapa?')
  assert.ok(ctx.some((n) => n.id === 1))
  assert.equal(ctx.length, 11)
  assert.equal(s.countNotes(), 18)

  s.remove(wifi.id)
  assert.deepEqual(s.searchNotes('wifi'), [])
})

test('ftsQuery membuang stopword dan meng-escape token', () => {
  assert.equal(ftsQuery('tolong catat nomor "meja"'), '"nomor"* OR "meja"*')
  assert.equal(ftsQuery('ya'), null)
  assert.equal(ftsQuery('kode 12'), '"kode"* OR "12"*')
})

test('reminder terjadwal tersimpan dan maju ke jadwal berikutnya', () => {
  const file = path.join(tempDir(), 'assistant.db')
  const s = new Store(file)
  const schedule = { days: [1, 2, 3, 4, 5], times: ['07:20', '17:00'] }
  // Jumat 2 Okt 2026 17:00 WIB
  const r = s.addReminder('absen', new Date('2026-10-02T10:00:00Z'), 'schedule', new Date(), schedule)
  s.close()
  const s2 = new Store(file)
  assert.deepEqual(s2.find(r.id).item.schedule, schedule)

  // Terkirim tepat waktu → Senin 07:20 WIB
  s2.afterFire(r.id, new Date('2026-10-02T10:00:20Z'), TZ)
  assert.equal(s2.find(r.id).item.dueAt, '2026-10-05T00:20:00.000Z')
  assert.equal(s2.find(r.id).item.status, 'pending')

  // Bot mati sampai Senin 09:00 → kirim sekali (terlambat), lalu lanjut Senin 17:00
  s2.afterFire(r.id, new Date('2026-10-05T02:00:00Z'), TZ)
  assert.equal(s2.find(r.id).item.dueAt, '2026-10-05T10:00:00.000Z')

  assert.equal('schedule' in s2.addReminder('x', new Date('2026-10-10T00:00:00Z')), false)
  s2.close()
})

test('file .db lama tanpa kolom schedule ditambah kolomnya saat dibuka', async () => {
  const file = path.join(tempDir(), 'assistant.db')
  const { DatabaseSync } = await import('node:sqlite')
  const old = new DatabaseSync(file)
  old.exec(`CREATE TABLE entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, text TEXT NOT NULL, due_at TEXT,
    repeat TEXT NOT NULL DEFAULT 'none', status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, fired_at TEXT)`)
  old.prepare('INSERT INTO entries (kind, text, due_at, created_at) VALUES (?, ?, ?, ?)').run('reminder', 'lama', '2026-10-01T00:00:00.000Z', '2026-09-30T00:00:00.000Z')
  old.close()

  const s = new Store(file)
  assert.equal(s.listReminders()[0].text, 'lama')
  const r = s.addReminder('absen', new Date('2026-10-02T10:00:00Z'), 'schedule', new Date(), { days: [1], times: ['07:20'] })
  assert.deepEqual(s.find(r.id).item.schedule, { days: [1], times: ['07:20'] })
  s.close()
})

test('migrasi otomatis dari db.json lama dengan ID yang sama', () => {
  const dir = tempDir()
  const legacy = path.join(dir, 'db.json')
  fs.writeFileSync(
    legacy,
    JSON.stringify({
      nextId: 8,
      notes: [{ id: 5, text: 'nomor meja 12', createdAt: '2026-09-30T01:00:00.000Z' }],
      reminders: [
        { id: 7, text: 'minum air', dueAt: '2026-10-01T00:00:00.000Z', repeat: 'daily', status: 'pending', createdAt: '2026-09-30T01:00:00.000Z' }
      ]
    })
  )
  const s = new Store(path.join(dir, 'assistant.db'), { legacyJson: legacy })
  assert.equal(s.migrated, 2)
  assert.equal(s.find(5).item.text, 'nomor meja 12')
  assert.equal(s.find(7).item.repeat, 'daily')
  assert.equal(s.searchNotes('meja')[0].id, 5)
  assert.ok(s.addNote('baru').id > 7) // penghitung ID melanjutkan
  assert.ok(!fs.existsSync(legacy) && fs.existsSync(legacy + '.migrated'))
  s.close()

  // Start berikutnya tidak migrasi ulang.
  const again = new Store(path.join(dir, 'assistant.db'), { legacyJson: legacy })
  assert.equal(again.migrated, 0)
  again.close()
})
