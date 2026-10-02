import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatDays,
  formatSchedule,
  nextScheduledOccurrence,
  normalizeSchedule,
  parseDays,
  parseTimesPrefix
} from '../src/schedule.js'

const TZ = 'Asia/Jakarta' // UTC+7
const KERJA = { days: [1, 2, 3, 4, 5], times: ['07:20', '17:00'] }
// Jam dinding WIB → instant UTC
const wib = (iso) => new Date(`${iso}+07:00`)

test('parseDays: rentang, singkatan, alias, daftar', () => {
  assert.deepEqual(parseDays('senin-jumat'), [1, 2, 3, 4, 5])
  assert.deepEqual(parseDays('Sen-Jum'), [1, 2, 3, 4, 5])
  assert.deepEqual(parseDays('hari-kerja'), [1, 2, 3, 4, 5])
  assert.deepEqual(parseDays('weekend'), [6, 7])
  assert.deepEqual(parseDays('sabtu-minggu'), [6, 7])
  assert.deepEqual(parseDays('setiap-hari'), [1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(parseDays('senin,rabu,jumat'), [1, 3, 5])
  assert.deepEqual(parseDays("jum'at"), [5])
  assert.deepEqual(parseDays('jumat-senin'), [1, 5, 6, 7]) // melewati Minggu
  assert.deepEqual(parseDays('senin-rabu,jumat'), [1, 2, 3, 5])
  assert.equal(parseDays('besok'), null)
  assert.equal(parseDays('senin-xyz'), null)
  assert.equal(parseDays('senin,'), null)
  assert.equal(parseDays('07:20'), null)
})

test('parseTimesPrefix: pemisah koma, strip, "dan", titik', () => {
  assert.deepEqual(parseTimesPrefix('07:20,17:00 absen'), { times: ['07:20', '17:00'], rest: 'absen' })
  assert.deepEqual(parseTimesPrefix('7.20-17.00 absen masuk'), { times: ['07:20', '17:00'], rest: 'absen masuk' })
  assert.deepEqual(parseTimesPrefix('7.20 dan 17.00 absen').times, ['07:20', '17:00'])
  assert.deepEqual(parseTimesPrefix('17:00, 07:20, 07:20 x').times, ['07:20', '17:00'])
  assert.deepEqual(parseTimesPrefix('06:00 olahraga'), { times: ['06:00'], rest: 'olahraga' })
  assert.equal(parseTimesPrefix('25:00 x'), null)
  assert.equal(parseTimesPrefix('pagi x'), null)
})

test('normalizeSchedule untuk output AI', () => {
  assert.deepEqual(normalizeSchedule({ days: [5, 1, '2', 1], times: ['17:00', '7.20'] }), {
    days: [1, 2, 5],
    times: ['07:20', '17:00']
  })
  assert.equal(normalizeSchedule({ days: [0], times: ['07:00'] }), null)
  assert.equal(normalizeSchedule({ days: [], times: ['07:00'] }), null)
  assert.equal(normalizeSchedule({ days: [1], times: [] }), null)
  assert.equal(normalizeSchedule({ days: [1], times: ['pagi'] }), null)
  assert.equal(normalizeSchedule(null), null)
})

test('nextScheduledOccurrence: Senin–Jumat 07:20 & 17:00', () => {
  const next = (iso) => nextScheduledOccurrence(KERJA, wib(iso), TZ).toISOString()
  // 1 Okt 2026 = Kamis
  assert.equal(next('2026-10-01T06:00:00'), wib('2026-10-01T07:20:00').toISOString())
  assert.equal(next('2026-10-01T07:20:00'), wib('2026-10-01T17:00:00').toISOString()) // tepat 07:20 → 17:00
  assert.equal(next('2026-10-01T12:00:00'), wib('2026-10-01T17:00:00').toISOString())
  assert.equal(next('2026-10-02T17:01:00'), wib('2026-10-05T07:20:00').toISOString()) // Jumat sore → Senin
  assert.equal(next('2026-10-03T10:00:00'), wib('2026-10-05T07:20:00').toISOString()) // Sabtu → Senin
  assert.equal(next('2026-10-04T23:59:00'), wib('2026-10-05T07:20:00').toISOString()) // Minggu malam → Senin
})

test('nextScheduledOccurrence: satu hari per minggu & zona dengan DST', () => {
  const senin = { days: [1], times: ['08:00'] }
  // Senin 08:00 tepat → Senin minggu depan
  assert.equal(
    nextScheduledOccurrence(senin, wib('2026-10-05T08:00:00'), TZ).toISOString(),
    wib('2026-10-12T08:00:00').toISOString()
  )
  // New York pindah dari EDT ke EST pada 1 Nov 2026; jam dinding tetap 08:00.
  const ny = nextScheduledOccurrence(senin, new Date('2026-10-31T12:00:00Z'), 'America/New_York')
  assert.equal(ny.toISOString(), '2026-11-02T13:00:00.000Z')
})

test('formatDays & formatSchedule', () => {
  assert.equal(formatSchedule(KERJA), 'Sen–Jum jam 07:20 & 17:00')
  assert.equal(formatDays([1, 3, 5]), 'Sen, Rab, Jum')
  assert.equal(formatDays([6, 7]), 'Sab, Min')
  assert.equal(formatDays([1, 5, 6, 7]), 'Sen, Jum–Min')
  assert.equal(formatDays([1, 2, 3, 4, 5, 6, 7]), 'setiap hari')
})
