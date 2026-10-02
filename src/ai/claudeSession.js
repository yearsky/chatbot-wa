// Satu proses `claude -p` yang terus menyala (stream-json), supaya tiap pesan tidak perlu
// menunggu Claude Code menyala dari nol (~5-10 detik). Proses diganti baru setiap `maxTurns`
// pesan agar riwayat percakapan tidak menumpuk dan menghabiskan kuota.

import readline from 'node:readline'
import { killTree, spawnCli, spawnErrorMessage } from './cli.js'

const WARMUP_PROMPT = 'Balas hanya dengan: {"ok": true}'

export class ClaudeSession {
  constructor({ bin = 'claude', args = [], cwd, timeoutMs = 120000, maxTurns = 10, log = () => {} }) {
    this.bin = bin
    this.args = args
    this.cwd = cwd
    this.timeoutMs = timeoutMs
    this.maxTurns = maxTurns
    this.log = log
    this.proc = null
    this.queue = Promise.resolve()
    this.closed = false
  }

  #spawn() {
    const child = spawnCli(
      this.bin,
      ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', ...this.args],
      { cwd: this.cwd }
    )
    const proc = { child, turns: 0, pending: null, stderr: '', dead: false }

    const fail = (err) => {
      proc.dead = true
      if (proc.pending) {
        proc.pending.reject(err)
        proc.pending = null
      }
      if (this.proc === proc) this.proc = null
    }

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let ev
      try {
        ev = JSON.parse(line)
      } catch {
        return
      }
      if (ev.type !== 'result' || !proc.pending) return
      const { resolve, reject } = proc.pending
      proc.pending = null
      if (ev.is_error) reject(new Error(`Claude error: ${ev.result || ev.subtype || 'tidak diketahui'}`))
      else resolve(typeof ev.result === 'string' ? ev.result : '')
    })
    child.stderr.on('data', (d) => (proc.stderr = (proc.stderr + d).slice(-2000)))
    child.stdin.on('error', () => {})
    child.on('error', (err) => fail(new Error(spawnErrorMessage(this.bin, err))))
    child.on('close', (code) => {
      const detail = proc.stderr.trim().split('\n').slice(-3).join('\n')
      fail(new Error(`${this.bin} berhenti (kode ${code})${detail ? `: ${detail}` : ''}`))
    })

    // Pemanasan: Claude baru benar-benar siap setelah menerima pesan pertama.
    proc.ready = this.#send(proc, WARMUP_PROMPT).catch((err) => {
      this.log('warn', `Pemanasan Claude gagal: ${err.message}`)
      this.#retire(proc) // jangan pakai ulang proses yang gagal; pesan berikutnya membuat yang baru
      throw err
    })
    return proc
  }

  #send(proc, text) {
    return new Promise((resolve, reject) => {
      if (proc.dead) return reject(new Error(`${this.bin} sudah berhenti`))
      const timer = setTimeout(() => {
        proc.pending = null
        killTree(proc.child)
        reject(new Error(`Claude tidak merespons dalam ${Math.round(this.timeoutMs / 1000)} detik`))
      }, this.timeoutMs)
      proc.pending = {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e))
      }
      proc.turns++
      proc.child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n')
    })
  }

  // Nyalakan proses lebih awal (dipanggil saat bot start) agar pesan pertama pun cepat.
  warm() {
    if (this.closed) return
    if (!this.proc || this.proc.dead) this.proc = this.#spawn()
    this.proc.ready.catch(() => {})
  }

  #retire(proc) {
    if (this.proc === proc) this.proc = null
    proc.dead = true
    proc.child.stdin.end() // claude keluar sendiri setelah stdin ditutup
    setTimeout(() => killTree(proc.child), 10000).unref()
  }

  async #run(prompt) {
    if (this.closed) throw new Error('Sesi Claude sudah ditutup')
    if (!this.proc || this.proc.dead) this.proc = this.#spawn()
    const proc = this.proc
    await proc.ready
    const result = await this.#send(proc, prompt)
    if (proc.turns >= this.maxTurns) {
      this.#retire(proc)
      this.warm() // siapkan pengganti di latar belakang
    }
    return result
  }

  complete(prompt) {
    // Satu pesan dalam satu waktu per proses.
    const run = this.queue.then(() => this.#run(prompt))
    this.queue = run.catch(() => {})
    return run
  }

  close() {
    this.closed = true
    if (this.proc) this.#retire(this.proc)
  }
}
