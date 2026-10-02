// Jadwal berulang berdasarkan hari & jam, mis. Senin–Jumat jam 07:20 dan 17:00.
// Bentuk data: { days: [1..7] (1 = Senin, 7 = Minggu), times: ["07:20", "17:00"] }.

import { getZonedParts, parseClock, zonedTimeToUtc } from './time.js'

const DAY_WORDS = {
  1: ['senin', 'sen', 'mon', 'monday'],
  2: ['selasa', 'sel', 'tue', 'tuesday'],
  3: ['rabu', 'rab', 'wed', 'wednesday'],
  4: ['kamis', 'kam', 'thu', 'thursday'],
  5: ['jumat', "jum'at", 'jum', 'fri', 'friday'],
  6: ['sabtu', 'sab', 'sat', 'saturday'],
  7: ['minggu', 'min', 'ahad', 'sun', 'sunday']
}
const DAY_NUMBER = Object.fromEntries(
  Object.entries(DAY_WORDS).flatMap(([n, words]) => words.map((w) => [w, Number(n)]))
)
const DAY_SHORT = { 1: 'Sen', 2: 'Sel', 3: 'Rab', 4: 'Kam', 5: 'Jum', 6: 'Sab', 7: 'Min' }

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7]
const DAY_ALIASES = {
  'hari-kerja': [1, 2, 3, 4, 5],
  weekdays: [1, 2, 3, 4, 5],
  weekday: [1, 2, 3, 4, 5],
  'akhir-pekan': [6, 7],
  weekend: [6, 7],
  'setiap-hari': ALL_DAYS,
  'tiap-hari': ALL_DAYS,
  everyday: ALL_DAYS
}

const pad = (n) => String(n).padStart(2, '0')

/**
 * "senin-jumat", "sen-jum", "hari-kerja", "senin,rabu,jumat", "jumat-senin", "sabtu".
 * @returns {number[] | null} nomor hari terurut (1 = Senin), atau null bila bukan ekspresi hari.
 */
export function parseDays(token) {
  const input = String(token || '').toLowerCase()
  if (DAY_ALIASES[input]) return [...DAY_ALIASES[input]]
  const days = new Set()
  for (const part of input.split(',')) {
    const range = part.split('-')
    if (range.length === 1) {
      const d = DAY_NUMBER[range[0]]
      if (!d) return null
      days.add(d)
    } else if (range.length === 2) {
      const from = DAY_NUMBER[range[0]]
      const to = DAY_NUMBER[range[1]]
      if (!from || !to) return null
      // Rentang boleh melewati Minggu, mis. jumat-senin → Jum, Sab, Min, Sen.
      for (let d = from, i = 0; i < 7; d = (d % 7) + 1, i++) {
        days.add(d)
        if (d === to) break
      }
    } else {
      return null
    }
  }
  return days.size ? [...days].sort((a, b) => a - b) : null
}

// Pemisah antar jam: koma, strip, "&", atau "dan". Contoh: "07:20,17:00", "7.20 dan 17.00".
const TIME = String.raw`\d{1,2}[:.]\d{2}`
const SEP = String.raw`\s*(?:,|-|&|\bdan\b)\s*`
const TIMES_PREFIX = new RegExp(`^(${TIME}(?:${SEP}${TIME})*)(?:\\s+|$)`, 'i')

/**
 * Ambil daftar jam di awal teks.
 * @returns {{ times: string[], rest: string } | null}
 */
export function parseTimesPrefix(text) {
  const m = TIMES_PREFIX.exec(String(text || '').trim())
  if (!m) return null
  const times = normalizeTimes(m[1].split(new RegExp(SEP, 'i')))
  if (!times) return null
  return { times, rest: text.trim().slice(m[0].length).trim() }
}

// Validasi & normalisasi daftar jam → ["07:20", "17:00"] (urut, tanpa duplikat), atau null.
export function normalizeTimes(list) {
  if (!Array.isArray(list) || !list.length) return null
  const times = new Set()
  for (const raw of list) {
    const clock = parseClock(String(raw).trim())
    if (!clock) return null
    times.add(`${pad(clock.hour)}:${pad(clock.minute)}`)
  }
  return [...times].sort()
}

// Validasi & normalisasi jadwal (dipakai juga untuk output AI). Mengembalikan jadwal atau null.
export function normalizeSchedule(schedule) {
  if (!schedule || !Array.isArray(schedule.days)) return null
  const days = [...new Set(schedule.days.map(Number))].sort((a, b) => a - b)
  if (!days.length || !days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) return null
  const times = normalizeTimes(schedule.times)
  if (!times) return null
  return { days, times }
}

// Nomor hari ISO (1 = Senin … 7 = Minggu) dari tanggal kalender.
function isoWeekday({ year, month, day }) {
  const d = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return d === 0 ? 7 : d
}

/**
 * Kejadian pertama yang jatuh SETELAH `after` (bukan sama dengan), sesuai jadwal di zona tz.
 * @returns {Date | null}
 */
export function nextScheduledOccurrence(schedule, after, tz) {
  const { days, times } = schedule
  const today = getZonedParts(after, tz)
  for (let offset = 0; offset <= 7; offset++) {
    const base = new Date(Date.UTC(today.year, today.month - 1, today.day + offset))
    const date = { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: base.getUTCDate() }
    if (!days.includes(isoWeekday(date))) continue
    for (const time of times) {
      const [hour, minute] = time.split(':').map(Number)
      const at = zonedTimeToUtc({ ...date, hour, minute }, tz)
      if (at.getTime() > after.getTime()) return at
    }
  }
  return null
}

// [1,2,3,4,5] → "Sen–Jum"; [1,3,5] → "Sen, Rab, Jum"; semua hari → "setiap hari".
export function formatDays(days) {
  if (days.length === 7) return 'setiap hari'
  const runs = []
  for (const d of days) {
    const last = runs.at(-1)
    if (last && d === last[1] + 1) last[1] = d
    else runs.push([d, d])
  }
  return runs
    .flatMap(([a, b]) => {
      if (a === b) return [DAY_SHORT[a]]
      if (b === a + 1) return [DAY_SHORT[a], DAY_SHORT[b]]
      return [`${DAY_SHORT[a]}–${DAY_SHORT[b]}`]
    })
    .join(', ')
}

// "Sen–Jum jam 07:20 & 17:00"
export function formatSchedule({ days, times }) {
  return `${formatDays(days)} jam ${times.join(' & ')}`
}
