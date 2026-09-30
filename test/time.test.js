import test from 'node:test'
import assert from 'node:assert/strict'
import { addLocalDays, formatDateTime, nextOccurrence, parseWhen, toLocalIso, zonedTimeToUtc } from '../src/time.js'

const TZ = 'Asia/Jakarta' // UTC+7, tanpa DST
// 2026-09-30 10:00 WIB
const NOW = new Date('2026-09-30T03:00:00Z')

test('zonedTimeToUtc mengonversi jam dinding ke UTC', () => {
  const d = zonedTimeToUtc({ year: 2026, month: 10, day: 1, hour: 9, minute: 0 }, TZ)
  assert.equal(d.toISOString(), '2026-10-01T02:00:00.000Z')
})

test('zonedTimeToUtc menangani DST (America/New_York)', () => {
  const summer = zonedTimeToUtc({ year: 2026, month: 7, day: 1, hour: 9, minute: 0 }, 'America/New_York')
  const winter = zonedTimeToUtc({ year: 2026, month: 12, day: 1, hour: 9, minute: 0 }, 'America/New_York')
  assert.equal(summer.toISOString(), '2026-07-01T13:00:00.000Z')
  assert.equal(winter.toISOString(), '2026-12-01T14:00:00.000Z')
})

test('parseWhen: durasi relatif', () => {
  assert.equal(parseWhen('10m tes', NOW, TZ).dueAt.toISOString(), '2026-09-30T03:10:00.000Z')
  assert.equal(parseWhen('1h30m makan', NOW, TZ).dueAt.toISOString(), '2026-09-30T04:30:00.000Z')
  assert.equal(parseWhen('2jam x', NOW, TZ).rest, 'x')
  assert.equal(parseWhen('1d rapat', NOW, TZ).dueAt.toISOString(), '2026-10-01T03:00:00.000Z')
})

test('parseWhen: jam saja → hari ini atau besok', () => {
  assert.equal(parseWhen('14:00 rapat', NOW, TZ).dueAt.toISOString(), '2026-09-30T07:00:00.000Z')
  assert.equal(parseWhen('07.00 olahraga', NOW, TZ).dueAt.toISOString(), '2026-10-01T00:00:00.000Z')
})

test('parseWhen: besok / lusa', () => {
  const r = parseWhen('besok 09:00 bayar listrik', NOW, TZ)
  assert.equal(r.dueAt.toISOString(), '2026-10-01T02:00:00.000Z')
  assert.equal(r.rest, 'bayar listrik')
  assert.equal(parseWhen('lusa 8.30 x', NOW, TZ).dueAt.toISOString(), '2026-10-02T01:30:00.000Z')
  assert.equal(parseWhen('besok pagi x', NOW, TZ), null)
})

test('parseWhen: tanggal', () => {
  assert.equal(parseWhen('2026-10-05 14:00 a', NOW, TZ).dueAt.toISOString(), '2026-10-05T07:00:00.000Z')
  assert.equal(parseWhen('5/10 14:00 a', NOW, TZ).dueAt.toISOString(), '2026-10-05T07:00:00.000Z')
  // 1 Januari tanpa tahun sudah lewat? tidak — tapi 1/9 sudah lewat → tahun depan
  assert.equal(parseWhen('1/9 08:00 a', NOW, TZ).dueAt.toISOString(), '2027-09-01T01:00:00.000Z')
  assert.equal(parseWhen('31/2 08:00 a', NOW, TZ), null)
  assert.equal(parseWhen('halo dunia', NOW, TZ), null)
})

test('nextOccurrence harian/mingguan melewati jadwal yang terlewat', () => {
  const due = new Date('2026-09-25T00:00:00Z') // 25 Sep 07:00 WIB
  assert.equal(nextOccurrence(due, 'daily', NOW, TZ).toISOString(), '2026-10-01T00:00:00.000Z')
  assert.equal(nextOccurrence(due, 'weekly', NOW, TZ).toISOString(), '2026-10-02T00:00:00.000Z')
  assert.equal(nextOccurrence(due, 'none', NOW, TZ), null)
})

test('addLocalDays mempertahankan jam dinding', () => {
  assert.equal(addLocalDays(NOW, 1, TZ).toISOString(), '2026-10-01T03:00:00.000Z')
})

test('format tanggal', () => {
  assert.equal(toLocalIso(NOW, TZ), '2026-09-30T10:00:00+07:00')
  assert.match(formatDateTime(NOW, TZ), /30/)
})
