// Router pesan: perintah "/..." dieksekusi langsung, selain itu diterjemahkan oleh AI.

import { HELP_TEXT, parseCommand } from './commands.js'
import { buildPrompt, extractJson, validateIntent } from './ai/prompt.js'
import { formatSchedule } from './schedule.js'
import { formatDateTime, formatDuration, formatWhen } from './time.js'

const REPEAT_LABEL = { daily: ' 🔁 harian', weekly: ' 🔁 mingguan', none: '' }

function repeatLabel(r) {
  if (r.repeat === 'schedule' && r.schedule) return ` 🔁 ${formatSchedule(r.schedule)}`
  return REPEAT_LABEL[r.repeat] || ''
}
const REPEAT_SENTENCE = { daily: 'setiap hari', weekly: 'setiap minggu' }
// Perintah MCP yang dikenal walau belum diaktifkan, supaya pesan errornya bisa menjelaskan cara mengaktifkan.
const KNOWN_MCP_PRESETS = ['atlassian']
// Di bawah batas ini konfirmasi menyebut durasi ("2 menit lagi"), di atasnya cukup waktunya.
const SHOW_DURATION_MS = 6 * 60 * 60 * 1000

// "Oke aku ingetin kamu 2 menit lagi ya pukul 15.17 untuk minum air"
export function reminderConfirmation(r, now, tz) {
  const due = new Date(r.dueAt)
  const diff = due.getTime() - now.getTime()
  const when = formatWhen(due, now, tz)
  const timing = diff < SHOW_DURATION_MS ? `${formatDuration(diff)} lagi ya ${when}` : `${when} ya`
  if (r.repeat === 'schedule' && r.schedule) {
    const first = diff < SHOW_DURATION_MS ? `${formatDuration(diff)} lagi, ${when}` : when
    return (
      `Oke aku ingetin kamu ${r.text} tiap ${formatSchedule(r.schedule)} 🔁\n` +
      `Kiriman pertama ${first}.\n_Balas /done ${r.id} kalau mau berhenti._`
    )
  }
  let msg = `Oke aku ingetin kamu ${timing} untuk ${r.text}`
  if (REPEAT_SENTENCE[r.repeat]) {
    msg += `, dan aku ulangi ${REPEAT_SENTENCE[r.repeat]} 🔁\n_Balas /done ${r.id} kalau mau berhenti._`
  }
  return msg
}

export function createAssistant({
  store,
  ai,
  tz,
  ownerName = '',
  mcpCommands = {},
  mcpRunner = null,
  log = () => {},
  clock = () => new Date()
}) {
  const mcpNames = mcpRunner ? Object.keys(mcpCommands) : []
  const mcpSources = mcpNames.map((name) => ({ name, label: mcpCommands[name].label || name }))

  function helpText() {
    if (!mcpNames.length) return HELP_TEXT
    const lines = mcpNames.map((n) => `/${n} <kata kunci / pertanyaan / link> — cari di ${mcpCommands[n].label || n}`)
    return `${HELP_TEXT}\n\n*Pencarian (MCP)*\n${lines.join('\n')}\nBisa juga lewat bahasa bebas, mis. "cek di confluence soal sync kas".`
  }

  // "/atlassian sync kas" → { name, cmd, query } bila perintah MCP terdaftar.
  function matchMcp(text) {
    const m = /^\/(\S+)\s*([\s\S]*)$/.exec(text.trim())
    if (!m) return null
    const name = m[1].toLowerCase()
    if (mcpNames.includes(name)) return { name, cmd: mcpCommands[name], query: m[2].trim() }
    if (KNOWN_MCP_PRESETS.includes(name)) return { name, disabled: true }
    return null
  }

  async function runMcp({ name, cmd, query, disabled }, notify) {
    if (disabled) {
      return (
        `Perintah /${name} belum diaktifkan di bot ini.\n` +
        'Di komputer bot, jalankan `npm run setup`, pilih *Yes* pada pertanyaan /atlassian, lalu jalankan ulang `npm start`.'
      )
    }
    if (!query) return `Format: /${name} <kata kunci>\nContoh: /${name} sync kas`
    const label = cmd.label || name
    const shown = query.length > 60 ? query.slice(0, 60) + '…' : query
    await notify(`🔎 Lagi nyari "${shown}" di ${label}, tunggu sebentar ya...`)
    try {
      const result = await mcpRunner.run(cmd, query)
      return result || 'Tidak ada hasil.'
    } catch (err) {
      log('warn', `/${name} gagal: ${err.message}`)
      return `⚠️ Pencarian di ${label} gagal:\n${err.message}`
    }
  }

  function formatReminder(r) {
    return `#${r.id} · ${formatDateTime(new Date(r.dueAt), tz)}${repeatLabel(r)}\n    ${r.text}`
  }

  // Balasan dibuat dari data yang benar-benar tersimpan, bukan dari klaim AI.
  function execute(intent) {
    switch (intent.action) {
      case 'help':
        return helpText()

      case 'add_note': {
        const note = store.addNote(intent.text, clock())
        return `📝 Dicatat (#${note.id}): ${note.text}`
      }

      case 'list_notes': {
        const notes = store.listNotes()
        if (!notes.length) return 'Belum ada catatan.'
        return `📒 *Catatan (${notes.length})*\n` + notes.map((n) => `#${n.id} · ${n.text}`).join('\n')
      }

      case 'search_notes': {
        const found = store.searchNotes(intent.text, 10)
        if (!found.length) return `Aku belum nemu catatan soal "${intent.text}".`
        return `🔍 *Catatan soal "${intent.text}" (${found.length})*\n` + found.map((n) => `#${n.id} · ${n.text}`).join('\n')
      }

      case 'add_reminder': {
        const now = clock()
        const r = store.addReminder(intent.text, intent.dueAt, intent.repeat || 'none', now, intent.schedule)
        return reminderConfirmation(r, now, tz)
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

  // notify: kirim pesan sela sebelum balasan akhir (dipakai untuk pencarian yang lama).
  async function handle(text, { notify = async () => {} } = {}) {
    const mcp = matchMcp(text)
    if (mcp) return runMcp(mcp, notify)

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
        ownerName,
        notes: store.relevantNotes(text),
        totalNotes: store.countNotes(),
        reminders: store.listReminders(),
        mcpSources
      })
      raw = await ai.complete(prompt)
    } catch (err) {
      log('warn', `AI gagal: ${err.message}`)
      return `⚠️ AI (${ai.name}) sedang tidak bisa dipakai:\n${err.message}\n\nKamu tetap bisa pakai perintah, ketik /help.`
    }

    let parsed
    try {
      parsed = validateIntent(extractJson(raw), clock(), { mcpSources, message: text, tz })
    } catch (err) {
      log('warn', `Output AI tidak valid: ${err.message}`)
      return 'Maaf, aku belum paham. Coba ulangi atau pakai perintah /help.'
    }
    if (!parsed.ok) return `Maaf, ${parsed.error.toLowerCase()}. Coba ulangi dengan lebih jelas atau pakai /help.`

    const { intent } = parsed
    if (intent.action === 'search_mcp') {
      return runMcp({ name: intent.source, cmd: mcpCommands[intent.source], query: intent.query }, notify)
    }
    return execute(intent)
  }

  return { handle, formatReminder }
}
