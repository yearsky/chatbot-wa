// Memory bank berbasis SQLite (modul bawaan Node `node:sqlite`, tanpa native module).
// Catatan (memori/konteks penting) dan reminder berbagi satu tabel & satu penghitung ID,
// sehingga /del <id> tidak ambigu. Catatan diindeks FTS5 untuk pencarian kata kunci,
// terinspirasi dari nds-knowledge-index (tanpa embedding: pencocokan makna diserahkan ke AI).

import fs from 'node:fs'
import path from 'node:path'
import { nextOccurrence } from './time.js'
import { nextScheduledOccurrence } from './schedule.js'

// node:sqlite masih berlabel eksperimental; sembunyikan peringatannya dari terminal.
const originalEmitWarning = process.emitWarning
process.emitWarning = function (warning, ...rest) {
  if (String(warning?.message ?? warning).includes('SQLite is an experimental feature')) return
  return originalEmitWarning.call(process, warning, ...rest)
}
const { DatabaseSync } = await import('node:sqlite')

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('note', 'reminder')),
    text TEXT NOT NULL,
    due_at TEXT,
    repeat TEXT NOT NULL DEFAULT 'none',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    fired_at TEXT,
    schedule TEXT
  );
  CREATE INDEX IF NOT EXISTS entries_due ON entries(kind, status, due_at);

  CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
    text, content='entries', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
    INSERT INTO entries_fts(rowid, text) VALUES (new.id, new.text);
  END;
  CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
    INSERT INTO entries_fts(entries_fts, rowid, text) VALUES ('delete', old.id, old.text);
  END;
  CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE OF text ON entries BEGIN
    INSERT INTO entries_fts(entries_fts, rowid, text) VALUES ('delete', old.id, old.text);
    INSERT INTO entries_fts(rowid, text) VALUES (new.id, new.text);
  END;
