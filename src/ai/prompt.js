// Prompt untuk mengubah pesan bahasa natural menjadi aksi JSON, plus validasinya.
// AI hanya menerjemahkan; eksekusi tetap dilakukan oleh kode (lihat assistant.js).

import { formatSchedule, nextScheduledOccurrence, normalizeSchedule } from '../schedule.js'
import { toLocalIso } from '../time.js'

export const ACTIONS = [
  'add_note',
  'list_notes',
  'search_notes',
  'add_reminder',
  'list_reminders',
  'delete',
  'done',
  'search_mcp',
  'chat'
]
export const REPEATS = ['none', 'daily', 'weekly', 'schedule']

const MAX_CONTEXT_ITEMS = 30

function repeatNote(r) {
  if (r.repeat === 'schedule' && r.schedule) return ` (jadwal ${formatSchedule(r.schedule)})`
  return r.repeat !== 'none' ? ` (${r.repeat})` : ''
}

/**
 * notes: catatan yang relevan dengan pesan (dari memory bank), bukan seluruh isi.
 * mcpSources: [{ name, label }] sumber pencarian eksternal yang aktif, mis. atlassian.
 */
export function buildPrompt({ message, now, tz, ownerName = '', notes = [], totalNotes, reminders = [], mcpSources = [] }) {
  const noteLines = notes
    .slice(-MAX_CONTEXT_ITEMS)
    .map((n) => `#${n.id}: ${n.text}`)
    .join('\n')
  const reminderLines = reminders
    .slice(0, MAX_CONTEXT_ITEMS)
    .map((r) => `#${r.id}: ${r.text} @ ${toLocalIso(new Date(r.dueAt), tz)}${repeatNote(r)}`)
    .join('\n')
  const hidden = totalNotes > notes.length ? ` (menampilkan ${notes.length} dari ${totalNotes} catatan yang paling relevan & terbaru)` : ''
  const sources = mcpSources.map((s) => `"${s.name}" (${s.label})`).join(', ')

  return `Kamu adalah asisten pribadi di WhatsApp yang mengelola CATATAN (memory bank: note & konteks penting) dan REMINDER milik pemilik.
Tugasmu: ubah pesan pengguna menjadi SATU objek JSON. Jangan memakai tool apa pun. Jangan menulis apa pun selain JSON.

Waktu sekarang: ${toLocalIso(now, tz)} (zona waktu ${tz}).${ownerName ? `\nNama panggilan pemilik: ${ownerName} (sapa dengan nama ini di "reply", gaya santai pakai "aku" dan "kamu").` : ''}

Skema JSON:
{
  "action": ${ACTIONS.map((a) => `"${a}"`).join(' | ')},
  "text": string,          // add_note/add_reminder: isi ringkas tanpa kata "ingatkan"/"catat" dan tanpa keterangan waktu (mis. "minum air"); search_notes: kata kunci
  "due_at": string | null, // hanya untuk add_reminder: ISO 8601 LENGKAP dengan offset zona waktu, harus di masa depan; null jika repeat "schedule"
  "repeat": "none" | "daily" | "weekly" | "schedule",
  "days": number[] | null,  // hanya untuk repeat "schedule": hari, 1=Senin ... 7=Minggu
  "times": string[] | null, // hanya untuk repeat "schedule": jam "HH:MM" 24 jam, mis. ["07:20","17:00"]
  "id": number | null,     // untuk delete/done: ID item dari daftar di bawah
  "source": string | null, // hanya untuk search_mcp: nama sumber
  "query": string | null,  // hanya untuk search_mcp: permintaan lengkap pengguna (termasuk link bila ada)
  "reply": string          // balasan singkat & ramah dalam bahasa pengguna
}

Aturan:
- "ingatkan/remind/jangan lupa ... <waktu>" → add_reminder. Jika jam tidak disebut untuk hari tertentu, pakai 09:00.
- Reminder berulang pada hari tertentu dan/atau beberapa jam per hari (mis. "tiap senin sampai jumat jam 7.20 dan jam 5 sore",
  "setiap hari jam 8 dan jam 20") → add_reminder dengan repeat "schedule", isi "days" dan "times", dan "due_at": null.
  "sore/malam" berarti jam 12–23 (jam 5 sore = 17:00).
- "catat/simpan/ingat ya/note ..." atau pengguna memberi info/konteks penting untuk diingat → add_note. Simpan detail pentingnya (angka, nama, kode) apa adanya.
- Pertanyaan yang jawabannya ada di Catatan (mis. "nomor meja aku berapa?") → action "chat", jawab di "reply" berdasarkan catatan itu dan sebut ID-nya.
- Mencari catatan yang tidak terlihat di daftar di bawah → search_notes dengan kata kunci di "text".
- Minta lihat semua catatan/reminder → list_notes / list_reminders.
- "hapus ..." → delete dengan id yang paling cocok; "sudah/selesai ..." → done dengan id reminder yang cocok.
${sources
  ? `- Pertanyaan atau permintaan tentang data di sumber eksternal ${sources} (mis. Jira, Confluence, Bitbucket, issue, halaman, repo, branch, commit, pull request, file kode, atau link ke sumber itu) → search_mcp dengan "source" dan "query".`
  : '- Tidak ada sumber eksternal yang aktif. Jika pengguna minta cek Jira/Confluence, jawab lewat "chat" bahwa fitur /atlassian belum diaktifkan (jalankan npm run setup).'}
- Jika tidak ada ID yang cocok atau permintaan tidak jelas → action "chat" dan tanyakan balik di "reply".
- Obrolan umum → action "chat" dengan jawaban singkat di "reply".

Catatan${hidden}:
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

const str = (v) => (typeof v === 'string' ? v.trim() : '')

// Nama produk yang sering dipakai AI/pengguna untuk sebuah sumber MCP.
const SOURCE_ALIASES = { atlassian: ['jira', 'confluence', 'bitbucket', 'bamboo'] }

// AI kadang menulis "confluence" padahal sumbernya "atlassian": cocokkan lewat alias/label,
// dan bila hanya ada satu sumber aktif, pakai itu.
function resolveSource(source, mcpSources) {
  const hit = mcpSources.find(
    (s) =>
      s.name === source ||
      (SOURCE_ALIASES[s.name] || []).includes(source) ||
      (source && s.label.toLowerCase().includes(source))
  )
  if (hit) return hit.name
  return mcpSources.length === 1 ? mcpSources[0].name : null
}

// Validasi & normalisasi intent. Mengembalikan { ok: true, intent } atau { ok: false, error }.
// message: pesan asli, dipakai sebagai query cadangan untuk search_mcp; tz wajib untuk repeat "schedule".
export function validateIntent(raw, now, { mcpSources = [], message = '', tz } = {}) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Format jawaban AI tidak valid' }
  const action = raw.action
  if (!ACTIONS.includes(action)) return { ok: false, error: `Aksi tidak dikenal: ${action}` }

  const intent = {
    action,
    text: str(raw.text),
    dueAt: null,
    repeat: REPEATS.includes(raw.repeat) ? raw.repeat : 'none',
    id: toId(raw.id),
    reply: str(raw.reply)
  }

  if (action === 'add_note' && !intent.text) return { ok: false, error: 'Isi catatan kosong' }
  if (action === 'search_notes' && !intent.text) return { ok: false, error: 'Kata kunci pencarian kosong' }
  if (action === 'add_reminder' && intent.repeat === 'schedule') {
    if (!intent.text) return { ok: false, error: 'Isi reminder kosong' }
    // Untuk jadwal, waktu kirim dihitung oleh kode, bukan diambil dari AI.
    const schedule = normalizeSchedule({ days: raw.days, times: raw.times })
    if (!schedule || !tz) return { ok: false, error: 'Jadwal reminder tidak valid' }
    intent.schedule = schedule
    intent.dueAt = nextScheduledOccurrence(schedule, now, tz)
  } else if (action === 'add_reminder') {
    if (!intent.text) return { ok: false, error: 'Isi reminder kosong' }
    const due = raw.due_at ? new Date(raw.due_at) : null
    if (!due || Number.isNaN(due.getTime())) return { ok: false, error: 'Waktu reminder tidak valid' }
    if (due.getTime() <= now.getTime()) return { ok: false, error: 'Waktu reminder sudah lewat' }
    intent.dueAt = due
  }
  if ((action === 'delete' || action === 'done') && intent.id === null) {
    return { ok: false, error: 'ID item tidak ditemukan' }
  }
  if (action === 'search_mcp') {
    const source = resolveSource(str(raw.source).toLowerCase(), mcpSources)
    if (!source) return { ok: false, error: `Sumber "${str(raw.source)}" belum diaktifkan` }
    intent.source = source
    intent.query = str(raw.query) || message
  }
  return { ok: true, intent }
}
