import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAssistant } from '../src/assistant.js'
import { Store } from '../src/db.js'
import { createScheduler } from '../src/scheduler.js'
import { createClaudeCli } from '../src/ai/claudeCli.js'
import { createCodexCli } from '../src/ai/codexCli.js'

const TZ = 'Asia/Jakarta'
const NOW = new Date('2026-09-30T03:00:00Z')
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')

const fakeAi = (output) => ({ name: 'fake', complete: async () => output })

test('perintah dieksekusi tanpa AI', async () => {
  const store = new Store(null)
  const a = createAssistant({ store, ai: null, tz: TZ, clock: () => NOW })
  assert.match(await a.handle('/note beli susu'), /Dicatat \(#1\)/)
  assert.match(await a.handle('/remind 10m angkat jemuran'), /#2 · angkat jemuran/)
  assert.match(await a.handle('/reminders'), /Reminder aktif \(1\)/)
  assert.match(await a.handle('/del 1'), /Catatan #1 dihapus/)
  assert.match(await a.handle('halo'), /AI tidak diaktifkan/)
})

test('pesan bebas diterjemahkan AI lalu dieksekusi', async () => {
  const store = new Store(null)
  const ai = fakeAi('{"action":"add_reminder","text":"olahraga","due_at":"2026-10-01T07:00:00+07:00","repeat":"none","id":null,"reply":"siap"}')
  const a = createAssistant({ store, ai, tz: TZ, clock: () => NOW })
  const reply = await a.handle('ingatkan aku besok jam 7 pagi olahraga')
  assert.match(reply, /#1 · olahraga/)
  assert.equal(store.listReminders()[0].dueAt, '2026-10-01T00:00:00.000Z')
})

test('AI error / output rusak ditangani dengan sopan', async () => {
  const store = new Store(null)
  const broken = createAssistant({ store, ai: fakeAi('bukan json'), tz: TZ, clock: () => NOW })
  assert.match(await broken.handle('apa kabar'), /belum paham/)
  const failing = createAssistant({
    store,
    ai: { name: 'x', complete: async () => { throw new Error('limit') } },
    tz: TZ,
    clock: () => NOW
  })
  assert.match(await failing.handle('apa kabar'), /limit/)
  const past = createAssistant({ store, ai: fakeAi('{"action":"add_reminder","text":"a","due_at":"2020-01-01T00:00:00Z"}'), tz: TZ, clock: () => NOW })
  assert.match(await past.handle('x'), /sudah lewat/)
})

test('scheduler mengirim reminder jatuh tempo dan mencoba ulang bila gagal', async () => {
  const store = new Store(null)
  store.addReminder('minum air', new Date('2026-09-30T02:59:30Z'))
  store.addReminder('lama', new Date('2026-09-29T00:00:00Z'), 'daily')
  const sent = []
  let fail = true
  const sched = createScheduler({
    store,
    tz: TZ,
    clock: () => NOW,
    send: async (t) => {
      if (fail) throw new Error('offline')
      sent.push(t)
    }
  })
  await sched.tick()
  assert.equal(sent.length, 0)
  assert.equal(store.dueReminders(NOW).length, 2)

  fail = false
  await sched.tick()
  assert.equal(sent.length, 2)
  assert.match(sent[0], /terlambat/)
  assert.match(sent[1], /minum air/)
  assert.equal(store.dueReminders(NOW).length, 0)
  assert.equal(store.listReminders().length, 1) // yang harian dijadwalkan ulang
})

test('reminder terjadwal: perintah, AI, daftar, dan scheduler', async () => {
  const store = new Store(null)
  let now = NOW // Rabu 30 Sep 2026 10:00 WIB
  const a = createAssistant({ store, ai: null, tz: TZ, clock: () => now })
  const reply = await a.handle('/remind senin-jumat 07:20,17:00 absen')
  assert.match(reply, /Sen–Jum jam 07:20 & 17:00/)
  assert.match(reply, /Kiriman pertama: Rab, 30 Sep 2026, 17\.00/)
  assert.match(await a.handle('/reminders'), /#1 · .* 🔁 Sen–Jum jam 07:20 & 17:00\n {4}absen/)

  const viaAi = createAssistant({
    store,
    ai: fakeAi('{"action":"add_reminder","text":"olahraga","due_at":null,"repeat":"schedule","days":[1,3,5],"times":["06:00"]}'),
    tz: TZ,
    clock: () => now
  })
  assert.match(await viaAi.handle('ingatkan olahraga tiap senin rabu jumat jam 6'), /Sen, Rab, Jum jam 06:00/)

  const sent = []
  const sched = createScheduler({ store, tz: TZ, clock: () => now, send: async (t) => sent.push(t) })
  now = new Date('2026-09-30T10:00:10Z') // 17:00:10 WIB
  await sched.tick()
  assert.equal(sent.length, 1)
  assert.doesNotMatch(sent[0], /terlambat/)
  assert.match(sent[0], /absen[\s\S]*\/done 1/)
  assert.equal(store.find(1).item.dueAt, '2026-10-01T00:20:00.000Z') // Kamis 07:20 WIB

  // Bot mati dari Kamis pagi sampai Kamis 12:00 → satu kiriman terlambat, lalu Kamis 17:00
  now = new Date('2026-10-01T05:00:00Z')
  await sched.tick()
  assert.equal(sent.length, 2)
  assert.match(sent[1], /terlambat, jadwal Kam, 1 Okt 2026, 07\.20/)
  assert.equal(store.find(1).item.dueAt, '2026-10-01T10:00:00.000Z')

  assert.match(await a.handle('/done 1'), /selesai: absen/)
  assert.equal(store.listReminders().filter((r) => r.id === 1).length, 0)
})

test('Claude CLI provider (binary palsu)', { skip: process.platform === 'win32' }, async () => {
  const ai = createClaudeCli({ bin: path.join(FIX, 'fake-claude.js'), model: 'haiku', timeoutMs: 10000 })
  const out = await ai.complete('tolong catat beli susu')
  const store = new Store(null)
  const a = createAssistant({ store, ai, tz: TZ, clock: () => NOW })
  assert.match(out, /"--model","haiku","--tools",""\]/)
  assert.match(await a.handle('tolong catat beli susu'), /Dicatat/)
})

test('Codex CLI provider (binary palsu)', { skip: process.platform === 'win32' }, async () => {
  const ai = createCodexCli({ bin: path.join(FIX, 'fake-codex.js'), timeoutMs: 10000 })
  const out = JSON.parse(await ai.complete('halo'))
  assert.equal(out.action, 'list_notes')
  assert.equal(out.gotPrompt, true)
  assert.ok(out.args.includes('--sandbox'))
  assert.equal(out.args.at(-1), '-')
})

test('CLI tidak ditemukan → pesan jelas', async () => {
  const ai = createClaudeCli({ bin: 'claude-tidak-ada-xyz', timeoutMs: 5000 })
  await assert.rejects(ai.complete('x'), /tidak ditemukan|keluar dengan kode/)
})
