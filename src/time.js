// Utilitas waktu tanpa library eksternal: konversi zona waktu via Intl,
// parsing ekspresi waktu sederhana untuk perintah /remind, dan format tanggal Indonesia.

const DAY_MS = 24 * 60 * 60 * 1000

export function isValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

// Ambil komponen tanggal "jam dinding" untuk sebuah instant di zona waktu tertentu.
export function getZonedParts(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    weekday: 'short'
  })
  const parts = {}
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday
  }
}

function tzOffsetMs(date, tz) {
  const p = getZonedParts(date, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - (date.getTime() - date.getMilliseconds())
}

// Konversi waktu jam dinding (di zona tz) menjadi Date (UTC instant).
export function zonedTimeToUtc({ year, month, day, hour = 0, minute = 0 }, tz) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0)
  let offset = tzOffsetMs(new Date(guess), tz)
  let result = guess - offset
  // Ulangi sekali untuk menangani perbatasan DST.
  const offset2 = tzOffsetMs(new Date(result), tz)
  if (offset2 !== offset) result = guess - offset2
  return new Date(result)
}

// Tambah n hari dalam kalender lokal (jam dinding tetap sama).
export function addLocalDays(date, days, tz) {
  const p = getZonedParts(date, tz)
  const base = new Date(Date.UTC(p.year, p.month - 1, p.day + days))
  return zonedTimeToUtc(
    {
      year: base.getUTCFullYear(),
      month: base.getUTCMonth() + 1,
      day: base.getUTCDate(),
      hour: p.hour,
      minute: p.minute
    },
    tz
  )
}

// Jadwal berikutnya untuk reminder berulang, dijamin setelah `now`.
export function nextOccurrence(dueAt, repeat, now, tz) {
  const step = repeat === 'daily' ? 1 : repeat === 'weekly' ? 7 : 0
  if (!step) return null
  let next = addLocalDays(dueAt, step, tz)
  // Lewati kejadian yang terlewat (mis. PC mati berhari-hari).
  let guard = 0
  while (next.getTime() <= now.getTime() && guard++ < 10000) {
    next = addLocalDays(next, step, tz)
  }
  return next
}

const UNIT_MS = {
  d: DAY_MS, hari: DAY_MS,
  h: 3600000, j: 3600000, jam: 3600000,
  m: 60000, mnt: 60000, menit: 60000,
  s: 1000, dtk: 1000, detik: 1000
}

// "10m", "2h", "1h30m", "1d", "15menit", "2jam"
function parseDuration(token) {
  const re = /(\d+)\s*(hari|jam|menit|mnt|detik|dtk|d|h|j|m|s)/gy
  let total = 0
  let consumed = 0
  let match
  while ((match = re.exec(token))) {
    total += Number(match[1]) * UNIT_MS[match[2]]
    consumed = re.lastIndex
  }
  return consumed === token.length && total > 0 ? total : null
}

function parseClock(token) {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(token)
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

function parseDate(token, today) {
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(token)
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(token)
  if (m) {
    return {
      year: m[3] ? Number(m[3]) : today.year,
      month: Number(m[2]),
      day: Number(m[1]),
      yearGiven: Boolean(m[3])
    }
  }
  return null
}

function validDate({ year, month, day }) {
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

const RELATIVE_DAYS = { 'hari ini': 0, today: 0, besok: 1, tomorrow: 1, lusa: 2 }

/**
 * Parse ekspresi waktu di awal teks.
 * Mendukung: "10m", "1h30m", "07:00", "besok 09:00", "lusa 8.30",
 * "2026-10-05 14:00", "5/10 14:00", "5/10/2026 14:00".
 * @returns {{ dueAt: Date, rest: string } | null}
 */
export function parseWhen(text, now, tz) {
  const input = text.trim()
  const lower = input.toLowerCase()
  const tokens = input.split(/\s+/)
  const today = getZonedParts(now, tz)

  // Durasi relatif: "10m tes"
  const dur = parseDuration(tokens[0].toLowerCase())
  if (dur) {
    return { dueAt: new Date(now.getTime() + dur), rest: tokens.slice(1).join(' ') }
  }

  // Hari relatif + jam: "besok 09:00 ..."
  for (const [word, offset] of Object.entries(RELATIVE_DAYS)) {
    if (lower.startsWith(word + ' ')) {
      const after = input.slice(word.length).trim().split(/\s+/)
      const clock = parseClock(after[0] || '')
      if (!clock) return null
      const base = new Date(Date.UTC(today.year, today.month - 1, today.day + offset))
      const dueAt = zonedTimeToUtc(
        { year: base.getUTCFullYear(), month: base.getUTCMonth() + 1, day: base.getUTCDate(), ...clock },
        tz
      )
      return { dueAt, rest: after.slice(1).join(' ') }
    }
  }

  // Tanggal + jam: "2026-10-05 14:00 ..." atau "5/10 14:00 ..."
  const date = parseDate(tokens[0], today)
  if (date) {
    const clock = parseClock(tokens[1] || '')
    if (!clock || !validDate(date)) return null
    let dueAt = zonedTimeToUtc({ ...date, ...clock }, tz)
    // "5/10" tanpa tahun yang sudah lewat → tahun depan.
    if (date.yearGiven === false && dueAt <= now) {
      dueAt = zonedTimeToUtc({ ...date, year: date.year + 1, ...clock }, tz)
    }
    return { dueAt, rest: tokens.slice(2).join(' ') }
  }

  // Jam saja: "07:00 ..." → hari ini, atau besok jika sudah lewat.
  const clock = parseClock(tokens[0])
  if (clock) {
    let dueAt = zonedTimeToUtc({ year: today.year, month: today.month, day: today.day, ...clock }, tz)
    if (dueAt <= now) dueAt = addLocalDays(dueAt, 1, tz)
    return { dueAt, rest: tokens.slice(1).join(' ') }
  }

  return null
}

export function formatDateTime(date, tz) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date)
}

// ISO 8601 dengan offset lokal, mis. 2026-09-30T14:05:00+07:00 (untuk prompt AI).
export function toLocalIso(date, tz) {
  const p = getZonedParts(date, tz)
  const offsetMin = Math.round(tzOffsetMs(date, tz) / 60000)
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}
