// Parser perintah cepat (tanpa AI). Menghasilkan intent dengan bentuk yang sama seperti output AI,
// sehingga eksekusinya bisa dipakai bersama di assistant.js.

import { parseWhen } from './time.js'

export const HELP_TEXT = `*Asisten Pribadi* 🤖

*Catatan*
/note <teks> — simpan catatan
/notes — lihat semua catatan

*Reminder*
/remind <waktu> <teks> — buat reminder
/remind harian <jam> <teks> — reminder setiap hari
/remind mingguan <waktu> <teks> — reminder setiap minggu
/reminders — lihat reminder aktif
/done <id> — tandai reminder selesai

*Lainnya*
/del <id> — hapus catatan/reminder
/help — bantuan ini

*Format waktu*
10m · 2h · 1h30m · 1d · 07:00 · besok 09:00 · lusa 8.30 · 5/10 14:00 · 2026-10-05 14:00

Tanpa "/" pesanmu dibaca oleh AI (jika diaktifkan), contoh:
"ingatkan aku besok jam 7 pagi olahraga"`

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

    case 'remind':
    case 'ingatkan': {
      if (!rest) return { error: 'Format: /remind <waktu> <teks>\nContoh: /remind 30m angkat jemuran' }
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
