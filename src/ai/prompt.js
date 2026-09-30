// Prompt untuk mengubah pesan bahasa natural menjadi aksi JSON, plus validasinya.
// AI hanya menerjemahkan; eksekusi tetap dilakukan oleh kode (lihat assistant.js).

import { toLocalIso } from '../time.js'

export const ACTIONS = [
  'add_note',
  'list_notes',
  'add_reminder',
  'list_reminders',
  'delete',
  'done',
  'chat'
]
export const REPEATS = ['none', 'daily', 'weekly']

const MAX_CONTEXT_ITEMS = 30

export function buildPrompt({ message, now, tz, notes = [], reminders = [] }) {
  const noteLines = notes
    .slice(-MAX_CONTEXT_ITEMS)
    .map((n) => `#${n.id}: ${n.text}`)
    .join('\n')
  const reminderLines = reminders
    .slice(0, MAX_CONTEXT_ITEMS)
    .map((r) => `#${r.id}: ${r.text} @ ${toLocalIso(new Date(r.dueAt), tz)}${r.repeat !== 'none' ? ` (${r.repeat})` : ''}`)
    .join('\n')

  return `Kamu adalah asisten pribadi di WhatsApp yang mengelola CATATAN dan REMINDER milik pemilik.
Tugasmu: ubah pesan pengguna menjadi SATU objek JSON. Jangan memakai tool apa pun. Jangan menulis apa pun selain JSON.

Waktu sekarang: ${toLocalIso(now, tz)} (zona waktu ${tz}).

Skema JSON:
{
  "action": "add_note" | "list_notes" | "add_reminder" | "list_reminders" | "delete" | "done" | "chat",
  "text": string,          // isi catatan/reminder (ringkas, tanpa kata "ingatkan"), kosongkan jika tidak perlu
  "due_at": string | null, // hanya untuk add_reminder: ISO 8601 LENGKAP dengan offset zona waktu, harus di masa depan
  "repeat": "none" | "daily" | "weekly",
  "id": number | null,     // untuk delete/done: ID item dari daftar di bawah
  "reply": string          // balasan singkat & ramah dalam bahasa pengguna
}

Aturan:
- "ingatkan/remind/jangan lupa ... <waktu>" → add_reminder. Jika jam tidak disebut untuk hari tertentu, pakai 09:00.
- "catat/simpan/note ..." → add_note.
- Pertanyaan tentang daftar catatan/reminder → list_notes / list_reminders.
- "hapus ..." → delete dengan id yang paling cocok; "sudah/selesai ..." → done dengan id reminder yang cocok.
- Jika tidak ada ID yang cocok atau permintaan tidak jelas → action "chat" dan tanyakan balik di "reply".
- Obrolan umum → action "chat" dengan jawaban singkat di "reply".

Catatan saat ini:
${noteLines || '(kosong)'}

Reminder aktif:
${reminderLines || '(kosong)'}

Pesan pengguna:
"""
${message}
"""`
}

// Ambil objek JSON pertama dari output model (toleran terhadap ```json ... ``` atau teks tambahan).
export function extractJson(text) {
  if (typeof text !== 'string') throw new Error('Output AI kosong')
  const start = text.indexOf('{')
  if (start === -1) throw new Error('Output AI tidak berisi JSON')
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1))
  }
  throw new Error('JSON dari AI tidak lengkap')
}

function toId(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(String(value).replace(/^#/, ''))
  return Number.isInteger(n) && n > 0 ? n : null
}

// Validasi & normalisasi intent. Mengembalikan { ok: true, intent } atau { ok: false, error }.
export function validateIntent(raw, now) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Format jawaban AI tidak valid' }
  const action = raw.action
  if (!ACTIONS.includes(action)) return { ok: false, error: `Aksi tidak dikenal: ${action}` }

  const intent = {
    action,
    text: typeof raw.text === 'string' ? raw.text.trim() : '',
    dueAt: null,
    repeat: REPEATS.includes(raw.repeat) ? raw.repeat : 'none',
    id: toId(raw.id),
    reply: typeof raw.reply === 'string' ? raw.reply.trim() : ''
  }

  if (action === 'add_note' && !intent.text) return { ok: false, error: 'Isi catatan kosong' }
  if (action === 'add_reminder') {
    if (!intent.text) return { ok: false, error: 'Isi reminder kosong' }
    const due = raw.due_at ? new Date(raw.due_at) : null
    if (!due || Number.isNaN(due.getTime())) return { ok: false, error: 'Waktu reminder tidak valid' }
    if (due.getTime() <= now.getTime()) return { ok: false, error: 'Waktu reminder sudah lewat' }
    intent.dueAt = due
  }
  if ((action === 'delete' || action === 'done') && intent.id === null) {
    return { ok: false, error: 'ID item tidak ditemukan' }
  }
  return { ok: true, intent }
}
