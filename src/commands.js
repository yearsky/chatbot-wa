// Parser perintah cepat (tanpa AI). Menghasilkan intent dengan bentuk yang sama seperti output AI,
// sehingga eksekusinya bisa dipakai bersama di assistant.js.

import { parseWhen } from './time.js'
import { nextScheduledOccurrence, normalizeDayRange, parseDays, parseTimesPrefix } from './schedule.js'

export const HELP_TEXT = `*Asisten Pribadi* 🤖
Perintah diawali "/". Pesan tanpa "/" dibaca AI (jika diaktifkan).

*📝 Catatan (memory bank)*
/note <teks> — simpan catatan atau info penting
   /note nomor meja kantor 12
/notes — tampilkan semua catatan
/cari <kata kunci> — cari di catatan
   /cari meja

*⏰ Reminder sekali*
/remind <waktu> <teks>
   /remind 30m angkat jemuran
   /remind besok 09:00 bayar listrik
   /remind 5/10 14:00 rapat

*🔁 Reminder berulang*
/remind harian <jam> <teks> — setiap hari
   /remind harian 07:00 minum obat
/remind mingguan <waktu> <teks> — setiap minggu, mulai dari waktu itu
   /remind mingguan besok 08:00 kerja bakti
/remind <hari> <jam> <teks> — hari tertentu, boleh beberapa jam
   /remind senin-jumat 07:20,17:00 absen
   /remind senin sampai jumat 07:20 dan 17:00 absen
   /remind sabtu,minggu 08:00 siram tanaman
_Beberapa jam dipisah koma, strip, "&", atau "dan". Jadi 07:20-17:00 artinya dua kiriman (07:20 dan 17:00), bukan setiap jam di antaranya._

*📋 Kelola reminder*
/reminders — lihat reminder aktif beserta ID-nya
/done <id> — tandai selesai; reminder berulang berhenti diulang
/del <id> — hapus catatan atau reminder

*🕒 Format waktu*
Durasi: 10m · 2h · 1h30m · 1d · 15menit · 2jam
Jam saja: 07:00 atau 7.30 (hari ini, atau besok kalau sudah lewat)
Hari: hari ini 13:00 · besok 09:00 · lusa 8.30
Tanggal: 5/10 14:00 · 5/10/2026 14:00 · 2026-10-05 14:00

*📅 Format hari*
senin-jumat · sen-jum · jumat-senin
senin,rabu,jumat · sabtu
hari-kerja · weekend · setiap-hari

*💬 Bahasa bebas (AI)*
"ingatkan aku besok jam 7 pagi olahraga"
"ingatkan absen tiap senin sampai jumat jam 7.20 dan jam 5 sore"
"ingat ya, nomor meja kantorku 12"
"nomor meja aku berapa?"`

const REPEAT_WORDS = { harian: 'daily', daily: 'daily', mingguan: 'weekly', weekly: 'weekly' }

function parseId(arg) {
  const n = Number(String(arg || '').replace(/^#/, ''))
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * @returns {null} bila bukan perintah,
 *          { intent } bila valid, atau { error } bila format salah.
 */
export function parseCommand(text, now, tz) {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null
  const [rawName, ...restParts] = trimmed.slice(1).split(/\s+/)
  const name = rawName.toLowerCase()
  const rest = restParts.join(' ').trim()

  switch (name) {
    case 'help':
    case 'start':
    case 'menu':
      return { intent: { action: 'help' } }

    case 'note':
    case 'catat':
      if (!rest) return { error: 'Format: /note <teks>' }
      return { intent: { action: 'add_note', text: rest } }

    case 'notes':
    case 'catatan':
      return { intent: { action: 'list_notes' } }

    case 'cari':
    case 'search':
      if (!rest) return { error: 'Format: /cari <kata kunci>' }
      return { intent: { action: 'search_notes', text: rest } }

    case 'remind':
    case 'ingatkan': {
      if (!rest) return { error: 'Format: /remind <waktu> <teks>\nContoh: /remind 30m angkat jemuran' }

      // Reminder terjadwal: /remind senin-jumat 07:20,17:00 absen
      const [dayToken, ...afterDays] = normalizeDayRange(rest).split(/\s+/)
      const days = parseDays(dayToken)
      if (days) {
        const parsedTimes = parseTimesPrefix(afterDays.join(' '))
        if (!parsedTimes) {
          return { error: 'Jam tidak dikenali. Contoh: /remind senin-jumat 07:20,17:00 absen' }
        }
        if (!parsedTimes.rest) return { error: 'Isi reminder kosong. Contoh: /remind senin-jumat 07:20,17:00 absen' }
        const schedule = { days, times: parsedTimes.times }
        const dueAt = nextScheduledOccurrence(schedule, now, tz)
        return { intent: { action: 'add_reminder', text: parsedTimes.rest, dueAt, repeat: 'schedule', schedule } }
      }

      let repeat = 'none'
      let body = rest
      const [first, ...others] = rest.split(/\s+/)
      if (REPEAT_WORDS[first.toLowerCase()]) {
        repeat = REPEAT_WORDS[first.toLowerCase()]
        body = others.join(' ')
      }
      const parsed = parseWhen(body, now, tz)
      if (!parsed) return { error: 'Waktu tidak dikenali. Ketik /help untuk contoh format waktu.' }
      if (!parsed.rest) return { error: 'Isi reminder kosong. Contoh: /remind 10m minum air' }
      if (parsed.dueAt.getTime() <= now.getTime()) return { error: 'Waktu reminder sudah lewat.' }
      return { intent: { action: 'add_reminder', text: parsed.rest, dueAt: parsed.dueAt, repeat } }
    }

    case 'reminders':
    case 'list':
      return { intent: { action: 'list_reminders' } }

    case 'done':
    case 'selesai': {
      const id = parseId(rest)
      if (!id) return { error: 'Format: /done <id>' }
      return { intent: { action: 'done', id } }
    }

    case 'del':
    case 'delete':
    case 'hapus': {
      const id = parseId(rest)
      if (!id) return { error: 'Format: /del <id>' }
      return { intent: { action: 'delete', id } }
    }

    default:
      return { error: `Perintah /${name} tidak dikenal. Ketik /help.` }
  }
}
