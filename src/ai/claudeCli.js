// Provider: Claude Code CLI (`claude -p`), memakai login akun Claude di komputer ini (tanpa API key).

import { runCli } from './cli.js'

export function createClaudeCli({ bin = 'claude', model, timeoutMs, cwd }) {
  return {
    name: 'Claude Code CLI',
    async complete(prompt) {
      const args = ['-p', '--output-format', 'json', '--no-session-persistence']
      if (model) args.push('--model', model)
      // --tools menerima banyak nilai, jadi taruh paling akhir. "" = nonaktifkan semua tool.
      args.push('--tools', '')
      const { stdout } = await runCli(bin, args, { input: prompt, timeoutMs, cwd })
      return parseClaudeOutput(stdout)
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