`

// Kata umum yang tidak berguna untuk pencarian.
const STOPWORDS = new Set(
  ('yang dan atau di ke dari ini itu aku kamu saya ada apa apakah gimana bagaimana dong deh sih kok ya ' +
    'tolong coba mau ingin bisa buat untuk dengan juga lagi sudah belum akan pada the and for with what ' +
    'catat catatan simpan ingat ingatkan remind reminder note notes tentang soal').split(' ')
)

// Ubah pesan bebas menjadi query FTS5: token penting, dicari sebagai prefiks, digabung OR.
export function ftsQuery(text) {
  const tokens = [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []))]
    .filter((t) => (t.length >= 3 || /^\d+$/.test(t)) && !STOPWORDS.has(t))
    .slice(0, 12)
  return tokens.length ? tokens.map((t) => `"${t}"*`).join(' OR ') : null
}

const toNote = (r) => ({ id: r.id, text: r.text, createdAt: r.created_at })
const toReminder = (r) => ({
  id: r.id,
  text: r.text,
  dueAt: r.due_at,
  repeat: r.repeat,
  status: r.status,
  createdAt: r.created_at,
  ...(r.fired_at ? { firedAt: r.fired_at } : {}),
  ...(r.schedule ? { schedule: JSON.parse(r.schedule) } : {})
})

export class Store {
  /** @param {string|null} file path SQLite; null = in-memory (untuk test) */
  constructor(file, { legacyJson } = {}) {
    if (file) fs.mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file || ':memory:')
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;')
    this.db.exec(SCHEMA)
    // File .db dari versi sebelum reminder terjadwal belum punya kolom schedule.
    const columns = this.db.prepare('PRAGMA table_info(entries)').all().map((c) => c.name)
    if (!columns.includes('schedule')) this.db.exec('ALTER TABLE entries ADD COLUMN schedule TEXT')
    if (legacyJson) this.migrated = this.#migrateJson(legacyJson)
  }

  // Impor data/db.json lama sekali saja, dengan ID yang sama, lalu ganti nama file lamanya.
  #migrateJson(file) {
    if (!fs.existsSync(file)) return 0
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM entries').get().n
    if (count > 0) return 0
    const data = JSON.parse(fs.readFileSync(file, 'utf8') || '{}')
    const insert = this.db.prepare(
      'INSERT INTO entries (id, kind, text, due_at, repeat, status, created_at, fired_at, schedule) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    let n = 0
    this.db.exec('BEGIN')
    try {
      for (const note of data.notes || []) {
        insert.run(note.id, 'note', note.text, null, 'none', 'pending', note.createdAt, null, null)
        n++
      }
      for (const r of data.reminders || []) {
        const schedule = r.schedule ? JSON.stringify(r.schedule) : null
        insert.run(r.id, 'reminder', r.text, r.dueAt, r.repeat || 'none', r.status || 'pending', r.createdAt, r.firedAt || null, schedule)
        n++
      }
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    fs.renameSync(file, `${file}.migrated`)
    return n
  }

  close() {
    this.db.close()
  }

  #insert(kind, text, { dueAt = null, repeat = 'none', schedule = null } = {}, now = new Date()) {
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO entries (kind, text, due_at, repeat, created_at, schedule) VALUES (?, ?, ?, ?, ?, ?)')
      .run(kind, text, dueAt, repeat, now.toISOString(), schedule ? JSON.stringify(schedule) : null)
    return this.db.prepare('SELECT * FROM entries WHERE id = ?').get(Number(lastInsertRowid))
  }

  addNote(text, now = new Date()) {
    return toNote(this.#insert('note', text, {}, now))
  }

  listNotes() {
    return this.db.prepare("SELECT * FROM entries WHERE kind = 'note' ORDER BY id").all().map(toNote)
  }

  // Cari catatan dengan FTS5 (bm25). Mengembalikan [] bila tidak ada kata kunci yang berarti.
  searchNotes(text, limit = 10) {
    const query = ftsQuery(text)
    if (!query) return []
    return this.db
      .prepare(
        `SELECT e.* FROM entries_fts f JOIN entries e ON e.id = f.rowid
         WHERE entries_fts MATCH ? AND e.kind = 'note' ORDER BY bm25(entries_fts) LIMIT ?`
      )
      .all(query, limit)
      .map(toNote)
  }

  // Konteks untuk AI: catatan yang relevan dengan pesan + beberapa catatan terbaru.
  relevantNotes(text, { limit = 10, recent = 10 } = {}) {
    const byId = new Map(this.searchNotes(text, limit).map((n) => [n.id, n]))
    const latest = this.db
      .prepare("SELECT * FROM entries WHERE kind = 'note' ORDER BY id DESC LIMIT ?")
      .all(recent)
      .map(toNote)
    for (const n of latest) byId.set(n.id, n)
    return [...byId.values()].sort((a, b) => a.id - b.id)
  }

  countNotes() {
    return this.db.prepare("SELECT COUNT(*) AS n FROM entries WHERE kind = 'note'").get().n
  }

  // repeat 'schedule' butuh `schedule` = { days, times } (lihat schedule.js).
  addReminder(text, dueAt, repeat = 'none', now = new Date(), schedule = null) {
    const fields = { dueAt: dueAt.toISOString(), repeat, schedule: repeat === 'schedule' ? schedule : null }
    return toReminder(this.#insert('reminder', text, fields, now))
  }

  listReminders() {
    return this.db
      .prepare("SELECT * FROM entries WHERE kind = 'reminder' AND status = 'pending' ORDER BY due_at, id")
      .all()
      .map(toReminder)
  }

  find(id) {
    const row = this.db.prepare('SELECT * FROM entries WHERE id = ?').get(id)
    if (!row) return null
    return row.kind === 'note' ? { type: 'note', item: toNote(row) } : { type: 'reminder', item: toReminder(row) }
  }

  remove(id) {
    const found = this.find(id)
    if (!found) return null
    this.db.prepare('DELETE FROM entries WHERE id = ?').run(id)
    return found
  }

  // Tandai reminder selesai (juga menghentikan reminder berulang).
  markDone(id) {
    const { changes } = this.db
      .prepare("UPDATE entries SET status = 'done' WHERE id = ? AND kind = 'reminder' AND status = 'pending'")
      .run(id)
    return changes ? this.find(id).item : null
  }

  dueReminders(now) {
    return this.db
      .prepare("SELECT * FROM entries WHERE kind = 'reminder' AND status = 'pending' AND due_at <= ? ORDER BY due_at, id")
      .all(now.toISOString())
      .map(toReminder)
  }

  // Dipanggil setelah reminder berhasil dikirim.
  afterFire(id, now, tz) {
    const found = this.find(id)
    if (!found || found.type !== 'reminder') return null
    const r = found.item
    // Jadwal berikutnya dihitung dari `now`, jadi jadwal yang terlewat saat bot mati tidak dikirim beruntun.
    const next =
      r.repeat === 'schedule'
        ? nextScheduledOccurrence(r.schedule, now, tz)
        : nextOccurrence(new Date(r.dueAt), r.repeat, now, tz)
    if (next) {
      this.db.prepare('UPDATE entries SET due_at = ? WHERE id = ?').run(next.toISOString(), id)
    } else {
      this.db.prepare("UPDATE entries SET status = 'done', fired_at = ? WHERE id = ?").run(now.toISOString(), id)
    }
    return this.find(id).item
  }
}
