import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCommand } from '../src/commands.js'

const TZ = 'Asia/Jakarta'
const NOW = new Date('2026-09-30T03:00:00Z')

test('bukan perintah → null', () => {
  assert.equal(parseCommand('halo', NOW, TZ), null)
})

test('/note dan /notes', () => {
  assert.deepEqual(parseCommand('/note beli susu', NOW, TZ).intent, { action: 'add_note', text: 'beli susu' })
  assert.ok(parseCommand('/note', NOW, TZ).error)
  assert.equal(parseCommand('/NOTES', NOW, TZ).intent.action, 'list_notes')
})

test('/remind dengan repeat', () => {
  const r = parseCommand('/remind harian 07:00 minum obat', NOW, TZ).intent
  assert.equal(r.action, 'add_reminder')
  assert.equal(r.repeat, 'daily')
  assert.equal(r.text, 'minum obat')
  assert.equal(r.dueAt.toISOString(), '2026-10-01T00:00:00.000Z')
  assert.ok(parseCommand('/remind 10m', NOW, TZ).error)
  assert.ok(parseCommand('/remind kapan-kapan x', NOW, TZ).error)
})

test('/done, /del, perintah tak dikenal', () => {
  assert.deepEqual(parseCommand('/done #3', NOW, TZ).intent, { action: 'done', id: 3 })
  assert.deepEqual(parseCommand('/del 4', NOW, TZ).intent, { action: 'delete', id: 4 })
  assert.ok(parseCommand('/del abc', NOW, TZ).error)
  assert.ok(parseCommand('/xyz', NOW, TZ).error)
})
