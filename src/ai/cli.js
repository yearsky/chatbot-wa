// Menjalankan CLI (claude / codex) sebagai subprocess, lintas platform.
// Prompt selalu dikirim lewat stdin agar tidak ada masalah quoting di cmd/PowerShell.

import { spawn } from 'node:child_process'

const IS_WINDOWS = process.platform === 'win32'

// Di Windows, CLI hasil `npm i -g` berupa .cmd sehingga butuh shell,
// dan Node menggabungkan argumen apa adanya → quote manual.
function quoteWinArg(arg) {
  if (arg === '') return '""'
  if (!/[\s"&|<>^%()]/.test(arg)) return arg
  return `"${arg.replace(/"/g, '""')}"`
}

export function runCli(bin, args, { input = '', timeoutMs = 120000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const finalArgs = IS_WINDOWS ? args.map(quoteWinArg) : args
    let child
    try {
      child = spawn(IS_WINDOWS ? quoteWinArg(bin) : bin, finalArgs, {
        cwd,
        shell: IS_WINDOWS,
        windowsHide: true,
        env: process.env
      })
    } catch (err) {
      reject(err)
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }

    const timer = setTimeout(() => {
      child.kill()
      finish(reject, new Error(`${bin} tidak merespons dalam ${Math.round(timeoutMs / 1000)} detik`))
    }, timeoutMs)

    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (err) => {
      const msg = err.code === 'ENOENT' ? `Perintah "${bin}" tidak ditemukan. Sudah diinstal?` : err.message
      finish(reject, new Error(msg))
    })
    child.on('close', (code) => {
      if (code === 0) finish(resolve, { stdout, stderr })
      else {
        const detail = (stderr || stdout).trim().split('\n').slice(-5).join('\n')
        finish(reject, new Error(`${bin} keluar dengan kode ${code}${detail ? `: ${detail}` : ''}`))
      }
    })

    child.stdin.on('error', () => {}) // proses bisa keluar sebelum stdin selesai ditulis
    child.stdin.end(input)
  })
}

// Cek apakah CLI terpasang; mengembalikan string versi atau null.
export async function cliVersion(bin) {
  try {
    const { stdout } = await runCli(bin, ['--version'], { timeoutMs: 30000 })
    return stdout.trim().split('\n')[0] || 'terpasang'
  } catch {
    return null
  }
}
