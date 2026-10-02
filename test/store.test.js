import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Store } from '../src/db.js'

const TZ = 'Asia/Jakarta'

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-store-'))
  return { file: path.join(dir, 'db.json'), dir }
}

test('catatan & reminder tersimpan ke file dan bisa dibaca ulang', () => {
  const { file } = tempStore()
  const s = new Store(file)
  const n = s.addNote('beli susu')
  const r = s.addReminder('bayar listrik', new Date('2026-10-01T02:00:00Z'))
  assert.notEqual(n.id, r.id)

  const s2 = new Store(file)
  assert.equal(s2.listNotes()[0].text, 'beli susu')
  assert.equal(s2.listReminders()[0].text, 'bayar listrik')
})

test('remove, markDone, dueReminders, afterFire', () => {
  const s = new Store(tempStore().file)
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

test('reminder terjadwal tersimpan dan maju ke jadwal berikutnya', () => {
  const { file } = tempStore()
  const s = new Store(file)
  const schedule = { days: [1, 2, 3, 4, 5], times: ['07:20', '17:00'] }
  // Jumat 2 Okt 2026 17:00 WIB
  const r = s.addReminder('absen', new Date('2026-10-02T10:00:00Z'), 'schedule', new Date(), schedule)
  assert.deepEqual(new Store(file).find(r.id).item.schedule, schedule)

  // Terkirim tepat waktu → Senin 07:20 WIB
  s.afterFire(r.id, new Date('2026-10-02T10:00:20Z'), TZ)
  assert.equal(s.find(r.id).item.dueAt, '2026-10-05T00:20:00.000Z')
  assert.equal(s.find(r.id).item.status, 'pending')

  // Bot mati sampai Senin 09:00 → kirim sekali (terlambat), lalu lanjut Senin 17:00
  s.afterFire(r.id, new Date('2026-10-05T02:00:00Z'), TZ)
  assert.equal(s.find(r.id).item.dueAt, '2026-10-05T10:00:00.000Z')

  // Reminder biasa tidak membawa field schedule
  assert.equal('schedule' in s.addReminder('x', new Date('2026-10-10T00:00:00Z')), false)
})
