import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPrompt, extractJson, validateIntent } from '../src/ai/prompt.js'
import { parseClaudeOutput } from '../src/ai/claudeCli.js'

const NOW = new Date('2026-09-30T03:00:00Z')

test('buildPrompt menyertakan waktu, pesan, dan daftar item', () => {
  const p = buildPrompt({
    message: 'ingatkan besok',
    now: NOW,
    tz: 'Asia/Jakarta',
    notes: [{ id: 1, text: 'beli susu' }],
    reminders: [{ id: 2, text: 'rapat', dueAt: '2026-10-01T02:00:00Z', repeat: 'none' }]
  })
  assert.match(p, /2026-09-30T10:00:00\+07:00/)
  assert.match(p, /#1: beli susu/)
  assert.match(p, /#2: rapat @ 2026-10-01T09:00:00\+07:00/)
  assert.match(p, /ingatkan besok/)
})

test('extractJson toleran terhadap code fence & teks', () => {
  assert.deepEqual(extractJson('```json\n{"a": "b}", "c": {"d": 1}}\n```'), { a: 'b}', c: { d: 1 } })
  assert.throws(() => extractJson('tidak ada'))
  assert.throws(() => extractJson('{"a": '))
})

test('validateIntent', () => {
  const ok = validateIntent({ action: 'add_reminder', text: 'x', due_at: '2026-10-01T09:00:00+07:00', repeat: 'daily' }, NOW)
  assert.equal(ok.ok, true)
  assert.equal(ok.intent.dueAt.toISOString(), '2026-10-01T02:00:00.000Z')
  assert.equal(ok.intent.repeat, 'daily')

  assert.equal(validateIntent({ action: 'add_reminder', text: 'x', due_at: '2020-01-01T00:00:00Z' }, NOW).ok, false)
  assert.equal(validateIntent({ action: 'add_reminder', text: 'x', due_at: 'besok' }, NOW).ok, false)
  assert.equal(validateIntent({ action: 'hack' }, NOW).ok, false)
  assert.equal(validateIntent({ action: 'delete', id: '#5' }, NOW).intent.id, 5)
  assert.equal(validateIntent({ action: 'done', id: null }, NOW).ok, false)
})

test('parseClaudeOutput', () => {
  assert.equal(parseClaudeOutput('{"type":"result","is_error":false,"result":"{\\"ok\\":true}"}'), '{"ok":true}')
  assert.throws(() => parseClaudeOutput('{"is_error":true,"result":"limit"}'), /limit/)
  assert.equal(parseClaudeOutput('teks biasa'), 'teks biasa')
})
