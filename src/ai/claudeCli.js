// Provider: Claude Code CLI (`claude -p`), memakai login akun Claude di komputer ini (tanpa API key).

import { runCli } from './cli.js'
import { ClaudeSession } from './claudeSession.js'

// Menggantikan system prompt bawaan Claude Code ("asisten software engineering"),
// yang membuat model menolak tugas di luar coding. Hindari karakter khusus cmd (% ^ & " < > |).
export const CLAUDE_SYSTEM_PROMPT =
  'Kamu adalah asisten pribadi di WhatsApp yang mengelola catatan dan reminder milik pemilik. ' +
  'Ikuti instruksi di pesan pengguna dan jawab hanya dengan satu objek JSON sesuai skema yang diminta. ' +
  'Setiap pesan pengguna berdiri sendiri dan sudah memuat data terbaru, jadi abaikan pesan-pesan sebelumnya.'

export function claudeArgs(model) {
  const args = ['--no-session-persistence', '--system-prompt', CLAUDE_SYSTEM_PROMPT]
  if (model) args.push('--model', model)
  // --tools menerima banyak nilai, jadi taruh paling akhir. "" = nonaktifkan semua tool.
  args.push('--tools', '')
  return args
}

/**
 * persistent=true: satu proses Claude terus menyala (cepat, ~1-3 detik per pesan).
 * Jika gagal, otomatis jatuh ke mode sekali jalan (lambat tapi sederhana).
 */
export function createClaudeCli({ bin = 'claude', model, timeoutMs, cwd, persistent = true, maxTurns, log = () => {} }) {
  const session = persistent ? new ClaudeSession({ bin, args: claudeArgs(model), cwd, timeoutMs, maxTurns, log }) : null

  async function oneShot(prompt) {
    const { stdout } = await runCli(bin, ['-p', '--output-format', 'json', ...claudeArgs(model)], {
      input: prompt,
      timeoutMs,
      cwd
    })
    return parseClaudeOutput(stdout)
  }

  return {
    name: 'Claude Code CLI',
    warm: () => session?.warm(),
    close: () => session?.close(),
    async complete(prompt) {
      if (!session) return oneShot(prompt)
      try {
        return await session.complete(prompt)
      } catch (err) {
        log('warn', `Sesi Claude gagal (${err.message}), mencoba mode sekali jalan...`)
        return oneShot(prompt)
      }
    }
  }
}

export function parseClaudeOutput(stdout) {
  let data
  try {
    data = JSON.parse(stdout)
  } catch {
    // Versi lama / format teks: kembalikan apa adanya.
    return stdout
  }
  if (data.is_error) throw new Error(`Claude error: ${data.result || data.subtype || 'tidak diketahui'}`)
  return typeof data.result === 'string' ? data.result : stdout
}
