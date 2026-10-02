// Router pesan: perintah "/..." dieksekusi langsung, selain itu diterjemahkan oleh AI.

import { HELP_TEXT, parseCommand } from './commands.js'
import { buildPrompt, extractJson, validateIntent } from './ai/prompt.js'
import { formatSchedule } from './schedule.js'
import { formatDateTime } from './time.js'

const REPEAT_LABEL = { daily: ' 🔁 harian', weekly: ' 🔁 mingguan', none: '' }

function repeatLabel(r) {
  if (r.repeat === 'schedule' && r.schedule) return ` 🔁 ${formatSchedule(r.schedule)}`
  return REPEAT_LABEL[r.repeat] || ''
}

export function createAssistant({ store, ai, tz, log = () => {}, clock = () => new Date() }) {
  function formatReminder(r) {
    return `#${r.id} · ${formatDateTime(new Date(r.dueAt), tz)}${repeatLabel(r)}\n    ${r.text}`
  }

  // Balasan dibuat dari data yang benar-benar tersimpan, bukan dari klaim AI.
  function execute(intent) {
    switch (intent.action) {
      case 'help':
        return HELP_TEXT

      case 'add_note': {
        const note = store.addNote(intent.text, clock())
        return `📝 Dicatat (#${note.id}): ${note.text}`
      }

      case 'list_notes': {
        const notes = store.listNotes()
        if (!notes.length) return 'Belum ada catatan.'
        return `📒 *Catatan (${notes.length})*\n` + notes.map((n) => `#${n.id} · ${n.text}`).join('\n')
      }

      case 'add_reminder': {
        const r = store.addReminder(intent.text, intent.dueAt, intent.repeat || 'none', clock(), intent.schedule)
        if (r.repeat === 'schedule') {
          return (
            `⏰ Oke, diingatkan 🔁 ${formatSchedule(r.schedule)}\n` +
            `Kiriman pertama: ${formatDateTime(intent.dueAt, tz)}\n#${r.id} · ${r.text}`
          )
        }
        return `⏰ Oke, diingatkan ${formatDateTime(intent.dueAt, tz)}${repeatLabel(r)}\n#${r.id} · ${r.text}`
      }

      case 'list_reminders': {
        const reminders = store.listReminders()
        if (!reminders.length) return 'Tidak ada reminder aktif.'
        return `⏰ *Reminder aktif (${reminders.length})*\n` + reminders.map(formatReminder).join('\n')
      }

      case 'done': {
        const r = store.markDone(intent.id)
        if (!r) return `Reminder #${intent.id} tidak ditemukan atau sudah selesai.`
        return `✅ Reminder #${r.id} selesai: ${r.text}`
      }

      case 'delete': {
        const removed = store.remove(intent.id)
        if (!removed) return `Item #${intent.id} tidak ditemukan.`
        const label = removed.type === 'note' ? 'Catatan' : 'Reminder'
        return `🗑️ ${label} #${intent.id} dihapus: ${removed.item.text}`
      }

      case 'chat':
        return intent.reply || 'Hmm, bisa diulang dengan lebih jelas?'

      default:
        return 'Aksi tidak dikenal.'
    }
  }

  async function handle(text) {
    const now = clock()
    const cmd = parseCommand(text, now, tz)
    if (cmd) return cmd.error ?? execute(cmd.intent)

    if (!ai) return 'AI tidak diaktifkan. Pakai perintah, ketik /help.'

    let raw
    try {
      const prompt = buildPrompt({
        message: text,
        now,
        tz,
        notes: store.listNotes(),
        reminders: store.listReminders()
      })
      raw = await ai.complete(prompt)
    } catch (err) {
      log('warn', `AI gagal: ${err.message}`)
      return `⚠️ AI (${ai.name}) sedang tidak bisa dipakai:\n${err.message}\n\nKamu tetap bisa pakai perintah, ketik /help.`
    }

    let parsed
    try {
      parsed = validateIntent(extractJson(raw), clock(), tz)
    } catch (err) {
      log('warn', `Output AI tidak valid: ${err.message}`)
      return 'Maaf, aku belum paham. Coba ulangi atau pakai perintah /help.'
    }
    if (!parsed.ok) return `Maaf, ${parsed.error.toLowerCase()}. Coba ulangi dengan lebih jelas atau pakai /help.`

    return execute(parsed.intent)
  }

  return { handle, formatReminder }
}
