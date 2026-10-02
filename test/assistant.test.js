import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createAssistant, reminderConfirmation } from '../src/assistant.js'
import { Store } from '../src/db.js'
import { createScheduler, reminderMessage } from '../src/scheduler.js'
import { createClaudeCli } from '../src/ai/claudeCli.js'
import { ClaudeSession } from '../src/ai/claudeSession.js'
import { createCodexCli } from '../src/ai/codexCli.js'
import { ATLASSIAN_PRESET, createMcpRunner, mcpArgs } from '../src/ai/mcpQuery.js'
import { FIXTURES, fakeBin } from './helpers.js'

const TZ = 'Asia/Jakarta'
const NOW = new Date('2026-09-30T03:00:00Z')

const fakeAi = (output) => ({ name: 'fake', complete: async () => output })

test('perintah dieksekusi tanpa AI', async () => {
  const store = new Store(null)
  const a = createAssistant({ store, ai: null, tz: TZ, clock: () => NOW })
  assert.match(await a.handle('/note beli susu'), /Dicatat \(#1\)/)
  assert.equal(await a.handle('/remind 10m angkat jemuran'), 'Oke aku ingetin kamu 10 menit lagi ya pukul 10.10 untuk angkat jemuran')
  assert.match(await a.handle('/reminders'), /Reminder aktif \(1\)/)
  assert.match(await a.handle('/del 1'), /Catatan #1 dihapus/)
  assert.match(await a.handle('halo'), /AI tidak diaktifkan/)
})

test('pesan bebas diterjemahkan AI lalu dieksekusi', async () => {
  const store = new Store(null)
  const ai = fakeAi('{"action":"add_reminder","text":"olahraga","due_at":"2026-10-01T07:00:00+07:00","repeat":"none","id":null,"reply":"siap"}')
  const a = createAssistant({ store, ai, tz: TZ, clock: () => NOW })
  const reply = await a.handle('ingatkan aku besok jam 7 pagi olahraga')
  assert.equal(reply, 'Oke aku ingetin kamu besok pukul 07.00 ya untuk olahraga')
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

test('konfirmasi reminder: durasi untuk yang dekat, hari untuk yang jauh, info repeat', () => {
  const at = (iso, repeat = 'none') => reminderConfirmation({ id: 7, text: 'x', dueAt: iso, repeat }, NOW, TZ)
  assert.equal(at('2026-09-30T04:30:00Z'), 'Oke aku ingetin kamu 1 jam 30 menit lagi ya pukul 11.30 untuk x')
  assert.equal(at('2026-10-08T02:00:00Z'), 'Oke aku ingetin kamu Kam, 8 Okt pukul 09.00 ya untuk x')
  assert.match(at('2026-10-01T00:00:00Z', 'daily'), /^Oke aku ingetin kamu besok pukul 07\.00 ya untuk x, dan aku ulangi setiap hari 🔁\n_Balas \/done 7/)
  const fired = reminderMessage({ id: 7, text: 'minum air', dueAt: NOW.toISOString(), repeat: 'none' }, NOW, TZ)
  assert.equal(fired, 'Hii, aku mau remind minum air jangan lupa ya')
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
    ownerName: 'Kai',
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
  assert.match(sent[0], /^Hii Kai, aku mau remind lama jangan lupa ya\n_\(harusnya .*maaf telat/)
  assert.match(sent[0], /\/done 2/)
  assert.equal(sent[1], 'Hii Kai, aku mau remind minum air jangan lupa ya')
  assert.equal(store.dueReminders(NOW).length, 0)
  assert.equal(store.listReminders().length, 1) // yang harian dijadwalkan ulang
})

test('reminder terjadwal: perintah, AI, daftar, /help, dan scheduler', async () => {
  const store = new Store(null)
  let now = NOW // Rabu 30 Sep 2026 10:00 WIB
  const a = createAssistant({ store, ai: null, tz: TZ, clock: () => now })
  const reply = await a.handle('/remind senin-jumat 07:20-17:00 absen')
  assert.match(reply, /^Oke aku ingetin kamu absen tiap Sen–Jum jam 07:20 & 17:00 🔁\nKiriman pertama pukul 17\.00\.\n_Balas \/done 1/)
  const soon = reminderConfirmation(
    { id: 9, text: 'x', dueAt: '2026-09-30T03:02:00Z', repeat: 'schedule', schedule: { days: [3], times: ['10:02'] } },
    NOW,
    TZ
  )
  assert.match(soon, /Kiriman pertama 2 menit lagi, pukul 10\.02\./)
  assert.match(await a.handle('/reminders'), /#1 · .* 🔁 Sen–Jum jam 07:20 & 17:00\n {4}absen/)
  assert.match(await a.handle('/help'), /\/remind senin-jumat 07:20,17:00 absen/)

  const viaAi = createAssistant({
    store,
    ai: fakeAi('{"action":"add_reminder","text":"olahraga","due_at":null,"repeat":"schedule","days":[1,3,5],"times":["06:00"]}'),
    tz: TZ,
    clock: () => now
  })
  assert.match(await viaAi.handle('ingatkan olahraga tiap senin rabu jumat jam 6'), /tiap Sen, Rab, Jum jam 06:00/)

  const sent = []
  const sched = createScheduler({ store, tz: TZ, clock: () => now, send: async (t) => sent.push(t) })
  now = new Date('2026-09-30T10:00:10Z') // 17:00:10 WIB
  await sched.tick()
  assert.equal(sent.length, 1)
  assert.doesNotMatch(sent[0], /telat/)
  assert.match(sent[0], /absen[\s\S]*\/done 1/)
  assert.equal(store.find(1).item.dueAt, '2026-10-01T00:20:00.000Z') // Kamis 07:20 WIB

  // Bot mati dari Kamis pagi sampai Kamis 12:00 → satu kiriman terlambat, lalu Kamis 17:00
  now = new Date('2026-10-01T05:00:00Z')
  await sched.tick()
  assert.equal(sent.length, 2)
  assert.match(sent[1], /maaf telat/)
  assert.equal(store.find(1).item.dueAt, '2026-10-01T10:00:00.000Z')

  assert.match(await a.handle('/done 1'), /selesai: absen/)
  assert.equal(store.listReminders().filter((r) => r.id === 1).length, 0)
})

test('Claude CLI provider sekali jalan (binary palsu)', async () => {
  const ai = createClaudeCli({ bin: fakeBin('fake-claude.js'), model: 'haiku', timeoutMs: 10000, persistent: false })
  const out = await ai.complete('tolong catat beli susu')
  const store = new Store(null)
  const a = createAssistant({ store, ai, tz: TZ, clock: () => NOW })
  // System prompt berisi spasi & titik harus sampai utuh sebagai satu argumen, begitu juga "" untuk --tools.
  assert.match(out, /"--system-prompt","Kamu adalah asisten pribadi[^"]*sebelumnya\.","--model","haiku","--tools",""\]/)
  assert.match(await a.handle('tolong catat beli susu'), /Dicatat/)
})

test('Claude session: proses dipakai ulang, diganti setelah maxTurns, pulih setelah crash', async () => {
  const session = new ClaudeSession({ bin: fakeBin('fake-claude-stream.js'), timeoutMs: 10000, maxTurns: 3 })
  try {
    session.warm()
    const r1 = JSON.parse(await session.complete('halo 1')) // turn 2 (turn 1 = pemanasan)
    const r2 = JSON.parse(await session.complete('halo 2')) // turn 3 → proses diganti
    const r3 = JSON.parse(await session.complete('halo 3'))
    assert.equal(r1.turn, 2)
    assert.equal(r1.pid, r2.pid)
    assert.notEqual(r3.pid, r2.pid)

    await assert.rejects(session.complete('ERROR'), /limit tercapai/)
    await assert.rejects(session.complete('CRASH'), /berhenti/)
    const r4 = JSON.parse(await session.complete('halo 4'))
    assert.notEqual(r4.pid, r3.pid)

    // Pesan bersamaan diantrikan, bukan dicampur: dua-duanya dapat jawaban sendiri.
    // ('x' = turn 3 → proses diganti, jadi 'y' dijawab proses baru.)
    const [a, b] = (await Promise.all([session.complete('x'), session.complete('y')])).map((s) => JSON.parse(s))
    assert.equal(a.turn, 3)
    assert.equal(b.turn, 2)
    assert.notEqual(a.pid, b.pid)
  } finally {
    session.close()
  }
})

test('Claude CLI provider persisten dipakai assistant', async () => {
  const ai = createClaudeCli({ bin: fakeBin('fake-claude-stream.js'), timeoutMs: 10000 })
  try {
    const a = createAssistant({ store: new Store(null), ai, tz: TZ, clock: () => NOW })
    assert.match(await a.handle('tolong catat beli susu'), /Dicatat \(#1\): beli susu/)
  } finally {
    ai.close()
  }
})

test('/atlassian: pesan sela, hasil, format salah, dan tidak aktif tanpa runner', async () => {
  const mcpCommands = { atlassian: { ...ATLASSIAN_PRESET, label: 'Atlassian', mcpConfig: 'x' } }
  const notes = []
  const runner = { run: async (cmd, q) => `hasil ${cmd.server}: ${q}` }
  const a = createAssistant({ store: new Store(null), ai: null, tz: TZ, mcpCommands, mcpRunner: runner, clock: () => NOW })
  const notify = async (t) => notes.push(t)
  assert.equal(await a.handle('/Atlassian  sync kas', { notify }), 'hasil atlassian: sync kas')
  assert.match(notes[0], /Lagi nyari "sync kas" di Atlassian/)
  assert.match(await a.handle('/atlassian', { notify }), /Format: \/atlassian <kata kunci>/)
  assert.match(await a.handle('/help'), /\/atlassian <kata kunci \/ pertanyaan \/ link>/)

  const failing = createAssistant({ store: new Store(null), ai: null, tz: TZ, mcpCommands, mcpRunner: { run: async () => { throw new Error('server mati') } } })
  assert.match(await failing.handle('/atlassian x'), /gagal:\nserver mati/)

  const off = createAssistant({ store: new Store(null), ai: null, tz: TZ, mcpCommands })
  assert.match(await off.handle('/atlassian x'), /belum diaktifkan[\s\S]*npm run setup/)
})

test('bahasa bebas diarahkan ke /atlassian oleh AI (dinamis)', async () => {
  const mcpCommands = { atlassian: { ...ATLASSIAN_PRESET, label: 'Atlassian', mcpConfig: 'x' } }
  let prompt = ''
  let ran = null
  const ai = {
    name: 'fake',
    complete: async (p) => {
      prompt = p
      return '{"action":"search_mcp","source":"atlassian","query":"","reply":""}'
    }
  }
  const runner = { run: async (cmd, q) => ((ran = q), 'isi halaman') }
  const a = createAssistant({ store: new Store(null), ai, tz: TZ, mcpCommands, mcpRunner: runner, clock: () => NOW })
  const msg = 'coba pahami https://confluence.example/pages/123'
  assert.equal(await a.handle(msg), 'isi halaman')
  assert.equal(ran, msg) // query kosong → pakai pesan asli
  assert.match(prompt, /"atlassian" \(Atlassian\)/)

  // AI menulis nama produk ("confluence") alih-alih nama sumber → tetap diarahkan ke atlassian.
  ai.complete = async (p) => ((prompt = p), '{"action":"search_mcp","source":"confluence","query":"pahami halaman 123"}')
  assert.equal(await a.handle(msg), 'isi halaman')
  assert.equal(ran, 'pahami halaman 123')

  // Tanpa MCP aktif, AI diberi tahu fiturnya belum aktif dan aksi search_mcp ditolak.
  const off = createAssistant({ store: new Store(null), ai, tz: TZ, clock: () => NOW })
  assert.match(await off.handle(msg), /belum diaktifkan/)
  assert.match(prompt, /fitur \/atlassian belum diaktifkan/)
})

test('memory bank: AI menerima catatan relevan, /cari mencari catatan', async () => {
  const store = new Store(null)
  store.addNote('Nomor meja kantor 12 di lantai 3')
  for (let i = 0; i < 20; i++) store.addNote(`catatan lain ${i}`)
  let prompt = ''
  const ai = { name: 'fake', complete: async (p) => ((prompt = p), '{"action":"chat","reply":"Meja kamu nomor 12 (#1)"}') }
  const a = createAssistant({ store, ai, tz: TZ, clock: () => NOW })
  assert.equal(await a.handle('nomor meja aku berapa?'), 'Meja kamu nomor 12 (#1)')
  assert.match(prompt, /#1: Nomor meja kantor 12/)
  assert.match(prompt, /menampilkan 11 dari 21 catatan/)
  assert.doesNotMatch(prompt, /catatan lain 0\n/)

  assert.match(await a.handle('/cari meja'), /#1 · Nomor meja kantor 12/)
  assert.match(await a.handle('/cari xyzabc'), /belum nemu/)
})

test('MCP runner: argumen read-only & pengaman', async () => {
  const cmd = { ...ATLASSIAN_PRESET, mcpConfig: path.join(FIXTURES, 'fake-mcp-server.js') }
  const args = mcpArgs(cmd, 'sonnet')
  const val = (flag) => args[args.indexOf(flag) + 1]
  assert.equal(val('--mcp-config'), cmd.mcpConfig)
  assert.ok(args.includes('--strict-mcp-config'))
  assert.ok(val('--allowedTools').split(',').every((t) => t.startsWith('mcp__atlassian__') && /_(get|search|list)_/.test(t)))
  const denied = val('--disallowedTools').split(',')
  assert.ok(denied.includes('mcp__atlassian__jira_delete_issue'))
  assert.ok(val('--allowedTools').includes('mcp__atlassian__bitbucket_get_file_content'))
  // Tool Bitbucket yang mengubah data tidak boleh diizinkan dan harus diblokir.
  for (const t of ['bitbucket_create_branch', 'bitbucket_create_pull_request', 'bitbucket_merge_pull_request']) {
    assert.ok(!val('--allowedTools').includes(t))
    assert.ok(denied.includes(`mcp__atlassian__${t}`))
  }
  assert.ok(denied.includes('Read') && denied.includes('Bash'))
  assert.deepEqual(args.slice(-2), ['--tools', ''])

  const runner = createMcpRunner({ bin: fakeBin('fake-claude-mcp.js'), timeoutMs: 10000 })
  const ok = await runner.run(cmd, 'sync kas')
  assert.match(ok, /^hasil untuk: Permintaan pengguna: sync kas/)
  assert.match(ok, /--strict-mcp-config/)
  await assert.rejects(runner.run({ ...cmd, mcpConfig: 'tidak-ada.json' }, 'x'), /tidak ditemukan/)
})

test('MCP runner: server tidak tersambung → berhenti lebih awal dengan pesan jelas', async () => {
  const cmd = { ...ATLASSIAN_PRESET, mcpConfig: path.join(FIXTURES, 'fake-mcp-server.js') }
  const runner = createMcpRunner({ bin: fakeBin('fake-claude-mcp.js'), timeoutMs: 10000 })
  try {
    process.env.FAKE_MCP_STATUS = 'failed'
    // Kasus di lapangan: setup diisi URL padahal tidak ada server HTTP.
    await assert.rejects(
      runner.run({ ...cmd, url: 'http://127.0.0.1:9999/mcp' }, 'x'),
      /gagal tersambung \(status: failed\) dari URL http:\/\/127\.0\.0\.1:9999\/mcp[\s\S]*bukan URL/
    )
    process.env.FAKE_MCP_STATUS = 'absent'
    await assert.rejects(runner.run(cmd, 'x'), /tidak ada di file/)
  } finally {
    delete process.env.FAKE_MCP_STATUS
  }
})

test('Codex CLI provider (binary palsu)', async () => {
  const ai = createCodexCli({ bin: fakeBin('fake-codex.js'), timeoutMs: 10000 })
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
