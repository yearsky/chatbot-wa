// Penyimpanan sederhana berbasis file JSON (tanpa native module, aman di Windows).
// Catatan dan reminder berbagi satu penghitung ID agar /del <id> tidak ambigu.

import fs from 'node:fs'
import path from 'node:path'
import { nextOccurrence } from './time.js'

const EMPTY = () => ({ nextId: 1, notes: [], reminders: [] })

export class Store {
  constructor(file) {
    this.file = file
    this.data = EMPTY()
    this.load()
  }

  load() {
    if (!this.file || !fs.existsSync(this.file)) return
    const raw = fs.readFileSync(this.file, 'utf8')
    if (!raw.trim()) return
    this.data = { ...EMPTY(), ...JSON.parse(raw) }
  }

  save() {
    if (!this.file) return
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    const json = JSON.stringify(this.data, null, 2)
    fs.writeFileSync(tmp, json)
    try {
      fs.renameSync(tmp, this.file)
    } catch {
      // Di Windows rename bisa gagal jika file sedang dikunci (mis. antivirus).
      fs.writeFileSync(this.file, json)
      fs.rmSync(tmp, { force: true })
    }
  }

  #id() {
    return this.data.nextId++
  }

  addNote(text, now = new Date()) {
    const note = { id: this.#id(), text, createdAt: now.toISOString() }
    this.data.notes.push(note)
    this.save()
    return note
  }

  listNotes() {
    return [...this.data.notes]
  }

  addReminder(text, dueAt, repeat = 'none', now = new Date()) {
    const reminder = {
      id: this.#id(),
      text,
      dueAt: dueAt.toISOString(),
      repeat,
      status: 'pending',
      createdAt: now.toISOString()
    }
    this.data.reminders.push(reminder)
    this.save()
    return reminder
  }

  listReminders() {
    return this.data.reminders
      .filter((r) => r.status === 'pending')
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
  }

  find(id) {
    const note = this.data.notes.find((n) => n.id === id)
    if (note) return { type: 'note', item: note }
    const reminder = this.data.reminders.find((r) => r.id === id)
    if (reminder) return { type: 'reminder', item: reminder }
    return null
  }

  remove(id) {
    const found = this.find(id)
    if (!found) return null
    const key = found.type === 'note' ? 'notes' : 'reminders'
    this.data[key] = this.data[key].filter((x) => x.id !== id)
    this.save()
    return found
  }

  // Tandai reminder selesai (juga menghentikan reminder berulang).
  markDone(id) {
    const reminder = this.data.reminders.find((r) => r.id === id && r.status === 'pending')
    if (!reminder) return null
    reminder.status = 'done'
    this.save()
    return reminder
  }

  dueReminders(now) {
    return this.listReminders().filter((r) => new Date(r.dueAt).getTime() <= now.getTime())
  }

  // Dipanggil setelah reminder berhasil dikirim.
  afterFire(id, now, tz) {
    const reminder = this.data.reminders.find((r) => r.id === id)
    if (!reminder) return null
    const next = nextOccurrence(new Date(reminder.dueAt), reminder.repeat, now, tz)
    if (next) {
      reminder.dueAt = next.toISOString()
    } else {
      reminder.status = 'done'
      reminder.firedAt = now.toISOString()
    }
    this.save()
    return reminder
  }
}
